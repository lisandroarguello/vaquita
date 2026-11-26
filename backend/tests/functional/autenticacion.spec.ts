import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import testUtils from '@adonisjs/core/services/test_utils'

/**
 * API-1 — registro, inicio de sesion, cierre de sesion y `/me`, por HTTP.
 *
 * Los tests de `tests/database/usuario_repository.spec.ts` ya cubren el hash y
 * la normalizacion del mail. Lo que se prueba aca es lo otro: que el token sirva
 * para algo, que **cerrar sesion lo revoque de verdad** —no que la respuesta
 * diga que si— y que la respuesta de un mail inexistente sea indistinguible de
 * la de una contraseña equivocada tambien del lado de HTTP, donde el status
 * puede delatar lo que el cuerpo oculta.
 */

const CLAVE = 'una-clave-de-prueba-larga'

async function limpiar() {
  // Los tokens cuelgan del usuario por FK, asi que se van primero.
  await db.rawQuery(
    `DELETE FROM auth_access_tokens WHERE tokenable_id IN
       (SELECT id FROM users WHERE email LIKE '%@prueba.example')`
  )
  await db.rawQuery(`DELETE FROM users WHERE email LIKE '%@prueba.example'`)
}

/** Registra a alguien y devuelve su token, que es lo que hace falta casi siempre. */
async function registrada(client: any, email = 'ana@prueba.example') {
  const respuesta = await client.post('/api/v1/auth/signup').json({
    email,
    password: CLAVE,
    display_name: 'Ana',
  })
  return { respuesta, token: respuesta.body().token?.value as string }
}

test.group('auth | registro', (group) => {
  group.each.setup(() => limpiar())
  group.each.teardown(() => limpiar())

  test('registrarse devuelve 201, el usuario y un token que ya sirve', async ({
    client,
    assert,
  }) => {
    const { respuesta, token } = await registrada(client)
    respuesta.assertStatus(201)

    const cuerpo = respuesta.body()
    assert.equal(cuerpo.user.email, 'ana@prueba.example')
    assert.equal(cuerpo.user.display_name, 'Ana')
    assert.isString(cuerpo.user.id)
    assert.equal(cuerpo.token.type, 'bearer')
    assert.isString(token)
    assert.isNotEmpty(token)

    // El token no se entrega "para despues": se usa en el acto.
    const yo = await client.get('/api/v1/me').bearerToken(token)
    yo.assertStatus(200)
    yo.assertBodyContains({ user: { email: 'ana@prueba.example' } })
  })

  test('la respuesta del registro no filtra el hash de la contraseña', async ({
    client,
    assert,
  }) => {
    // El modelo Lucid tiene `serializeAs: null` en `passwordHash`, pero el
    // controlador no devuelve el modelo serializado: arma el objeto a mano. Si
    // alguna vez lo cambia por `user.serialize()`, esto lo acusa.
    const { respuesta } = await registrada(client)
    const texto = JSON.stringify(respuesta.body())
    assert.notInclude(texto, 'password')
    assert.notInclude(texto, 'scrypt')
  })

  test('el mail se guarda en minuscula aunque se registre en mayusculas', async ({
    client,
    assert,
  }) => {
    const respuesta = await client.post('/api/v1/auth/signup').json({
      email: 'Ana.Perez@Prueba.Example',
      password: CLAVE,
      display_name: 'Ana',
    })
    respuesta.assertStatus(201)
    assert.equal(respuesta.body().user.email, 'ana.perez@prueba.example')

    // Y se puede entrar escribiendolo de cualquier manera.
    const login = await client.post('/api/v1/auth/login').json({
      email: 'ANA.PEREZ@prueba.example',
      password: CLAVE,
    })
    login.assertStatus(200)
  })

  test('un mail ya registrado da 409 y no un 500', async ({ client, assert }) => {
    await registrada(client)

    const repetido = await client.post('/api/v1/auth/signup').json({
      email: 'ANA@prueba.example',
      password: CLAVE,
      display_name: 'Otra Ana',
    })
    repetido.assertStatus(409)

    const errores = repetido.body().errors
    assert.lengthOf(errores, 1)
    assert.equal(errores[0].field, 'email')
    // El UNIQUE de Postgres no se escapa hacia afuera: lo que se filtra por ahi
    // es el nombre del indice y la consulta.
    assert.notInclude(JSON.stringify(errores), 'users_mail_unico')
  })

  test('los datos mal formados dan 400 con el campo que falla', async ({ client, assert }) => {
    const casos: { payload: Record<string, unknown>; campo: string }[] = [
      { payload: { email: 'no-es-un-mail', password: CLAVE, display_name: 'Ana' }, campo: 'email' },
      {
        payload: { email: 'ana@prueba.example', password: 'corta', display_name: 'Ana' },
        campo: 'password',
      },
      { payload: { email: 'ana@prueba.example', password: CLAVE }, campo: 'display_name' },
    ]

    for (const caso of casos) {
      const respuesta = await client.post('/api/v1/auth/signup').json(caso.payload)
      respuesta.assertStatus(400)
      const campos = respuesta.body().errors.map((e: { field?: string }) => e.field)
      assert.include(campos, caso.campo, `faltaba el error de ${caso.campo}`)
    }
  })
})

