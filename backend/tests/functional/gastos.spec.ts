import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'

/**
 * API-4 — alta, edicion, anulacion e historial de gastos, por HTTP.
 *
 * Lo que este archivo vigila no es el CRUD: es que **el reparto nunca se
 * calcule a mano**. Las tres funciones de `app/domain/reparto.ts` ya garantizan
 * que las partes sumen el total y que el centavo que sobra vaya a alguien; el
 * controlador las usa y no reimplementa nada. El test que lo fija es el que
 * compara, para cada gasto creado, la suma de las partes contra el total.
 *
 * La otra mitad es el borde: el validador valida **forma** (400) y el dominio
 * valida **sentido** (422), y el 422 trae el `field` apuntando a la parte que
 * falla, que es lo que FE-4 necesita para marcar el renglon equivocado en vez
 * de un cartel al pie del formulario.
 */

const CLAVE = 'una-clave-de-prueba-larga'

async function limpiar() {
  // El orden importa desde DAT-2: borrar partes deja gastos con el reparto en
  // cero y el trigger lo rechaza, con razon. Los gastos primero, que se llevan
  // su reparto en cascada.
  await db.rawQuery(
    `DELETE FROM expenses WHERE group_id IN
       (SELECT id FROM groups WHERE created_by IN
          (SELECT id FROM users WHERE email LIKE '%@prueba.example'))`
  )
  await db.rawQuery(
    `DELETE FROM memberships WHERE group_id IN
       (SELECT id FROM groups WHERE created_by IN
          (SELECT id FROM users WHERE email LIKE '%@prueba.example'))`
  )
  await db.rawQuery(
    `DELETE FROM groups WHERE created_by IN
       (SELECT id FROM users WHERE email LIKE '%@prueba.example')`
  )
  await db.rawQuery(
    `DELETE FROM auth_access_tokens WHERE tokenable_id IN
       (SELECT id FROM users WHERE email LIKE '%@prueba.example')`
  )
  await db.rawQuery(`DELETE FROM users WHERE email LIKE '%@prueba.example'`)
}

interface Parte {
  membership_id: string
  display_name: string
  share_cents: number
}

interface Gasto {
  id: string
  amount_cents: number
  description: string
  incurred_on: string
  split_mode: string
  status: string
  paid_by: string
  shares: Parte[]
}

async function persona(client: any, nombre: string) {
  const alta = await client.post('/api/v1/auth/signup').json({
    email: `${nombre}@prueba.example`,
    password: CLAVE,
    display_name: nombre,
  })
  alta.assertStatus(201)
  return { token: alta.body().token.value as string, id: alta.body().user.id as string }
}

/** Ana administradora, Bruno y Caro integrantes. Lo minimo para repartir. */
async function grupoDeTres(client: any) {
  const ana = await persona(client, 'ana')
  const bruno = await persona(client, 'bruno')
  const caro = await persona(client, 'caro')

  const creado = await client
    .post('/api/v1/groups')
    .bearerToken(ana.token)
    .json({ name: 'Viaje', currency: 'ARS' })
  creado.assertStatus(201)
  const grupo = creado.body().group

  for (const quien of ['bruno', 'caro']) {
    const alta = await client
      .post(`/api/v1/groups/${grupo.id}/members`)
      .bearerToken(ana.token)
      .json({ email: `${quien}@prueba.example` })
    alta.assertStatus(201)
  }

  const detalle = await client.get(`/api/v1/groups/${grupo.id}`).bearerToken(ana.token)
  const porNombre = (n: string) =>
    detalle.body().members.find((m: { display_name: string }) => m.display_name === n).id as string

  return {
    ana,
    bruno,
    caro,
    grupo,
    membresias: { ana: porNombre('ana'), bruno: porNombre('bruno'), caro: porNombre('caro') },
  }
}

