import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import testUtils from '@adonisjs/core/services/test_utils'

/**
 * API-8 — autorizacion por pertenencia al grupo.
 *
 * El test que importa de verdad es uno solo: **la respuesta de un grupo ajeno
 * tiene que ser indistinguible de la de un grupo que no existe**. Mismo status,
 * mismo cuerpo, mismos headers. Si difieren en cualquier cosa —un mensaje, un
 * header, un largo— cualquiera con una cuenta puede recorrer ids y armar un
 * censo de grupos ajenos sin ver un solo peso.
 *
 * Por eso aca no se afirma "da 404": se comparan las dos respuestas entre si.
 * Un 404 con el mensaje "no sos integrante de este grupo" tambien seria un 404,
 * y filtraria exactamente lo que el 404 venia a tapar.
 */

const GRUPO = '11111111-1111-4111-8111-111111111111'
const INEXISTENTE = '99999999-9999-4999-8999-999999999999'
const CLAVE = 'una-clave-de-prueba-larga'
const RUTAS = ['balances', 'settlement']

async function limpiar() {
  await db.rawQuery(
    `DELETE FROM auth_access_tokens WHERE tokenable_id IN
       (SELECT id FROM users WHERE email LIKE '%@prueba.example')`
  )
  await db.rawQuery(`DELETE FROM users WHERE email LIKE '%@prueba.example'`)
}

/** Token de alguien que existe y no es parte de ningun grupo. */
async function tokenDeUnExtraño(client: any) {
  const alta = await client.post('/api/v1/auth/signup').json({
    email: 'extrano@prueba.example',
    password: CLAVE,
    display_name: 'Un extraño',
  })
  return alta.body().token.value as string
}

/** Token de alguien de la semilla, por el camino real: iniciando sesion. */
async function tokenDe(client: any, nombre: string) {
  const login = await client
    .post('/api/v1/auth/login')
    .json({ email: `${nombre}@vaquita.example`, password: 'vaquita-demo' })
  return login.body().token.value as string
}

/**
 * Los headers que pueden diferir legitimamente entre dos respuestas iguales.
 *
 * `date` cambia con el segundo y `x-request-id` es distinto en toda peticion por
 * definicion: ninguno de los dos se calcula a partir del grupo, asi que no
 * pueden filtrar si existe. Lo que queda —status, `content-type` y sobre todo
 * `content-length`— si deriva de la respuesta, y es lo que se compara. `etag`
 * deriva del cuerpo y por eso **no** se excluye: si apareciera y difiriera, eso
 * seria un problema de verdad.
 */
function headersComparables(headers: Record<string, unknown>) {
  const copia = { ...headers }
  delete copia.date
  delete copia['x-request-id']
  return copia
}

test.group('pertenencia | el grupo de rutas esta protegido', (group) => {
  group.each.setup(() => testUtils.db().seed())
  group.each.setup(() => limpiar())
  group.each.teardown(() => limpiar())

  test('sin token, las rutas del grupo dan 401', async ({ client }) => {
    for (const ruta of RUTAS) {
      const respuesta = await client.get(`/api/v1/groups/${GRUPO}/${ruta}`)
      respuesta.assertStatus(401)
    }
  })

  test('un integrante del grupo lee sus saldos', async ({ client, assert }) => {
    const token = await tokenDe(client, 'ana')

    for (const ruta of RUTAS) {
      const respuesta = await client.get(`/api/v1/groups/${GRUPO}/${ruta}`).bearerToken(token)
      respuesta.assertStatus(200)
    }

    const saldos = await client.get(`/api/v1/groups/${GRUPO}/balances`).bearerToken(token)
    assert.lengthOf(saldos.body().balances, 6)
  })

  test('un grupo ajeno responde exactamente lo mismo que un grupo inexistente', async ({
    client,
    assert,
  }) => {
    const token = await tokenDeUnExtraño(client)

    for (const ruta of RUTAS) {
      const ajeno = await client.get(`/api/v1/groups/${GRUPO}/${ruta}`).bearerToken(token)
      const fantasma = await client.get(`/api/v1/groups/${INEXISTENTE}/${ruta}`).bearerToken(token)

      assert.equal(ajeno.status(), fantasma.status(), `${ruta}: el status delata la existencia`)
      assert.equal(ajeno.status(), 404, `${ruta}: tiene que ser 404, no 403`)
      assert.deepEqual(ajeno.body(), fantasma.body(), `${ruta}: el cuerpo delata la existencia`)
      assert.deepEqual(
        headersComparables(ajeno.headers()),
        headersComparables(fantasma.headers()),
        `${ruta}: los headers delatan la existencia`
      )
    }
  })

  test('el mensaje del 404 no menciona la pertenencia', async ({ client, assert }) => {
    // Un 404 que dice "no sos integrante de este grupo" confirma que el grupo
    // existe igual que un 403, solo que con mejor fachada.
    const token = await tokenDeUnExtraño(client)
    const ajeno = await client.get(`/api/v1/groups/${GRUPO}/balances`).bearerToken(token)
    const texto = JSON.stringify(ajeno.body()).toLowerCase()

    for (const palabra of ['integrante', 'miembro', 'pertenec', 'permiso', 'autoriz']) {
      assert.notInclude(texto, palabra, `el mensaje del 404 dice "${palabra}"`)
    }
  })

  test('un integrante desactivado deja de ser integrante', async ({ client, assert }) => {
    // Sacar a alguien del grupo es `active = false`, nunca un DELETE: ya es
    // parte del historial de gastos. Pero que su historia siga ahi no puede
    // significar que siga leyendo el grupo.
    const token = await tokenDe(client, 'nico')
    const antes = await client.get(`/api/v1/groups/${GRUPO}/balances`).bearerToken(token)
    antes.assertStatus(200)

    await db.rawQuery(
      `UPDATE memberships SET active = false
         WHERE group_id = ? AND user_id = (SELECT id FROM users WHERE email = ?)`,
      [GRUPO, 'nico@vaquita.example']
    )

    const despues = await client.get(`/api/v1/groups/${GRUPO}/balances`).bearerToken(token)
    const fantasma = await client.get(`/api/v1/groups/${INEXISTENTE}/balances`).bearerToken(token)
    assert.equal(despues.status(), 404)
    assert.deepEqual(despues.body(), fantasma.body())
  })

  test('la membresia resuelta llega al controlador y no se vuelve a consultar', async ({
    client,
    assert,
  }) => {
    // `ctx.membresia` existe para que el controlador sepa **quien pregunta**
    // sin repetir la consulta del middleware. Se verifica por su efecto
    // observable: la respuesta marca cual de los saldos es el de quien pide.
    const token = await tokenDe(client, 'javier')
    const respuesta = await client.get(`/api/v1/groups/${GRUPO}/balances`).bearerToken(token)
    respuesta.assertStatus(200)

    const cuerpo = respuesta.body()
    assert.isString(cuerpo.my_membership_id)
    const mio = cuerpo.balances.find(
      (s: { membership_id: string }) => s.membership_id === cuerpo.my_membership_id
    )
    assert.isDefined(mio, 'el membership_id propio tiene que ser uno de los saldos del grupo')
    assert.equal(mio.display_name, 'Javier')
  })
})
