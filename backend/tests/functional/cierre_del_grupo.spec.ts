import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'

/**
 * El camino completo, de la ruta HTTP a la base y de vuelta.
 *
 * Esto es lo que ninguna otra suite prueba: los tests de dominio corren sin
 * base y los de esquema corren sin servidor. Aca se ejercita lo que el usuario
 * toca —`GET /groups/{id}/settlement`— sobre el grupo de prueba de la semilla,
 * pasando por el repositorio, `calcularSaldos`, el minimizador y
 * `verificarPlan`.
 *
 * El plan se comprueba con un **helper propio**, no con `verificarPlan`. Es la
 * misma decision de DOM-7 y por el mismo motivo: si el test verificara el plan
 * con el mismo codigo que la ruta usa para verificarlo, un error compartido
 * quedaria invisible en los dos lados a la vez.
 *
 * Desde API-8 las dos rutas exigen sesion y pertenencia, asi que todo esto pasa
 * autenticado como Ana, que es integrante del grupo de la semilla. El token se
 * saca **iniciando sesion de verdad**, no fabricandolo: si el login se rompe,
 * este test tambien tiene que romperse.
 */

const GRUPO = '11111111-1111-4111-8111-111111111111'
const INEXISTENTE = '99999999-9999-4999-8999-999999999999'

interface Saldo {
  membership_id: string
  display_name: string
  balance_cents: number
}

interface Transferencia {
  from: string
  to: string
  amount_cents: number
  payout_alias: string | null
}