test.group('gastos | alta en los tres modos', (group) => {
  group.each.setup(() => limpiar())
  group.each.teardown(() => limpiar())

  test('en partes iguales, y el centavo que sobra no se tira', async ({ client, assert }) => {
    // $1000,01 entre tres no divide exacto. Lo que se verifica es la invariante
    // de DOM-2 vista desde afuera: la suma de las partes **iguala** el total.
    // A quien le toca el centavo lo decide `desde`, y eso ya lo prueba
    // `tests/unit/reparto.spec.ts`; aca lo que no puede pasar es que el centavo
    // desaparezca o se duplique.
    const g = await grupoDeTres(client)

    const respuesta = await client
      .post(`/api/v1/groups/${g.grupo.id}/expenses`)
      .bearerToken(g.ana.token)
      .json({
        paid_by: g.membresias.ana,
        amount_cents: 100001,
        description: 'Cabaña',
        incurred_on: '2026-11-02',
        split_mode: 'equal',
        shares: [
          { membership_id: g.membresias.ana },
          { membership_id: g.membresias.bruno },
          { membership_id: g.membresias.caro },
        ],
      })
    respuesta.assertStatus(201)

    const gasto: Gasto = respuesta.body().expense
    assert.lengthOf(gasto.shares, 3)
    assert.equal(
      gasto.shares.reduce((acc, p) => acc + p.share_cents, 0),
      100001,
      'las partes tienen que sumar el total exacto, no aproximadamente'
    )
    // Dos llevan 33333 y uno 33334: el centavo esta, en alguna parte.
    assert.includeMembers(
      gasto.shares.map((p) => p.share_cents),
      [33334, 33333, 33333]
    )
  })

  test('el centavo que sobra no cae siempre en el mismo', async ({ client, assert }) => {
    // Esto prueba el **cableado**, no el reparto: que a quien le toca el centavo
    // dependa del gasto y no de la posicion en la lista. `desde` ya lo prueba
    // `tests/unit/reparto.spec.ts` a nivel dominio; lo que no estaba probado era
    // que el controlador se lo pase. Salio de un mutante que sobrevivia: con la
    // rotacion fija en cero, el primero de la lista paga un centavo de mas en
    // **todos** los gastos del grupo que no dividen exacto. Por gasto es nada;
    // sostenido en el tiempo es la razon por la que `desde` existe.
    //
    // El id del gasto lo genera la base, asi que la rotacion es sorteada: doce
    // gastos sobre tres participantes dan una chance de 1 en 177.147 de que los
    // doce caigan en la misma persona de casualidad. Si este test se pone rojo,
    // es eso o es un bug, y conviene mirarlo antes de descartarlo.
    const g = await grupoDeTres(client)
    const participantes = [g.membresias.ana, g.membresias.bruno, g.membresias.caro]

    const quienPagoDeMas = new Set<string>()
    for (let i = 0; i < 12; i++) {
      const creado = await client
        .post(`/api/v1/groups/${g.grupo.id}/expenses`)
        .bearerToken(g.ana.token)
        .json({
          paid_by: g.membresias.ana,
          // 100 entre 3 da 33 y sobra 1.
          amount_cents: 100,
          description: `Cafe ${i}`,
          incurred_on: '2026-11-02',
          split_mode: 'equal',
          shares: participantes.map((id) => ({ membership_id: id })),
        })
      creado.assertStatus(201)

      const partes: Parte[] = creado.body().expense.shares
      const masAlta = partes.reduce((a, b) => (b.share_cents > a.share_cents ? b : a))
      quienPagoDeMas.add(masAlta.membership_id)
    }

    assert.isAbove(
      quienPagoDeMas.size,
      1,
      'el centavo cayo siempre en la misma persona: la rotacion no esta cableada'
    )
  })

  test('en partes iguales se puede dejar afuera a alguien', async ({ client, assert }) => {
    // El modo `equal` no es "entre todos": es "en partes iguales entre estos".
    // Tomas no viajo en ese auto.
    const g = await grupoDeTres(client)

    const respuesta = await client
      .post(`/api/v1/groups/${g.grupo.id}/expenses`)
      .bearerToken(g.ana.token)
      .json({
        paid_by: g.membresias.ana,
        amount_cents: 10000,
        description: 'Nafta',
        incurred_on: '2026-11-02',
        split_mode: 'equal',
        shares: [{ membership_id: g.membresias.ana }, { membership_id: g.membresias.bruno }],
      })
    respuesta.assertStatus(201)

    const gasto: Gasto = respuesta.body().expense
    assert.lengthOf(gasto.shares, 2)
    assert.notInclude(
      gasto.shares.map((p) => p.membership_id),
      g.membresias.caro
    )
  })

  test('por montos exactos', async ({ client, assert }) => {
    const g = await grupoDeTres(client)

    const respuesta = await client
      .post(`/api/v1/groups/${g.grupo.id}/expenses`)
      .bearerToken(g.bruno.token)
      .json({
        paid_by: g.membresias.bruno,
        amount_cents: 96000,
        description: 'Nafta ida y vuelta',
        incurred_on: '2026-11-02',
        split_mode: 'exact',
        shares: [
          { membership_id: g.membresias.ana, amount_cents: 40000 },
          { membership_id: g.membresias.bruno, amount_cents: 40000 },
          { membership_id: g.membresias.caro, amount_cents: 16000 },
        ],
      })
    respuesta.assertStatus(201)

    const gasto: Gasto = respuesta.body().expense
    const deCaro = gasto.shares.find((p) => p.membership_id === g.membresias.caro)!
    assert.equal(deCaro.share_cents, 16000)
    assert.equal(
      gasto.shares.reduce((acc, p) => acc + p.share_cents, 0),
      96000
    )
  })

  test('por porcentajes, con dos decimales', async ({ client, assert }) => {
    // 33,33 + 33,33 + 33,34 = 100. El reparto por mayor residuo decide el
    // centavo; lo que se exige aca es que cierre.
    const g = await grupoDeTres(client)

    const respuesta = await client
      .post(`/api/v1/groups/${g.grupo.id}/expenses`)
      .bearerToken(g.ana.token)
      .json({
        paid_by: g.membresias.ana,
        amount_cents: 73500,
        description: 'Asado',
        incurred_on: '2026-11-04',
        split_mode: 'percentage',
        shares: [
          { membership_id: g.membresias.ana, percentage: '50' },
          { membership_id: g.membresias.bruno, percentage: '33.33' },
          { membership_id: g.membresias.caro, percentage: '16.67' },
        ],
      })
    respuesta.assertStatus(201)

    const gasto: Gasto = respuesta.body().expense
    assert.equal(
      gasto.shares.reduce((acc, p) => acc + p.share_cents, 0),
      73500
    )
    const deAna = gasto.shares.find((p) => p.membership_id === g.membresias.ana)!
    assert.equal(deAna.share_cents, 36750, 'el 50% de $735 es $367,50')
  })

  test('cualquier integrante carga un gasto, no solo el administrador', async ({ client }) => {
    // Es una vaquita: el que pago carga lo que pago. Pedir permiso para eso no
    // tiene sentido y haria que nadie cargue nada.
    const g = await grupoDeTres(client)

    const respuesta = await client
      .post(`/api/v1/groups/${g.grupo.id}/expenses`)
      .bearerToken(g.caro.token)
      .json({
        paid_by: g.membresias.caro,
        amount_cents: 5000,
        description: 'Hielo',
        incurred_on: '2026-11-04',
        split_mode: 'equal',
        shares: [{ membership_id: g.membresias.caro }, { membership_id: g.membresias.ana }],
      })
    respuesta.assertStatus(201)
  })

  test('un gasto que alguien cargo queda en el saldo del grupo', async ({ client, assert }) => {
    // El puente con API-5: si el reparto no llegara a la base como corresponde,
    // los saldos no sumarian cero y `/balances` lo diria.
    const g = await grupoDeTres(client)

    await client
      .post(`/api/v1/groups/${g.grupo.id}/expenses`)
      .bearerToken(g.ana.token)
      .json({
        paid_by: g.membresias.ana,
        amount_cents: 90000,
        description: 'Cabaña',
        incurred_on: '2026-11-02',
        split_mode: 'equal',
        shares: [
          { membership_id: g.membresias.ana },
          { membership_id: g.membresias.bruno },
          { membership_id: g.membresias.caro },
        ],
      })

    const saldos = await client
      .get(`/api/v1/groups/${g.grupo.id}/balances`)
      .bearerToken(g.ana.token)
    saldos.assertStatus(200)
    assert.isTrue(saldos.body().sums_to_zero)

    const deAna = saldos
      .body()
      .balances.find((s: { membership_id: string }) => s.membership_id === g.membresias.ana)
    assert.equal(deAna.balance_cents, 60000, 'Ana puso 900 y le toca 300: le deben 600')
  })
})

