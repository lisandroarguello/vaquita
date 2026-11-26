import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'

/**
 * API-2 — alta de grupos, lectura y administracion de membresias, por HTTP.
 *
 * El hecho que ordena todo este ticket: **la membresia es la unidad de
 * autorizacion**, asi que crear un grupo y crear su primera membresia no pueden
 * ser dos operaciones. Un grupo sin membresias no es un grupo vacio: es un grupo
 * al que su propio creador recibe 404 (API-8 no distingue "no existe" de "no sos
 * parte"), y nadie puede volver a entrar nunca. Por eso hay un test que fuerza
 * el fallo del segundo INSERT y exige que no quede el grupo colgado.
 *
 * La otra mitad es la distincion de status que API-8 dejo planteada: **falta de
 * pertenencia es 404; falta de rol es 403.** Ya ser integrante te dice que el
 * grupo existe, asi que el 403 no filtra nada que no sepas.
 */

const CLAVE = 'una-clave-de-prueba-larga'

async function limpiar() {
  // Las membresias y los grupos de los usuarios de prueba, antes que los
  // usuarios: las FK van en ese orden.
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

/** Alguien registrado, con su token. El camino real, no uno fabricado. */
async function persona(client: any, nombre: string) {
  const alta = await client.post('/api/v1/auth/signup').json({
    email: `${nombre}@prueba.example`,
    password: CLAVE,
    display_name: nombre,
  })
  alta.assertStatus(201)
  return { token: alta.body().token.value as string, id: alta.body().user.id as string }
}

async function crearGrupo(client: any, token: string, name = 'Asado del sabado') {
  const respuesta = await client
    .post('/api/v1/groups')
    .bearerToken(token)
    .json({ name, currency: 'ARS' })
  return respuesta
}

/** El grupo recien creado, ya desenvuelto: es lo que casi todos los tests usan. */
async function grupoNuevo(client: any, token: string, name = 'Asado del sabado') {
  const respuesta = await crearGrupo(client, token, name)
  respuesta.assertStatus(201)
  return respuesta.body().group
}

test.group('grupos | crear un grupo', (group) => {
  group.each.setup(() => limpiar())
  group.each.teardown(() => limpiar())

  test('crear un grupo deja a quien lo creo adentro y como administrador', async ({
    client,
    assert,
  }) => {
    const ana = await persona(client, 'ana')
    const respuesta = await crearGrupo(client, ana.token)
    respuesta.assertStatus(201)

    const cuerpo = respuesta.body()
    assert.isString(cuerpo.group.id)
    assert.equal(cuerpo.group.name, 'Asado del sabado')
    assert.equal(cuerpo.group.currency, 'ARS')
    assert.equal(cuerpo.group.status, 'open')
    assert.equal(cuerpo.group.my_role, 'admin')
    assert.isString(cuerpo.group.my_membership_id)

    // Y lo puede leer en el acto: si la primera membresia no se hubiera creado,
    // esto seria un 404 contra su propio grupo.
    const detalle = await client.get(`/api/v1/groups/${cuerpo.group.id}`).bearerToken(ana.token)
    detalle.assertStatus(200)
    assert.lengthOf(detalle.body().members, 1)
    assert.equal(detalle.body().members[0].display_name, 'ana')
  })

  test('el grupo y su primera membresia se crean juntos o no se crean', async ({
    client,
    assert,
  }) => {
    // Se fuerza el fallo del segundo INSERT con un rol que el CHECK de la base
    // rechaza. Lo que se verifica no es el error —es esperado— sino que **no
    // quede el grupo sin membresias**: un grupo asi le da 404 a su propio
    // creador y no hay forma de volver a entrar.
    const ana = await persona(client, 'ana')
    const { crearGrupoConMembresia } = await import('#repositories/grupo_repository')

    const antes = await db.rawQuery(`SELECT count(*)::int AS n FROM groups`)

    await assert.rejects(async () => {
      await crearGrupoConMembresia({
        nombre: 'El que no tiene que quedar',
        moneda: 'ARS',
        creadorId: ana.id,
        // @ts-expect-error -- a proposito: el CHECK `memberships_rol_conocido`
        // tiene que hacer fallar la transaccion entera.
        rol: 'emperador',
      })
    })

    const despues = await db.rawQuery(`SELECT count(*)::int AS n FROM groups`)
    assert.equal(
      despues.rows[0].n,
      antes.rows[0].n,
      'quedo un grupo sin membresias: la escritura no es atomica'
    )
  })

  test('sin sesion no se puede crear un grupo', async ({ client }) => {
    const respuesta = await client.post('/api/v1/groups').json({ name: 'Ajeno' })
    respuesta.assertStatus(401)
  })

  test('el nombre y la moneda se validan en el borde', async ({ client, assert }) => {
    const ana = await persona(client, 'ana')

    const casos: { payload: Record<string, unknown>; campo: string }[] = [
      { payload: { name: '' }, campo: 'name' },
      { payload: { name: '   ' }, campo: 'name' },
      { payload: { name: 'Viaje', currency: 'pesos' }, campo: 'currency' },
      { payload: { name: 'Viaje', currency: 'ars' }, campo: 'currency' },
    ]

    for (const caso of casos) {
      const respuesta = await client
        .post('/api/v1/groups')
        .bearerToken(ana.token)
        .json(caso.payload)
      respuesta.assertStatus(400)
      const campos = respuesta.body().errors.map((e: { field?: string }) => e.field)
      assert.include(campos, caso.campo, `faltaba el error de ${caso.campo}`)
    }
  })

  test('la moneda por omision es ARS', async ({ client, assert }) => {
    const ana = await persona(client, 'ana')
    const respuesta = await client.post('/api/v1/groups').bearerToken(ana.token).json({
      name: 'Sin moneda explicita',
    })
    respuesta.assertStatus(201)
    assert.equal(respuesta.body().group.currency, 'ARS')
  })
})

test.group('grupos | listar los propios', (group) => {
  group.each.setup(() => limpiar())
  group.each.teardown(() => limpiar())

  test('cada uno ve sus grupos y ninguno ajeno', async ({ client, assert }) => {
    const ana = await persona(client, 'ana')
    const bruno = await persona(client, 'bruno')

    const deAna = await crearGrupo(client, ana.token, 'El de Ana')
    await crearGrupo(client, bruno.token, 'El de Bruno')

    const lista = await client.get('/api/v1/groups').bearerToken(ana.token)
    lista.assertStatus(200)

    const nombres = lista.body().groups.map((g: { name: string }) => g.name)
    assert.deepEqual(nombres, ['El de Ana'])
    assert.equal(lista.body().groups[0].id, deAna.body().group.id)
  })

  test('el listado trae el saldo propio en cada grupo', async ({ client, assert }) => {
    // Un grupo recien creado, sin gastos: el saldo es cero y `sums_to_zero` es
    // verdadero. Cuando haya gastos (API-4) el numero cambia; que el campo este
    // y sea un entero es lo que el listado promete.
    const ana = await persona(client, 'ana')
    await crearGrupo(client, ana.token)

    const lista = await client.get('/api/v1/groups').bearerToken(ana.token)
    const grupo = lista.body().groups[0]
    assert.equal(grupo.my_balance_cents, 0)
    assert.equal(grupo.member_count, 1)
    assert.equal(grupo.my_role, 'admin')
  })

  test('un grupo del que te desactivaron no aparece en el listado', async ({ client, assert }) => {
    const ana = await persona(client, 'ana')
    const grupo = await crearGrupo(client, ana.token)

    await db.rawQuery(`UPDATE memberships SET active = false WHERE group_id = ?`, [
      grupo.body().group.id,
    ])

    const lista = await client.get('/api/v1/groups').bearerToken(ana.token)
    assert.lengthOf(lista.body().groups, 0)
  })
})

test.group('grupos | renombrar y cerrar', (group) => {
  group.each.setup(() => limpiar())
  group.each.teardown(() => limpiar())

  test('el administrador renombra y cierra el grupo', async ({ client, assert }) => {
    const ana = await persona(client, 'ana')
    const grupo = await grupoNuevo(client, ana.token)

    const renombrado = await client
      .patch(`/api/v1/groups/${grupo.id}`)
      .bearerToken(ana.token)
      .json({ name: 'Asado del domingo' })
    renombrado.assertStatus(200)
    assert.equal(renombrado.body().group.name, 'Asado del domingo')

    const cerrado = await client
      .patch(`/api/v1/groups/${grupo.id}`)
      .bearerToken(ana.token)
      .json({ status: 'closed' })
    cerrado.assertStatus(200)
    assert.equal(cerrado.body().group.status, 'closed')
    // Renombrar no se perdio al cambiar el estado.
    assert.equal(cerrado.body().group.name, 'Asado del domingo')
  })

  test('un integrante sin rol recibe 403, no 404', async ({ client, assert }) => {
    // Aca el 403 es legitimo y la diferencia con API-8 es la que importa: quien
    // pregunta **ya sabe** que el grupo existe, porque es integrante. El 404
    // seria una mentira sin nada que proteger.
    const ana = await persona(client, 'ana')
    const bruno = await persona(client, 'bruno')
    const grupo = await grupoNuevo(client, ana.token)

    await client
      .post(`/api/v1/groups/${grupo.id}/members`)
      .bearerToken(ana.token)
      .json({ email: 'bruno@prueba.example' })

    const intento = await client
      .patch(`/api/v1/groups/${grupo.id}`)
      .bearerToken(bruno.token)
      .json({ name: 'Mio ahora' })
    intento.assertStatus(403)
    assert.equal(intento.body().errors[0].rule, 'forbidden_role')

    // Y el nombre no se movio.
    const detalle = await client.get(`/api/v1/groups/${grupo.id}`).bearerToken(bruno.token)
    assert.equal(detalle.body().group.name, 'Asado del sabado')
  })

  test('un estado que no existe se rechaza en el borde', async ({ client, assert }) => {
    const ana = await persona(client, 'ana')
    const grupo = await grupoNuevo(client, ana.token)

    const respuesta = await client
      .patch(`/api/v1/groups/${grupo.id}`)
      .bearerToken(ana.token)
      .json({ status: 'archivado' })
    respuesta.assertStatus(400)
    assert.include(
      respuesta.body().errors.map((e: { field?: string }) => e.field),
      'status'
    )
  })

  test('un PATCH vacio no es un 200 que no hizo nada', async ({ client }) => {
    // Devolver 200 a un PATCH sin campos le dice al cliente que algo cambio.
    const ana = await persona(client, 'ana')
    const grupo = await grupoNuevo(client, ana.token)

    const respuesta = await client
      .patch(`/api/v1/groups/${grupo.id}`)
      .bearerToken(ana.token)
      .json({})
    respuesta.assertStatus(400)
  })
})

test.group('grupos | integrantes', (group) => {
  group.each.setup(() => limpiar())
  group.each.teardown(() => limpiar())

  test('el administrador agrega a alguien por mail', async ({ client, assert }) => {
    const ana = await persona(client, 'ana')
    const bruno = await persona(client, 'bruno')
    const grupo = await grupoNuevo(client, ana.token)

    const alta = await client
      .post(`/api/v1/groups/${grupo.id}/members`)
      .bearerToken(ana.token)
      .json({ email: 'BRUNO@prueba.example' })
    alta.assertStatus(201)
    assert.equal(alta.body().member.display_name, 'bruno')
    assert.equal(alta.body().member.role, 'member')

    // Y Bruno ya ve el grupo, que es lo unico que prueba que la membresia sirve.
    const suyo = await client.get('/api/v1/groups').bearerToken(bruno.token)
    assert.lengthOf(suyo.body().groups, 1)
    assert.equal(suyo.body().groups[0].my_role, 'member')
  })

  test('un integrante sin rol no agrega a nadie', async ({ client }) => {
    const ana = await persona(client, 'ana')
    const bruno = await persona(client, 'bruno')
    await persona(client, 'caro')
    const grupo = await grupoNuevo(client, ana.token)

    await client
      .post(`/api/v1/groups/${grupo.id}/members`)
      .bearerToken(ana.token)
      .json({ email: 'bruno@prueba.example' })

    const intento = await client
      .post(`/api/v1/groups/${grupo.id}/members`)
      .bearerToken(bruno.token)
      .json({ email: 'caro@prueba.example' })
    intento.assertStatus(403)
  })

  test('agregar dos veces a la misma persona da 409', async ({ client, assert }) => {
    const ana = await persona(client, 'ana')
    await persona(client, 'bruno')
    const grupo = await grupoNuevo(client, ana.token)

    const payload = { email: 'bruno@prueba.example' }
    await client.post(`/api/v1/groups/${grupo.id}/members`).bearerToken(ana.token).json(payload)
    const repetido = await client
      .post(`/api/v1/groups/${grupo.id}/members`)
      .bearerToken(ana.token)
      .json(payload)

    repetido.assertStatus(409)
    assert.notInclude(JSON.stringify(repetido.body()), 'memberships_uno_por_grupo')
  })

  test('volver a agregar a alguien desactivado lo reactiva, con su historia', async ({
    client,
    assert,
  }) => {
    // El UNIQUE (group_id, user_id) no permite una segunda membresia, y esta
    // bien: la primera es la que figura en los gastos que esa persona ya pago.
    // Reactivar es la unica respuesta correcta, y conserva el `membership_id`.
    const ana = await persona(client, 'ana')
    await persona(client, 'bruno')
    const grupo = await grupoNuevo(client, ana.token)

    const alta = await client
      .post(`/api/v1/groups/${grupo.id}/members`)
      .bearerToken(ana.token)
      .json({ email: 'bruno@prueba.example' })
    const idOriginal = alta.body().member.id

    await client
      .patch(`/api/v1/groups/${grupo.id}/members/${idOriginal}`)
      .bearerToken(ana.token)
      .json({ active: false })

    const revive = await client
      .post(`/api/v1/groups/${grupo.id}/members`)
      .bearerToken(ana.token)
      .json({ email: 'bruno@prueba.example' })
    revive.assertStatus(200)
    assert.equal(
      revive.body().member.id,
      idOriginal,
      'reactivar tiene que conservar el membership_id, que es lo que los gastos referencian'
    )
  })

  test('un mail sin cuenta no se puede agregar todavia', async ({ client, assert }) => {
    // Hasta que exista API-3 (invitaciones por token), agregar a alguien exige
    // que ya tenga cuenta. El 404 es honesto: no hay a quien agregar.
    const ana = await persona(client, 'ana')
    const grupo = await grupoNuevo(client, ana.token)

    const respuesta = await client
      .post(`/api/v1/groups/${grupo.id}/members`)
      .bearerToken(ana.token)
      .json({ email: 'nadie@prueba.example' })
    respuesta.assertStatus(404)
    assert.equal(respuesta.body().errors[0].field, 'email')
  })
})

test.group('grupos | editar una membresia', (group) => {
  group.each.setup(() => limpiar())
  group.each.teardown(() => limpiar())

  /** Ana administradora, Bruno integrante, en un grupo nuevo. */
  async function grupoDeDos(client: any) {
    const ana = await persona(client, 'ana')
    const bruno = await persona(client, 'bruno')
    const grupo = await grupoNuevo(client, ana.token)
    const alta = await client
      .post(`/api/v1/groups/${grupo.id}/members`)
      .bearerToken(ana.token)
      .json({ email: 'bruno@prueba.example' })
    return { ana, bruno, grupo, membresiaDeBruno: alta.body().member.id as string }
  }

  test('cada uno carga su propio alias de cobro sin ser administrador', async ({
    client,
    assert,
  }) => {
    // El alias es donde a esa persona le entra la plata. Pedirle que le escriba
    // al administrador para cargarlo es el camino directo a que el plan de
    // cierre traiga `payout_alias: null` y no se pueda ejecutar.
    const { bruno, grupo, membresiaDeBruno } = await grupoDeDos(client)

    const respuesta = await client
      .patch(`/api/v1/groups/${grupo.id}/members/${membresiaDeBruno}`)
      .bearerToken(bruno.token)
      .json({ payout_alias: 'bruno.mp' })
    respuesta.assertStatus(200)
    assert.equal(respuesta.body().member.payout_alias, 'bruno.mp')
  })

  test('nadie toca el alias de otro sin ser administrador', async ({ client }) => {
    const { ana, bruno, grupo } = await grupoDeDos(client)
    const detalle = await client.get(`/api/v1/groups/${grupo.id}`).bearerToken(ana.token)
    const deAna = detalle
      .body()
      .members.find((m: { display_name: string }) => m.display_name === 'ana').id

    const intento = await client
      .patch(`/api/v1/groups/${grupo.id}/members/${deAna}`)
      .bearerToken(bruno.token)
      .json({ payout_alias: 'bruno.mp' })
    intento.assertStatus(403)
  })

  test('cambiar rol o desactivar es solo del administrador', async ({ client }) => {
    const { bruno, grupo, membresiaDeBruno } = await grupoDeDos(client)

    for (const payload of [{ role: 'admin' }, { active: false }]) {
      const intento = await client
        .patch(`/api/v1/groups/${grupo.id}/members/${membresiaDeBruno}`)
        .bearerToken(bruno.token)
        .json(payload)
      intento.assertStatus(403)
    }
  })

  test('desactivar a alguien lo deja afuera del grupo en el acto', async ({ client, assert }) => {
    const { ana, bruno, grupo, membresiaDeBruno } = await grupoDeDos(client)

    const baja = await client
      .patch(`/api/v1/groups/${grupo.id}/members/${membresiaDeBruno}`)
      .bearerToken(ana.token)
      .json({ active: false })
    baja.assertStatus(200)

    const intento = await client.get(`/api/v1/groups/${grupo.id}`).bearerToken(bruno.token)
    assert.equal(intento.status(), 404, 'desactivado tiene que ser indistinguible de no existir')
  })

  test('el grupo no puede quedarse sin un administrador activo', async ({ client, assert }) => {
    // Un grupo sin administrador no se puede administrar nunca mas: nadie puede
    // agregar, desactivar ni cerrar. Es el mismo agujero que el grupo sin
    // membresias, un paso mas adelante.
    const { ana, grupo } = await grupoDeDos(client)
    const detalle = await client.get(`/api/v1/groups/${grupo.id}`).bearerToken(ana.token)
    const deAna = detalle
      .body()
      .members.find((m: { display_name: string }) => m.display_name === 'ana').id

    for (const payload of [{ active: false }, { role: 'member' }]) {
      const intento = await client
        .patch(`/api/v1/groups/${grupo.id}/members/${deAna}`)
        .bearerToken(ana.token)
        .json(payload)
      assert.equal(intento.status(), 409, `${JSON.stringify(payload)} dejaria el grupo sin admin`)
      assert.equal(intento.body().errors[0].rule, 'last_admin')
    }
  })

  test('un administrador desactivado no cuenta como administrador', async ({ client, assert }) => {
    // El caso donde "queda otro admin" y "queda otro admin **activo**" dejan de
    // ser lo mismo. Si se cuentan los desactivados, Ana puede bajarse de
    // administradora porque Bruno "es" admin, y el grupo queda sin nadie que
    // pueda administrarlo: Bruno esta afuera y ni siquiera lo puede abrir.
    const { ana, grupo, membresiaDeBruno } = await grupoDeDos(client)
    const comoAna = (payload: Record<string, unknown>, mid: string) =>
      client.patch(`/api/v1/groups/${grupo.id}/members/${mid}`).bearerToken(ana.token).json(payload)

    await comoAna({ role: 'admin' }, membresiaDeBruno).then((r: any) => r.assertStatus(200))
    await comoAna({ active: false }, membresiaDeBruno).then((r: any) => r.assertStatus(200))

    const detalle = await client.get(`/api/v1/groups/${grupo.id}`).bearerToken(ana.token)
    const deAna = detalle
      .body()
      .members.find((m: { display_name: string }) => m.display_name === 'ana').id

    const intento = await comoAna({ role: 'member' }, deAna)
    assert.equal(intento.status(), 409, 'Bruno esta desactivado: no es un administrador que quede')
    assert.equal(intento.body().errors[0].rule, 'last_admin')
  })

  test('una membresia de otro grupo no se puede editar desde este', async ({ client, assert }) => {
    // El `:mid` viene de la URL y no se puede confiar en el. Sin filtrar por
    // `group_id`, ser administrador de un grupo cualquiera alcanzaria para
    // desactivar integrantes de todos los demas.
    const { ana, grupo } = await grupoDeDos(client)
    const otro = await grupoNuevo(client, ana.token, 'Otro grupo de Ana')

    const respuesta = await client
      .patch(`/api/v1/groups/${grupo.id}/members/${otro.my_membership_id}`)
      .bearerToken(ana.token)
      .json({ payout_alias: 'cruzado' })
    assert.equal(respuesta.status(), 404)

    // Y la membresia del otro grupo quedo intacta.
    const detalle = await client.get(`/api/v1/groups/${otro.id}`).bearerToken(ana.token)
    assert.isNull(detalle.body().members[0].payout_alias)
  })

  test('un `:mid` de otro grupo da 404 tambien para quien no tiene rol', async ({
    client,
    assert,
  }) => {
    // Este es el que de verdad guarda el filtro por `group_id` en la lectura de
    // la membresia. En el test de arriba quien pide es administradora, asi que
    // pasa los chequeos de rol y el 404 igual sale del UPDATE, que filtra por
    // grupo tambien. Sin rol es distinto: si la membresia ajena **se encuentra**,
    // el codigo llega al chequeo de rol y contesta 403, y ese 403 confirma que
    // esa membresia existe en algun otro grupo.
    const { bruno, grupo } = await grupoDeDos(client)
    const caro = await persona(client, 'caro')
    const ajeno = await grupoNuevo(client, caro.token, 'El de Caro')

    const respuesta = await client
      .patch(`/api/v1/groups/${grupo.id}/members/${ajeno.my_membership_id}`)
      .bearerToken(bruno.token)
      .json({ role: 'member' })
    assert.equal(
      respuesta.status(),
      404,
      'un 403 aca confirma que esa membresia existe en otro grupo'
    )
  })

  test('un PATCH de membresia vacio se rechaza', async ({ client }) => {
    const { ana, grupo, membresiaDeBruno } = await grupoDeDos(client)
    const respuesta = await client
      .patch(`/api/v1/groups/${grupo.id}/members/${membresiaDeBruno}`)
      .bearerToken(ana.token)
      .json({})
    respuesta.assertStatus(400)
  })
})