test.group('auth | inicio y cierre de sesion', (group) => {
  group.each.setup(() => limpiar())
  group.each.teardown(() => limpiar())

  test('la contraseña correcta devuelve un token usable', async ({ client, assert }) => {
    await registrada(client)

    const login = await client
      .post('/api/v1/auth/login')
      .json({ email: 'ana@prueba.example', password: CLAVE })
    login.assertStatus(200)

    const token = login.body().token.value
    assert.isString(token)
    const yo = await client.get('/api/v1/me').bearerToken(token)
    yo.assertStatus(200)
  })

  test('un mail inexistente y una contraseña equivocada son indistinguibles', async ({
    client,
    assert,
  }) => {
    await registrada(client)

    const claveMal = await client
      .post('/api/v1/auth/login')
      .json({ email: 'ana@prueba.example', password: 'esta-no-es-la-clave' })
    const mailInexistente = await client
      .post('/api/v1/auth/login')
      .json({ email: 'nadie@prueba.example', password: CLAVE })

    // Si estas dos respuestas difieren en algo, el formulario de login se
    // convierte en un oraculo de "quien tiene cuenta aca".
    claveMal.assertStatus(401)
    mailInexistente.assertStatus(401)
    assert.deepEqual(claveMal.body(), mailInexistente.body())
    assert.deepEqual(
      claveMal.body().errors.map((e: { field?: string }) => e.field),
      [undefined],
      'el error es del formulario entero: señalar el campo diria cual de los dos fallo'
    )
  })

  test('sin token, `/me` da 401', async ({ client }) => {
    const respuesta = await client.get('/api/v1/me')
    respuesta.assertStatus(401)
  })

  test('un token inventado da 401 y no un 500', async ({ client }) => {
    const respuesta = await client.get('/api/v1/me').bearerToken('vaq_esto-no-es-un-token')
    respuesta.assertStatus(401)
  })

  test('cerrar sesion revoca el token: el mismo token ya no entra', async ({ client }) => {
    const { token } = await registrada(client)

    const salida = await client.post('/api/v1/auth/logout').bearerToken(token)
    salida.assertStatus(200)

    // Esto es lo que vale: no que el logout responda 200, sino que el token
    // quede muerto. Un logout que solo contesta bien deja la sesion viva 30
    // dias en manos de cualquiera que tenga el token.
    const despues = await client.get('/api/v1/me').bearerToken(token)
    despues.assertStatus(401)
  })

  test('cerrar sesion no toca las otras sesiones de la misma persona', async ({ client }) => {
    // Alguien con el telefono y la computadora abiertos: salir en uno no puede
    // echarlo del otro.
    await registrada(client)
    const primerLogin = await client
      .post('/api/v1/auth/login')
      .json({ email: 'ana@prueba.example', password: CLAVE })
    const segundoLogin = await client
      .post('/api/v1/auth/login')
      .json({ email: 'ana@prueba.example', password: CLAVE })
    const uno = primerLogin.body().token.value
    const dos = segundoLogin.body().token.value

    await client.post('/api/v1/auth/logout').bearerToken(uno)

    const otro = await client.get('/api/v1/me').bearerToken(dos)
    otro.assertStatus(200)
  })

  test('sin token, cerrar sesion da 401', async ({ client }) => {
    const respuesta = await client.post('/api/v1/auth/logout')
    respuesta.assertStatus(401)
  })
})

test.group('auth | las credenciales que publica el README funcionan', (group) => {
  group.each.setup(() => testUtils.db().seed())

  test('se puede iniciar sesion con el usuario de la semilla', async ({ client, assert }) => {
    // La regla 2 de la entrega pide credenciales de prueba en el README. Si la
    // semilla vuelve a insertar un hash falso, esto lo acusa antes de que lo
    // acuse el evaluador.
    const login = await client
      .post('/api/v1/auth/login')
      .json({ email: 'ana@vaquita.example', password: 'vaquita-demo' })
    login.assertStatus(200)
    assert.isString(login.body().token.value)
  })
})