test.group('gastos | el borde: forma contra sentido', (group) => {
  group.each.setup(() => limpiar())
  group.each.teardown(() => limpiar())

  /** Un gasto valido al que cada test le cambia una sola cosa. */
  function base(g: Awaited<ReturnType<typeof grupoDeTres>>) {
    return {
      paid_by: g.membresias.ana,
      amount_cents: 30000,
      description: 'Asado',
      incurred_on: '2026-11-04',
      split_mode: 'equal' as string,
      shares: [
        { membership_id: g.membresias.ana },
        { membership_id: g.membresias.bruno },
      ] as Record<string, unknown>[],
    }
  }

  test('la forma mal es 400, con el campo que falla', async ({ client, assert }) => {
    const g = await grupoDeTres(client)

    const casos: { cambio: Record<string, unknown>; campo: string }[] = [
      { cambio: { amount_cents: 0 }, campo: 'amount_cents' },
      { cambio: { amount_cents: -100 }, campo: 'amount_cents' },
      // El monto son centavos **enteros**: un decimal aca es alguien mandando
      // pesos donde van centavos, y aceptarlo divide la plata por cien.
      { cambio: { amount_cents: 300.5 }, campo: 'amount_cents' },
      { cambio: { amount_cents: '30000' }, campo: 'amount_cents' },
      { cambio: { description: '' }, campo: 'description' },
      { cambio: { incurred_on: '04/11/2026' }, campo: 'incurred_on' },
      { cambio: { incurred_on: '2026-02-30' }, campo: 'incurred_on' },
      { cambio: { split_mode: 'mitades' }, campo: 'split_mode' },
      { cambio: { shares: [] }, campo: 'shares' },
    ]

    for (const caso of casos) {
      const respuesta = await client
        .post(`/api/v1/groups/${g.grupo.id}/expenses`)
        .bearerToken(g.ana.token)
        .json({ ...base(g), ...caso.cambio })
      assert.equal(
        respuesta.status(),
        400,
        `${JSON.stringify(caso.cambio)} tendria que ser 400 de forma`
      )
      const campos = respuesta.body().errors.map((e: { field?: string }) => e.field)
      assert.isTrue(
        campos.some((c: string | undefined) => c?.startsWith(caso.campo)),
        `faltaba el error de ${caso.campo}; vinieron ${JSON.stringify(campos)}`
      )
    }
  })

  test('montos exactos que no cierran es 422, con el faltante en el mensaje', async ({
    client,
    assert,
  }) => {
    // La forma esta bien: tres montos enteros positivos. Lo que no cierra es el
    // sentido, y el valor esta en el mensaje: "faltan $120,00" se arregla solo,
    // "los montos no suman" manda a rehacer la cuenta a mano.
    const g = await grupoDeTres(client)

    const respuesta = await client
      .post(`/api/v1/groups/${g.grupo.id}/expenses`)
      .bearerToken(g.ana.token)
      .json({
        ...base(g),
        amount_cents: 30000,
        split_mode: 'exact',
        shares: [
          { membership_id: g.membresias.ana, amount_cents: 10000 },
          { membership_id: g.membresias.bruno, amount_cents: 8000 },
        ],
      })
    respuesta.assertStatus(422)

    const error = respuesta.body().errors[0]
    assert.equal(error.field, 'shares', 'el problema es del conjunto de partes, no de una sola')
    assert.include(error.message, 'faltan', `el mensaje no dice cuanto falta: "${error.message}"`)
    assert.include(error.message, '120', 'el mensaje no dice el monto que falta')
  })

  test('porcentajes que no suman 100 es 422', async ({ client, assert }) => {
    const g = await grupoDeTres(client)

    const respuesta = await client
      .post(`/api/v1/groups/${g.grupo.id}/expenses`)
      .bearerToken(g.ana.token)
      .json({
        ...base(g),
        split_mode: 'percentage',
        shares: [
          { membership_id: g.membresias.ana, percentage: '50' },
          { membership_id: g.membresias.bruno, percentage: '40' },
        ],
      })
    respuesta.assertStatus(422)
    assert.equal(respuesta.body().errors[0].field, 'shares')
  })

  test('un porcentaje con tres decimales senala **su** renglon', async ({ client, assert }) => {
    // Esto es lo que FE-4 necesita: no "hay un error en los porcentajes" sino
    // "el error esta en el segundo renglon". El indice sale del error del
    // dominio, que se levanta al convertir ese porcentaje y no otro.
    const g = await grupoDeTres(client)

    const respuesta = await client
      .post(`/api/v1/groups/${g.grupo.id}/expenses`)
      .bearerToken(g.ana.token)
      .json({
        ...base(g),
        split_mode: 'percentage',
        shares: [
          { membership_id: g.membresias.ana, percentage: '50' },
          { membership_id: g.membresias.bruno, percentage: '50.005' },
        ],
      })
    respuesta.assertStatus(422)
    assert.equal(
      respuesta.body().errors[0].field,
      'shares[1].percentage',
      'el 422 tiene que apuntar al renglon que falla'
    )
  })

  test('la misma persona dos veces en el reparto se rechaza', async ({ client, assert }) => {
    // El UNIQUE de la base lo atrapa, pero como un 500 con el nombre de un
    // indice adentro. Y el trigger de DAT-2 **no** lo veria: dos filas de la
    // misma persona suman igual que una, y lo unico que cambia es su saldo, al
    // doble y en silencio.
    const g = await grupoDeTres(client)

    const respuesta = await client
      .post(`/api/v1/groups/${g.grupo.id}/expenses`)
      .bearerToken(g.ana.token)
      .json({
        ...base(g),
        shares: [{ membership_id: g.membresias.ana }, { membership_id: g.membresias.ana }],
      })
    assert.equal(respuesta.status(), 422)
    assert.equal(respuesta.body().errors[0].field, 'shares[1].membership_id')
    assert.notInclude(JSON.stringify(respuesta.body()), 'expense_shares_uno_por_gasto')
  })

  test('un integrante de otro grupo no entra en el reparto', async ({ client, assert }) => {
    const g = await grupoDeTres(client)
    const otro = await client
      .post('/api/v1/groups')
      .bearerToken(g.ana.token)
      .json({ name: 'Otro', currency: 'ARS' })

    const respuesta = await client
      .post(`/api/v1/groups/${g.grupo.id}/expenses`)
      .bearerToken(g.ana.token)
      .json({
        ...base(g),
        shares: [
          { membership_id: g.membresias.ana },
          { membership_id: otro.body().group.my_membership_id },
        ],
      })
    assert.equal(respuesta.status(), 422)
    assert.equal(respuesta.body().errors[0].field, 'shares[1].membership_id')
  })

  test('el pagador tiene que ser integrante activo del grupo', async ({ client, assert }) => {
    const g = await grupoDeTres(client)

    await client
      .patch(`/api/v1/groups/${g.grupo.id}/members/${g.membresias.caro}`)
      .bearerToken(g.ana.token)
      .json({ active: false })

    const respuesta = await client
      .post(`/api/v1/groups/${g.grupo.id}/expenses`)
      .bearerToken(g.ana.token)
      .json({ ...base(g), paid_by: g.membresias.caro })
    assert.equal(respuesta.status(), 422)
    assert.equal(respuesta.body().errors[0].field, 'paid_by')
  })

  test('un grupo cerrado no recibe gastos nuevos', async ({ client, assert }) => {
    // Cerrar un grupo que sigue aceptando gastos no cierra nada.
    const g = await grupoDeTres(client)
    await client
      .patch(`/api/v1/groups/${g.grupo.id}`)
      .bearerToken(g.ana.token)
      .json({ status: 'closed' })

    const respuesta = await client
      .post(`/api/v1/groups/${g.grupo.id}/expenses`)
      .bearerToken(g.ana.token)
      .json(base(g))
    assert.equal(respuesta.status(), 409)
    assert.equal(respuesta.body().errors[0].rule, 'group_closed')
  })

  test('nada de lo rechazado deja un gasto a medias', async ({ client, assert }) => {
    // El trigger de DAT-2 protege la base, pero el que tiene que no escribir es
    // el repositorio. Despues de todos los rechazos de arriba, el historial
    // tiene que estar vacio.
    const g = await grupoDeTres(client)

    await client
      .post(`/api/v1/groups/${g.grupo.id}/expenses`)
      .bearerToken(g.ana.token)
      .json({
        ...base(g),
        split_mode: 'exact',
        shares: [{ membership_id: g.membresias.ana, amount_cents: 1 }],
      })

    const historial = await client
      .get(`/api/v1/groups/${g.grupo.id}/expenses`)
      .bearerToken(g.ana.token)
    assert.lengthOf(historial.body().expenses, 0)
  })
})