test.group('cierre | el grupo de prueba se puede saldar de punta a punta', (group) => {
  let token: string

  group.each.setup(() => testUtils.db().seed())
  // Ana, la administradora del grupo de la semilla.
  group.each.setup(async (t) => {
    const login = await t.context.client
      .post('/api/v1/auth/login')
      .json({ email: 'ana@vaquita.example', password: 'vaquita-demo' })
    login.assertStatus(200)
    token = login.body().token.value
  })

  test('los saldos del grupo suman exactamente cero', async ({ client, assert }) => {
    const respuesta = await client.get(`/api/v1/groups/${GRUPO}/balances`).bearerToken(token)
    respuesta.assertStatus(200)

    const cuerpo = respuesta.body()
    assert.equal(cuerpo.currency, 'ARS')
    assert.lengthOf(cuerpo.balances, 6)
    assert.isTrue(cuerpo.sums_to_zero)

    const total = cuerpo.balances.reduce((acc: number, s: Saldo) => acc + s.balance_cents, 0)
    assert.equal(total, 0, 'la suma de los saldos tiene que dar cero, no aproximadamente cero')

    // Los nombres salen de la base, no de los ids.
    assert.includeMembers(
      cuerpo.balances.map((s: Saldo) => s.display_name),
      ['Ana', 'Javier', 'Sol', 'Tomas', 'Lucia', 'Nico']
    )
  })

  test('el plan de cierre deja a todos en cero y respeta la cota', async ({ client, assert }) => {
    const respuestaSaldos = await client.get(`/api/v1/groups/${GRUPO}/balances`).bearerToken(token)
    const saldos = respuestaSaldos.body()
    const respuesta = await client.get(`/api/v1/groups/${GRUPO}/settlement`).bearerToken(token)
    respuesta.assertStatus(200)

    const cuerpo = respuesta.body()
    assert.isTrue(cuerpo.verified)
    assert.equal(cuerpo.currency, 'ARS')

    const transferencias: Transferencia[] = cuerpo.transfers
    assert.equal(cuerpo.transfer_count, transferencias.length)

    const activos = saldos.balances.filter((s: Saldo) => s.balance_cents !== 0).length
    assert.equal(cuerpo.naive_transfer_count, activos)
    assert.isAtMost(
      transferencias.length,
      Math.max(0, activos - 1),
      'el plan no puede proponer mas de n-1 transferencias'
    )

    // Aplicar el plan a mano, sin usar el verificador del dominio.
    const pendiente = new Map<string, number>()
    for (const saldo of saldos.balances) {
      pendiente.set(saldo.display_name, saldo.balance_cents)
    }
    for (const t of transferencias) {
      assert.isAbove(t.amount_cents, 0, 'una transferencia de cero o negativa no mueve nada')
      assert.notEqual(t.from, t.to, 'nadie se transfiere a si mismo')
      pendiente.set(t.from, pendiente.get(t.from)! + t.amount_cents)
      pendiente.set(t.to, pendiente.get(t.to)! - t.amount_cents)
    }
    for (const [quien, cents] of pendiente) {
      assert.equal(cents, 0, `${quien} no queda en cero despues de aplicar el plan`)
    }
  })

  test('cada transferencia dice a que alias hay que mandar la plata', async ({
    client,
    assert,
  }) => {
    // Es la razon de ser del producto: Vaquita no mueve dinero, emite
    // instrucciones de pago, y el alias es lo que las hace ejecutables.
    //
    // El alias es **el de quien cobra**, no el de quien paga. Parece obvio y es
    // justo el error que nadie ve leyendo: las dos columnas tienen el mismo
    // tipo y el plan igual "funciona", solo que manda la plata al lugar
    // equivocado. Por eso se compara contra el alias real de cada persona.
    const aliasDe: Record<string, string | null> = {
      Ana: 'ana.mp',
      Javier: 'javi.uala',
      Sol: 'sol.brubank',
      Tomas: null,
      Lucia: 'lu.mp',
      Nico: 'nico.mp',
    }

    const plan = await client.get(`/api/v1/groups/${GRUPO}/settlement`).bearerToken(token)
    const cuerpo = plan.body()
    assert.isAbove(cuerpo.transfers.length, 0)

    for (const t of cuerpo.transfers as Transferencia[]) {
      assert.equal(
        t.payout_alias,
        aliasDe[t.to],
        `la transferencia de ${t.from} a ${t.to} trae el alias equivocado`
      )
    }

    // Tomas no tiene alias cargado, y el plan igual puede ponerlo a cobrar: la
    // respuesta dice `null` en vez de inventar uno. Esa transferencia no se
    // puede ejecutar hasta que cargue su alias, y **que hace la interfaz con
    // eso es una decision de producto que todavia no esta tomada**. Queda
    // fijado aca para que no se descubra recien cuando haya pantalla.
    const sinAlias = (cuerpo.transfers as Transferencia[]).filter((t) => t.payout_alias === null)
    for (const t of sinAlias) {
      assert.equal(aliasDe[t.to], null, `${t.to} tiene alias pero la respuesta trajo null`)
    }
  })

  test('el plan minimo usa menos transferencias que hacerlo a mano', async ({ client, assert }) => {
    const plan = await client.get(`/api/v1/groups/${GRUPO}/settlement`).bearerToken(token)
    const cuerpo = plan.body()
    assert.isBelow(
      cuerpo.transfer_count,
      cuerpo.naive_transfer_count,
      'si el minimo no le gana al plan ingenuo, el producto no tiene sentido'
    )
  })

  test('un grupo que no existe da 404 y no un 500', async ({ client }) => {
    await client
      .get(`/api/v1/groups/${INEXISTENTE}/balances`)
      .bearerToken(token)
      .then((r) => r.assertStatus(404))
    await client
      .get(`/api/v1/groups/${INEXISTENTE}/settlement`)
      .bearerToken(token)
      .then((r) => r.assertStatus(404))
  })

  // Era `/`, que desde el andamiaje del frontend devuelve la pagina de React:
  // el estado del servicio se mudo a `/api/v1/health` (ver `start/routes.ts`).
  test('el estado del servicio responde, para saber que esta vivo', async ({ client }) => {
    const respuesta = await client.get('/api/v1/health')
    respuesta.assertStatus(200)
    respuesta.assertBodyContains({ status: 'ok' })
  })
})
