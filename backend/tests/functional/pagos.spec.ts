import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'

/**
 * API-7 — registrar una transferencia como hecha.
 *
 * Es el endpoint mas chico del proyecto y el que cierra el recorrido: sin el,
 * los saldos nunca bajan y el plan de cierre se repite igual para siempre.
 * Vaquita **no mueve plata**: esta fila dice que la plata se movio afuera.
 *
 * Lo que estos tests vigilan no es el alta, que es un INSERT, sino las tres
 * preguntas que el alta obliga a contestar:
 *
 * - **Quien puede decir que un pago ocurrio.** Solo quien lo vio: el pagador, el
 *   cobrador, o un administrador. Un cuarto integrante registrando plata ajena
 *   es la forma mas facil de ensuciar los saldos de todos.
 * - **Que es un pago imposible.** Contra uno mismo, o contra alguien que no es
 *   del grupo: los dos son 422, y el `field` dice cual de los dos extremos
 *   falla.
 * - **Que el pago efectivamente mueve el saldo.** Un 201 que no cambia
 *   `balances` seria un endpoint decorativo.
 */

const CLAVE = 'una-clave-de-prueba-larga'

async function limpiar() {
  // Los pagos primero: apuntan a membresias con FK compuesta y las bloquean.
  await db.rawQuery(
    `DELETE FROM payments WHERE group_id IN
       (SELECT id FROM groups WHERE created_by IN
          (SELECT id FROM users WHERE email LIKE '%@prueba.example'))`
  )
  // Y los gastos antes que sus partes, que es la regla desde DAT-2.
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

async function persona(client: any, nombre: string) {
  const alta = await client.post('/api/v1/auth/signup').json({
    email: `${nombre}@prueba.example`,
    password: CLAVE,
    display_name: nombre,
  })
  alta.assertStatus(201)
  return { token: alta.body().token.value as string, id: alta.body().user.id as string }
}

/**
 * Ana administradora, Bruno y Caro integrantes, y un gasto de $300 que Ana pago
 * por los tres. Deja a Bruno y a Caro debiendole $100 a Ana: lo minimo para que
 * un pago tenga algo que cerrar.
 */
async function grupoConDeuda(client: any) {
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
  const membresias = { ana: porNombre('ana'), bruno: porNombre('bruno'), caro: porNombre('caro') }

  const gasto = await client
    .post(`/api/v1/groups/${grupo.id}/expenses`)
    .bearerToken(ana.token)
    .json({
      description: 'Cabana',
      amount_cents: 30000,
      incurred_on: '2026-11-20',
      paid_by: membresias.ana,
      split_mode: 'equal',
      shares: [
        { membership_id: membresias.ana },
        { membership_id: membresias.bruno },
        { membership_id: membresias.caro },
      ],
    })
  gasto.assertStatus(201)

  return { ana, bruno, caro, grupo, membresias }
}

async function saldoDe(client: any, grupoId: string, token: string, membresiaId: string) {
  const balances = await client.get(`/api/v1/groups/${grupoId}/balances`).bearerToken(token)
  balances.assertStatus(200)
  const fila = balances
    .body()
    .balances.find((b: { membership_id: string }) => b.membership_id === membresiaId)
  return fila.balance_cents as number
}

test.group('pagos | quien puede registrarlo', (group) => {
  group.each.setup(() => limpiar())
  group.each.teardown(() => limpiar())

  test('el pagador registra su propia transferencia y el saldo se mueve', async ({
    client,
    assert,
  }) => {
    const { bruno, grupo, membresias } = await grupoConDeuda(client)

    const antes = await saldoDe(client, grupo.id, bruno.token, membresias.bruno)
    assert.equal(antes, -10000, 'Bruno deberia deber $100 antes de pagar')

    const pago = await client
      .post(`/api/v1/groups/${grupo.id}/payments`)
      .bearerToken(bruno.token)
      .json({
        from_membership_id: membresias.bruno,
        to_membership_id: membresias.ana,
        amount_cents: 10000,
      })

    pago.assertStatus(201)
    const cuerpo = pago.body().payment
    assert.equal(cuerpo.from_membership_id, membresias.bruno)
    assert.equal(cuerpo.to_membership_id, membresias.ana)
    assert.equal(cuerpo.amount_cents, 10000)
    // Quien confirma queda registrado, y es quien mando el pedido: es el unico
    // dato que permite auditar despues quien dijo que la plata se movio.
    assert.equal(cuerpo.confirmed_by, membresias.bruno)
    assert.isString(cuerpo.confirmed_at)
    assert.isString(cuerpo.id)

    const despues = await saldoDe(client, grupo.id, bruno.token, membresias.bruno)
    assert.equal(despues, 0, 'el pago no movio el saldo de Bruno')
  })

  test('el cobrador tambien puede registrarlo', async ({ client, assert }) => {
    const { ana, grupo, membresias } = await grupoConDeuda(client)

    const pago = await client
      .post(`/api/v1/groups/${grupo.id}/payments`)
      .bearerToken(ana.token)
      .json({
        from_membership_id: membresias.bruno,
        to_membership_id: membresias.ana,
        amount_cents: 10000,
      })

    pago.assertStatus(201)
    assert.equal(pago.body().payment.confirmed_by, membresias.ana)
  })

  test('un administrador ajeno al pago puede registrarlo', async ({ client, assert }) => {
    const { ana, grupo, membresias } = await grupoConDeuda(client)

    // Ana es administradora y no es parte de este pago: Bruno le paga a Caro.
    const pago = await client
      .post(`/api/v1/groups/${grupo.id}/payments`)
      .bearerToken(ana.token)
      .json({
        from_membership_id: membresias.bruno,
        to_membership_id: membresias.caro,
        amount_cents: 5000,
      })

    pago.assertStatus(201)
    assert.equal(pago.body().payment.confirmed_by, membresias.ana)
  })

  test('un integrante que no es parte ni administrador recibe 403', async ({ client, assert }) => {
    const { caro, grupo, membresias } = await grupoConDeuda(client)

    // Caro es integrante comun y el pago es entre Bruno y Ana: no lo vio.
    const pago = await client
      .post(`/api/v1/groups/${grupo.id}/payments`)
      .bearerToken(caro.token)
      .json({
        from_membership_id: membresias.bruno,
        to_membership_id: membresias.ana,
        amount_cents: 10000,
      })

    pago.assertStatus(403)
    assert.equal(pago.body().errors[0].rule, 'forbidden_role')

    // Y el saldo de Bruno sigue intacto: el 403 no escribio nada.
    const saldo = await saldoDe(client, grupo.id, caro.token, membresias.bruno)
    assert.equal(saldo, -10000)
  })

  test('a quien no puede, no se le corrige el cuerpo', async ({ client, assert }) => {
    // Salio de un mutante que sobrevivio: revisar las referencias antes del
    // permiso no rompia ningun test. No es una fuga —la lista de membresias ya
    // es publica para cualquier integrante— pero hace que la respuesta a quien
    // no tiene permiso dependa de si ademas acerto los ids. Se le contesta que
    // no puede, y listo.
    const { caro, grupo, membresias } = await grupoConDeuda(client)

    const pago = await client
      .post(`/api/v1/groups/${grupo.id}/payments`)
      .bearerToken(caro.token)
      .json({
        from_membership_id: membresias.bruno,
        to_membership_id: '99999999-8888-4777-8666-555555555555',
        amount_cents: 10000,
      })

    pago.assertStatus(403)
    assert.equal(pago.body().errors[0].rule, 'forbidden_role')
  })
})

test.group('pagos | el pago imposible', (group) => {
  group.each.setup(() => limpiar())
  group.each.teardown(() => limpiar())

  test('un pago contra uno mismo es 422 y dice cual extremo falla', async ({ client, assert }) => {
    const { bruno, grupo, membresias } = await grupoConDeuda(client)

    const pago = await client
      .post(`/api/v1/groups/${grupo.id}/payments`)
      .bearerToken(bruno.token)
      .json({
        from_membership_id: membresias.bruno,
        to_membership_id: membresias.bruno,
        amount_cents: 10000,
      })

    pago.assertStatus(422)
    assert.equal(pago.body().errors[0].field, 'to_membership_id')
    assert.equal(pago.body().errors[0].rule, 'same_membership')
  })

  test('una membresia de otro grupo es 422, no un 500 de la base', async ({ client, assert }) => {
    const { bruno, grupo, membresias } = await grupoConDeuda(client)

    // Un grupo aparte, con su propia membresia: existe, pero no es de este
    // grupo. Sin la revision previa, la FK compuesta lo rechaza con un 500.
    const otro = await client
      .post('/api/v1/groups')
      .bearerToken(bruno.token)
      .json({ name: 'Otro', currency: 'ARS' })
    otro.assertStatus(201)
    const ajena = otro.body().group.my_membership_id

    const pago = await client
      .post(`/api/v1/groups/${grupo.id}/payments`)
      .bearerToken(bruno.token)
      .json({
        from_membership_id: membresias.bruno,
        to_membership_id: ajena,
        amount_cents: 10000,
      })

    pago.assertStatus(422)
    assert.equal(pago.body().errors[0].field, 'to_membership_id')
    assert.equal(pago.body().errors[0].rule, 'unknown_membership')
  })

  test('un integrante desactivado no puede cobrar', async ({ client, assert }) => {
    const { ana, bruno, grupo, membresias } = await grupoConDeuda(client)

    const baja = await client
      .patch(`/api/v1/groups/${grupo.id}/members/${membresias.caro}`)
      .bearerToken(ana.token)
      .json({ active: false })
    baja.assertStatus(200)

    const pago = await client
      .post(`/api/v1/groups/${grupo.id}/payments`)
      .bearerToken(bruno.token)
      .json({
        from_membership_id: membresias.bruno,
        to_membership_id: membresias.caro,
        amount_cents: 10000,
      })

    pago.assertStatus(422)
    assert.equal(pago.body().errors[0].field, 'to_membership_id')
  })

  test('la forma mal es 400, y el cero no pasa', async ({ client, assert }) => {
    const { bruno, grupo, membresias } = await grupoConDeuda(client)

    const base = { from_membership_id: membresias.bruno, to_membership_id: membresias.ana }
    const malos: Record<string, unknown>[] = [
      { ...base, amount_cents: 0 },
      { ...base, amount_cents: -10000 },
      { ...base, amount_cents: 100.5 },
      { ...base, amount_cents: '10000' },
      { from_membership_id: membresias.bruno, amount_cents: 10000 },
      { ...base, from_membership_id: 'no-es-un-uuid', amount_cents: 10000 },
    ]

    for (const cuerpo of malos) {
      const pago = await client
        .post(`/api/v1/groups/${grupo.id}/payments`)
        .bearerToken(bruno.token)
        .json(cuerpo)
      pago.assertStatus(400)
      assert.isArray(pago.body().errors, `${JSON.stringify(cuerpo)} no devolvio la forma de error`)
    }
  })

  test('un grupo cerrado no acepta pagos', async ({ client, assert }) => {
    const { ana, bruno, grupo, membresias } = await grupoConDeuda(client)

    const cierre = await client
      .patch(`/api/v1/groups/${grupo.id}`)
      .bearerToken(ana.token)
      .json({ status: 'closed' })
    cierre.assertStatus(200)

    const pago = await client
      .post(`/api/v1/groups/${grupo.id}/payments`)
      .bearerToken(bruno.token)
      .json({
        from_membership_id: membresias.bruno,
        to_membership_id: membresias.ana,
        amount_cents: 10000,
      })

    pago.assertStatus(409)
    assert.equal(pago.body().errors[0].rule, 'group_closed')
  })
})

test.group('pagos | la ruta hereda la proteccion del grupo', (group) => {
  group.each.setup(() => limpiar())
  group.each.teardown(() => limpiar())

  test('sin token da 401', async ({ client }) => {
    const { grupo, membresias } = await grupoConDeuda(client)

    const pago = await client.post(`/api/v1/groups/${grupo.id}/payments`).json({
      from_membership_id: membresias.bruno,
      to_membership_id: membresias.ana,
      amount_cents: 10000,
    })

    pago.assertStatus(401)
  })

  test('un grupo ajeno contesta igual que uno inexistente', async ({ client, assert }) => {
    const { grupo, membresias } = await grupoConDeuda(client)
    const ajeno = await persona(client, 'extrana')

    const cuerpo = {
      from_membership_id: membresias.bruno,
      to_membership_id: membresias.ana,
      amount_cents: 10000,
    }

    const enAjeno = await client
      .post(`/api/v1/groups/${grupo.id}/payments`)
      .bearerToken(ajeno.token)
      .json(cuerpo)
    const enInexistente = await client
      .post(`/api/v1/groups/11111111-2222-4333-8444-555555555555/payments`)
      .bearerToken(ajeno.token)
      .json(cuerpo)

    enAjeno.assertStatus(404)
    assert.equal(enInexistente.status(), enAjeno.status())
    assert.deepEqual(enInexistente.body(), enAjeno.body())
  })
})

test.group('pagos | el pago repetido', (group) => {
  group.each.setup(() => limpiar())
  group.each.teardown(() => limpiar())

  async function pagar(client: any, grupo: any, token: string, cuerpo: Record<string, unknown>) {
    return client.post(`/api/v1/groups/${grupo.id}/payments`).bearerToken(token).json(cuerpo)
  }

  test('el segundo pago identico es 409 y no cobra dos veces', async ({ client, assert }) => {
    // El doble click sobre "ya transferi" es el riesgo real de este endpoint:
    // deja a alguien con saldo a favor que nadie le debe.
    const { bruno, grupo, membresias } = await grupoConDeuda(client)
    const cuerpo = {
      from_membership_id: membresias.bruno,
      to_membership_id: membresias.ana,
      amount_cents: 10000,
    }

    const primero = await pagar(client, grupo, bruno.token, cuerpo)
    primero.assertStatus(201)

    const segundo = await pagar(client, grupo, bruno.token, cuerpo)
    segundo.assertStatus(409)
    assert.equal(segundo.body().errors[0].rule, 'duplicate_payment')
    // Y dice cual es el que ya existe, para que el cliente pueda mostrarlo
    // antes de insistir: un 409 a secas obliga a adivinar que paso.
    assert.equal(segundo.body().existing_payment.id, primero.body().payment.id)

    const saldo = await saldoDe(client, grupo.id, bruno.token, membresias.bruno)
    assert.equal(saldo, 0, 'el pago se registro dos veces')
  })

  test('con allow_duplicate el pago repetido entra', async ({ client, assert }) => {
    const { bruno, grupo, membresias } = await grupoConDeuda(client)
    const cuerpo = {
      from_membership_id: membresias.bruno,
      to_membership_id: membresias.ana,
      amount_cents: 10000,
    }

    const primero = await pagar(client, grupo, bruno.token, cuerpo)
    primero.assertStatus(201)

    const segundo = await pagar(client, grupo, bruno.token, { ...cuerpo, allow_duplicate: true })
    segundo.assertStatus(201)
    assert.notEqual(segundo.body().payment.id, primero.body().payment.id)

    const saldo = await saldoDe(client, grupo.id, bruno.token, membresias.bruno)
    assert.equal(saldo, 10000, 'los dos pagos tendrian que haber movido el saldo')
  })

  test('un pago de otro monto no es un repetido', async ({ client }) => {
    // La guarda mira los tres campos. Si mirara solo las dos membresias,
    // bloquearia pagos distintos entre las mismas dos personas.
    const { bruno, grupo, membresias } = await grupoConDeuda(client)
    const base = { from_membership_id: membresias.bruno, to_membership_id: membresias.ana }

    const primero = await pagar(client, grupo, bruno.token, { ...base, amount_cents: 10000 })
    primero.assertStatus(201)

    const otro = await pagar(client, grupo, bruno.token, { ...base, amount_cents: 2500 })
    otro.assertStatus(201)
  })

  test('el repetido al reves es un pago distinto', async ({ client }) => {
    // Bruno le paga a Ana y despues Ana le paga a Bruno el mismo monto: son dos
    // movimientos opuestos, no una repeticion.
    const { ana, bruno, grupo, membresias } = await grupoConDeuda(client)

    const ida = await pagar(client, grupo, bruno.token, {
      from_membership_id: membresias.bruno,
      to_membership_id: membresias.ana,
      amount_cents: 10000,
    })
    ida.assertStatus(201)

    const vuelta = await pagar(client, grupo, ana.token, {
      from_membership_id: membresias.ana,
      to_membership_id: membresias.bruno,
      amount_cents: 10000,
    })
    vuelta.assertStatus(201)
  })
})

test.group('pagos | lo que el pago deja', (group) => {
  group.each.setup(() => limpiar())
  group.each.teardown(() => limpiar())

  test('el pago cuenta en los totales del grupo', async ({ client, assert }) => {
    const { ana, bruno, grupo, membresias } = await grupoConDeuda(client)

    const pago = await client
      .post(`/api/v1/groups/${grupo.id}/payments`)
      .bearerToken(bruno.token)
      .json({
        from_membership_id: membresias.bruno,
        to_membership_id: membresias.ana,
        amount_cents: 10000,
      })
    pago.assertStatus(201)

    const detalle = await client.get(`/api/v1/groups/${grupo.id}`).bearerToken(ana.token)
    assert.equal(detalle.body().totals.payment_count, 1)
  })

  test('pagar mas que la deuda se registra igual y da vuelta el saldo', async ({
    client,
    assert,
  }) => {
    // Decision, no descuido: la fila dice que la plata se movio afuera, y eso
    // es cierto aunque sea de mas. Rechazarlo obligaria a Vaquita a tener una
    // opinion sobre plata que no vio, y la deuda al reves es un hecho real que
    // el proximo plan de cierre resuelve solo.
    const { bruno, grupo, membresias } = await grupoConDeuda(client)

    const pago = await client
      .post(`/api/v1/groups/${grupo.id}/payments`)
      .bearerToken(bruno.token)
      .json({
        from_membership_id: membresias.bruno,
        to_membership_id: membresias.ana,
        amount_cents: 15000,
      })
    pago.assertStatus(201)

    const saldo = await saldoDe(client, grupo.id, bruno.token, membresias.bruno)
    assert.equal(saldo, 5000, 'Ana le quedo debiendo a Bruno la diferencia')
  })
})