test.group('gastos | edicion y anulacion', (group) => {
  group.each.setup(() => limpiar())
  group.each.teardown(() => limpiar())

  async function conUnGasto(client: any) {
    const g = await grupoDeTres(client)
    const creado = await client
      .post(`/api/v1/groups/${g.grupo.id}/expenses`)
      .bearerToken(g.bruno.token)
      .json({
        paid_by: g.membresias.bruno,
        amount_cents: 30000,
        description: 'Asado',
        incurred_on: '2026-11-04',
        split_mode: 'equal',
        shares: [{ membership_id: g.membresias.ana }, { membership_id: g.membresias.bruno }],
      })
    creado.assertStatus(201)
    return { ...g, gasto: creado.body().expense as Gasto }
  }

  test('editar el monto recalcula el reparto', async ({ client, assert }) => {
    // Es el error mas facil de cometer: cambiar el total y dejar las partes
    // viejas. El trigger de DAT-2 lo rechazaria, asi que si esto devuelve 200
    // el reparto se recalculo de verdad.
    const g = await conUnGasto(client)

    const editado = await client
      .patch(`/api/v1/groups/${g.grupo.id}/expenses/${g.gasto.id}`)
      .bearerToken(g.bruno.token)
      .json({
        amount_cents: 50001,
        split_mode: 'equal',
        shares: [{ membership_id: g.membresias.ana }, { membership_id: g.membresias.bruno }],
      })
    editado.assertStatus(200)

    const gasto: Gasto = editado.body().expense
    assert.equal(gasto.amount_cents, 50001)
    assert.equal(
      gasto.shares.reduce((acc, p) => acc + p.share_cents, 0),
      50001,
      'el reparto quedo con los centavos viejos'
    )
  })

  test('editar solo la descripcion no exige mandar el reparto', async ({ client, assert }) => {
    const g = await conUnGasto(client)

    const editado = await client
      .patch(`/api/v1/groups/${g.grupo.id}/expenses/${g.gasto.id}`)
      .bearerToken(g.bruno.token)
      .json({ description: 'Asado del sabado' })
    editado.assertStatus(200)
    assert.equal(editado.body().expense.description, 'Asado del sabado')
    assert.lengthOf(editado.body().expense.shares, 2)
  })

  test('cambiar el monto sin mandar el reparto se rechaza', async ({ client, assert }) => {
    // La alternativa seria recalcular con las partes viejas, y en modo `exact`
    // eso es imposible de adivinar: los montos de cada uno ya no suman el total
    // nuevo. Mejor pedirlo explicito que inventar un reparto.
    const g = await conUnGasto(client)

    const respuesta = await client
      .patch(`/api/v1/groups/${g.grupo.id}/expenses/${g.gasto.id}`)
      .bearerToken(g.bruno.token)
      .json({ amount_cents: 40000 })
    assert.equal(respuesta.status(), 400)
    assert.equal(respuesta.body().errors[0].rule, 'reparto_incompleto')
  })

  test('el que no lo cargo ni es administrador no lo edita', async ({ client, assert }) => {
    const g = await conUnGasto(client)

    const respuesta = await client
      .patch(`/api/v1/groups/${g.grupo.id}/expenses/${g.gasto.id}`)
      .bearerToken(g.caro.token)
      .json({ description: 'Mio ahora' })
    assert.equal(respuesta.status(), 403)
  })

  test('el administrador edita un gasto que no cargo', async ({ client, assert }) => {
    // Alguien tiene que poder arreglar el gasto que cargo mal el que ya se fue.
    const g = await conUnGasto(client)

    const respuesta = await client
      .patch(`/api/v1/groups/${g.grupo.id}/expenses/${g.gasto.id}`)
      .bearerToken(g.ana.token)
      .json({ description: 'Asado (corregido)' })
    assert.equal(respuesta.status(), 200)
  })

  test('anular no borra: el gasto queda en el historial y no mueve plata', async ({
    client,
    assert,
  }) => {
    const g = await conUnGasto(client)

    const anulado = await client
      .delete(`/api/v1/groups/${g.grupo.id}/expenses/${g.gasto.id}`)
      .bearerToken(g.bruno.token)
    anulado.assertStatus(200)
    assert.equal(anulado.body().expense.status, 'voided')

    // Sigue en el historial, con sus partes.
    const historial = await client
      .get(`/api/v1/groups/${g.grupo.id}/expenses`)
      .bearerToken(g.ana.token)
    assert.lengthOf(historial.body().expenses, 1)
    assert.equal(historial.body().expenses[0].status, 'voided')
    assert.lengthOf(historial.body().expenses[0].shares, 2)

    // Y no mueve un centavo: todos en cero.
    const saldos = await client
      .get(`/api/v1/groups/${g.grupo.id}/balances`)
      .bearerToken(g.ana.token)
    for (const saldo of saldos.body().balances) {
      assert.equal(saldo.balance_cents, 0, `${saldo.display_name} no quedo en cero`)
    }
  })

  test('anular dos veces el mismo gasto da 409', async ({ client, assert }) => {
    const g = await conUnGasto(client)
    const url = `/api/v1/groups/${g.grupo.id}/expenses/${g.gasto.id}`

    await client.delete(url).bearerToken(g.bruno.token)
    const otra = await client.delete(url).bearerToken(g.bruno.token)
    assert.equal(otra.status(), 409)
    assert.equal(otra.body().errors[0].rule, 'already_voided')
  })

  test('un gasto anulado no se edita', async ({ client, assert }) => {
    const g = await conUnGasto(client)
    await client
      .delete(`/api/v1/groups/${g.grupo.id}/expenses/${g.gasto.id}`)
      .bearerToken(g.bruno.token)

    const respuesta = await client
      .patch(`/api/v1/groups/${g.grupo.id}/expenses/${g.gasto.id}`)
      .bearerToken(g.bruno.token)
      .json({ description: 'Revivido' })
    assert.equal(respuesta.status(), 409)
  })

  test('un gasto ajeno responde lo mismo que un gasto inexistente', async ({ client, assert }) => {
    // El test de abajo no alcanza, y salio de un mutante que sobrevivia: sin el
    // filtro por grupo en la **lectura**, el `UPDATE` igual filtra y la
    // respuesta sale 404 de todos modos. Pero cualquier rama que corra antes del
    // UPDATE si cambia la respuesta y filtra que ese gasto existe en otro lado:
    // un gasto anulado contesta 409, y a quien no tiene rol le contesta 403.
    //
    // Por eso aca no se afirma "da 404": se compara contra un id que no existe,
    // que es la misma condicion que API-8 pide para los grupos.
    const g = await conUnGasto(client)
    const INEXISTENTE = '99999999-9999-4999-8999-999999999999'

    // Un gasto **anulado** en el grupo de Ana y Bruno.
    await client
      .delete(`/api/v1/groups/${g.grupo.id}/expenses/${g.gasto.id}`)
      .bearerToken(g.bruno.token)

    // Otro grupo: Ana administradora, Caro integrante sin rol.
    const creado = await client
      .post('/api/v1/groups')
      .bearerToken(g.ana.token)
      .json({ name: 'Otro', currency: 'ARS' })
    const otro = creado.body().group
    await client
      .post(`/api/v1/groups/${otro.id}/members`)
      .bearerToken(g.ana.token)
      .json({ email: 'caro@prueba.example' })

    for (const [quien, token] of [
      ['la administradora', g.ana.token],
      ['un integrante sin rol', g.caro.token],
    ] as const) {
      const ajeno = await client
        .patch(`/api/v1/groups/${otro.id}/expenses/${g.gasto.id}`)
        .bearerToken(token)
        .json({ description: 'Cruzado' })
      const fantasma = await client
        .patch(`/api/v1/groups/${otro.id}/expenses/${INEXISTENTE}`)
        .bearerToken(token)
        .json({ description: 'Cruzado' })

      assert.equal(
        ajeno.status(),
        fantasma.status(),
        `para ${quien}, el status delata que ese gasto existe en otro grupo`
      )
      assert.deepEqual(ajeno.body(), fantasma.body(), `para ${quien}, el cuerpo lo delata`)
    }
  })

  test('un gasto de otro grupo no se toca desde este', async ({ client, assert }) => {
    // El `:eid` lo escribe el cliente. Sin filtrar por grupo, ser integrante de
    // un grupo cualquiera alcanzaria para editar los gastos de todos los demas.
    const g = await conUnGasto(client)
    const otro = await client
      .post('/api/v1/groups')
      .bearerToken(g.ana.token)
      .json({ name: 'Otro', currency: 'ARS' })

    const respuesta = await client
      .patch(`/api/v1/groups/${otro.body().group.id}/expenses/${g.gasto.id}`)
      .bearerToken(g.ana.token)
      .json({ description: 'Cruzado' })
    assert.equal(respuesta.status(), 404)

    // Y el gasto original quedo intacto.
    const historial = await client
      .get(`/api/v1/groups/${g.grupo.id}/expenses`)
      .bearerToken(g.ana.token)
    assert.equal(historial.body().expenses[0].description, 'Asado')
  })
})

test.group('gastos | el historial', (group) => {
  group.each.setup(() => limpiar())
  group.each.teardown(() => limpiar())

  test('viene paginado y con los anulados adentro', async ({ client, assert }) => {
    const g = await grupoDeTres(client)

    for (const [indice, dia] of ['01', '02', '03'].entries()) {
      await client
        .post(`/api/v1/groups/${g.grupo.id}/expenses`)
        .bearerToken(g.ana.token)
        .json({
          paid_by: g.membresias.ana,
          amount_cents: 1000 * (indice + 1),
          description: `Gasto ${dia}`,
          incurred_on: `2026-11-${dia}`,
          split_mode: 'equal',
          shares: [{ membership_id: g.membresias.ana }, { membership_id: g.membresias.bruno }],
        })
    }

    const primera = await client
      .get(`/api/v1/groups/${g.grupo.id}/expenses?page=1&per_page=2`)
      .bearerToken(g.ana.token)
    primera.assertStatus(200)
    assert.lengthOf(primera.body().expenses, 2)
    assert.equal(primera.body().total, 3)

    const segunda = await client
      .get(`/api/v1/groups/${g.grupo.id}/expenses?page=2&per_page=2`)
      .bearerToken(g.ana.token)
    assert.lengthOf(segunda.body().expenses, 1)

    // Los mas nuevos primero: es la pantalla principal del grupo.
    assert.equal(primera.body().expenses[0].description, 'Gasto 03')
  })

  test('el historial de un grupo no trae gastos de otro', async ({ client, assert }) => {
    const g = await grupoDeTres(client)
    await client
      .post(`/api/v1/groups/${g.grupo.id}/expenses`)
      .bearerToken(g.ana.token)
      .json({
        paid_by: g.membresias.ana,
        amount_cents: 10000,
        description: 'El de este grupo',
        incurred_on: '2026-11-04',
        split_mode: 'equal',
        shares: [{ membership_id: g.membresias.ana }],
      })

    const otro = await client
      .post('/api/v1/groups')
      .bearerToken(g.ana.token)
      .json({ name: 'Otro', currency: 'ARS' })
    const historial = await client
      .get(`/api/v1/groups/${otro.body().group.id}/expenses`)
      .bearerToken(g.ana.token)
    assert.lengthOf(historial.body().expenses, 0)
  })
})
