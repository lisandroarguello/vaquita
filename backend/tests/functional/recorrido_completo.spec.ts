import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'

/**
 * QA-4 — el recorrido completo, a nivel API.
 *
 * Registro → crear grupo → agregar integrantes → tres gastos de los tres modos
 * → `balances` → `settlement` → `POST payments` por cada transferencia del plan
 * → `balances` todos en cero.
 *
 * Es el test mas valioso del proyecto, y no por cubrir mucho: **es el unico que
 * verifica que las piezas encajan**. Cada ticket tiene sus tests y todos pasan
 * aunque dos endpoints se contradigan en el formato de un campo. Este recorrido
 * usa la respuesta de uno como entrada del siguiente, que es lo que va a hacer
 * el frontend, y por eso rompe cuando la costura esta mal y no cuando una pieza
 * esta mal. Ya encontro una: `settlement` devolvia nombres y ningun id, asi que
 * sus transferencias no se podian convertir en pagos.
 *
 * Corre en segundos, no levanta navegador y no se rompe por un cambio de CSS:
 * entra en CI (QA-2) y sigue valiendo cuando el frontend todavia no existe.
 */

const CLAVE = 'una-clave-de-prueba-larga'

async function limpiar() {
  // El orden es el de las dependencias: pagos (FK compuesta a membresias),
  // gastos (que se llevan su reparto en cascada, que es la regla desde DAT-2),
  // membresias, grupos, tokens, usuarios.
  const dominio = `'%@recorrido.example'`
  await db.rawQuery(
    `DELETE FROM payments WHERE group_id IN
       (SELECT id FROM groups WHERE created_by IN
          (SELECT id FROM users WHERE email LIKE ${dominio}))`
  )
  await db.rawQuery(
    `DELETE FROM expenses WHERE group_id IN
       (SELECT id FROM groups WHERE created_by IN
          (SELECT id FROM users WHERE email LIKE ${dominio}))`
  )
  await db.rawQuery(
    `DELETE FROM memberships WHERE group_id IN
       (SELECT id FROM groups WHERE created_by IN
          (SELECT id FROM users WHERE email LIKE ${dominio}))`
  )
  await db.rawQuery(
    `DELETE FROM groups WHERE created_by IN
       (SELECT id FROM users WHERE email LIKE ${dominio})`
  )
  await db.rawQuery(
    `DELETE FROM auth_access_tokens WHERE tokenable_id IN
       (SELECT id FROM users WHERE email LIKE ${dominio})`
  )
  await db.rawQuery(`DELETE FROM users WHERE email LIKE ${dominio}`)
}

interface Transferencia {
  from_membership_id: string
  to_membership_id: string
  from: string
  to: string
  amount_cents: number
  payout_alias: string | null
}

interface Saldo {
  membership_id: string
  display_name: string
  balance_cents: number
}

test.group('recorrido completo | de cuatro desconocidos a saldos en cero', (group) => {
  group.each.setup(() => limpiar())
  group.each.teardown(() => limpiar())

  test('el grupo se arma, gasta, se salda y queda en cero', async ({ client, assert }) => {
    /* ---- 1. Cuatro personas se registran ------------------------------- */

    const gente: Record<string, { token: string; id: string }> = {}
    for (const nombre of ['ana', 'bruno', 'caro', 'dani']) {
      const alta = await client.post('/api/v1/auth/signup').json({
        email: `${nombre}@recorrido.example`,
        password: CLAVE,
        display_name: nombre,
      })
      alta.assertStatus(201)
      gente[nombre] = { token: alta.body().token.value, id: alta.body().user.id }
    }

    // La sesion sirve: el token que devuelve el registro abre `/me`.
    const yo = await client.get('/api/v1/me').bearerToken(gente.ana.token)
    yo.assertStatus(200)
    assert.equal(yo.body().user.email, 'ana@recorrido.example')

    /* ---- 2. Ana crea el grupo y queda administradora -------------------- */

    const creado = await client
      .post('/api/v1/groups')
      .bearerToken(gente.ana.token)
      .json({ name: 'Finde en la costa', currency: 'ARS' })
    creado.assertStatus(201)
    const grupo = creado.body().group
    assert.equal(grupo.my_role, 'admin')

    /* ---- 3. Ana suma a los otros tres por mail --------------------------- */

    for (const nombre of ['bruno', 'caro', 'dani']) {
      const alta = await client
        .post(`/api/v1/groups/${grupo.id}/members`)
        .bearerToken(gente.ana.token)
        .json({ email: `${nombre}@recorrido.example` })
      alta.assertStatus(201)
    }

    const detalle = await client.get(`/api/v1/groups/${grupo.id}`).bearerToken(gente.ana.token)
    detalle.assertStatus(200)
    assert.lengthOf(detalle.body().members, 4)

    const m: Record<string, string> = {}
    for (const integrante of detalle.body().members) {
      m[integrante.display_name] = integrante.id
    }

    // Cada uno carga su propio alias de cobro: no hace falta ser administrador
    // para eso, y es lo que hace que el plan de cierre sea accionable.
    for (const nombre of ['ana', 'bruno', 'caro', 'dani']) {
      const alias = await client
        .patch(`/api/v1/groups/${grupo.id}/members/${m[nombre]}`)
        .bearerToken(gente[nombre].token)
        .json({ payout_alias: `${nombre}.mp` })
      alias.assertStatus(200)
    }

    /* ---- 4. Tres gastos, uno por modo de division ------------------------ */

    // `equal`: Ana paga la cabana y se divide entre los cuatro.
    const cabana = await client
      .post(`/api/v1/groups/${grupo.id}/expenses`)
      .bearerToken(gente.ana.token)
      .json({
        description: 'Cabana',
        amount_cents: 120000,
        incurred_on: '2026-11-20',
        paid_by: m.ana,
        split_mode: 'equal',
        shares: [
          { membership_id: m.ana },
          { membership_id: m.bruno },
          { membership_id: m.caro },
          { membership_id: m.dani },
        ],
      })
    cabana.assertStatus(201)

    // `exact`: Bruno paga el super y cada uno puso lo que puso. Ana no come.
    const supermercado = await client
      .post(`/api/v1/groups/${grupo.id}/expenses`)
      .bearerToken(gente.bruno.token)
      .json({
        description: 'Supermercado',
        amount_cents: 45000,
        incurred_on: '2026-11-21',
        paid_by: m.bruno,
        split_mode: 'exact',
        shares: [
          { membership_id: m.bruno, amount_cents: 20000 },
          { membership_id: m.caro, amount_cents: 15000 },
          { membership_id: m.dani, amount_cents: 10000 },
        ],
      })
    supermercado.assertStatus(201)

    // `percentage`: Caro paga la nafta y se reparte por uso del auto.
    const nafta = await client
      .post(`/api/v1/groups/${grupo.id}/expenses`)
      .bearerToken(gente.caro.token)
      .json({
        description: 'Nafta',
        amount_cents: 31000,
        incurred_on: '2026-11-22',
        paid_by: m.caro,
        split_mode: 'percentage',
        shares: [
          { membership_id: m.ana, percentage: '50' },
          { membership_id: m.bruno, percentage: '25' },
          { membership_id: m.caro, percentage: '12.5' },
          { membership_id: m.dani, percentage: '12.5' },
        ],
      })
    nafta.assertStatus(201)

    // El reparto de cada gasto cierra con su total. Es la invariante que el
    // trigger de DAT-2 sostiene; aca se mira desde afuera, por la API.
    const historial = await client
      .get(`/api/v1/groups/${grupo.id}/expenses`)
      .bearerToken(gente.dani.token)
    historial.assertStatus(200)
    assert.equal(historial.body().total, 3)
    for (const gasto of historial.body().expenses) {
      const suma = gasto.shares.reduce(
        (acc: number, parte: { share_cents: number }) => acc + parte.share_cents,
        0
      )
      assert.equal(suma, gasto.amount_cents, `el reparto de ${gasto.description} no cierra`)
    }

    /* ---- 5. Los saldos suman cero --------------------------------------- */

    const antes = await client
      .get(`/api/v1/groups/${grupo.id}/balances`)
      .bearerToken(gente.dani.token)
    antes.assertStatus(200)
    assert.isTrue(antes.body().sums_to_zero)
    const saldosAntes: Saldo[] = antes.body().balances
    assert.equal(
      saldosAntes.reduce((acc, s) => acc + s.balance_cents, 0),
      0
    )
    // Y alguien debe algo: un recorrido donde nadie debe nada no prueba nada.
    assert.isAbove(
      saldosAntes.filter((s) => s.balance_cents !== 0).length,
      0,
      'nadie quedo con saldo: el recorrido no tiene nada que saldar'
    )

    /* ---- 6. El plan de cierre ------------------------------------------- */

    const plan = await client
      .get(`/api/v1/groups/${grupo.id}/settlement`)
      .bearerToken(gente.dani.token)
    plan.assertStatus(200)
    assert.isTrue(plan.body().verified)

    const transferencias: Transferencia[] = plan.body().transfers
    assert.isAbove(transferencias.length, 0)
    // El valor del producto, medido: el plan no usa mas transferencias que el
    // ingenuo de "todos contra uno".
    assert.isAtMost(plan.body().transfer_count, plan.body().naive_transfer_count)

    for (const t of transferencias) {
      // Cada transferencia trae con que operar y con que mostrar.
      assert.isString(t.from_membership_id)
      assert.isString(t.to_membership_id)
      assert.notEqual(t.from_membership_id, t.to_membership_id)
      assert.isAbove(t.amount_cents, 0)
      assert.equal(t.payout_alias, `${t.to}.mp`, 'el alias no es el de quien cobra')
    }

    /* ---- 7. Cada transferencia del plan se marca como hecha -------------- */

    for (const t of transferencias) {
      // La registra Ana, administradora: en la vida real la registra cada
      // pagador, y eso ya esta cubierto en `pagos.spec.ts`. Aca lo que importa
      // es que el plan se consuma tal como salio, sin traducir nada.
      const pago = await client
        .post(`/api/v1/groups/${grupo.id}/payments`)
        .bearerToken(gente.ana.token)
        .json({
          from_membership_id: t.from_membership_id,
          to_membership_id: t.to_membership_id,
          amount_cents: t.amount_cents,
        })
      pago.assertStatus(201)
    }

    /* ---- 8. Y el grupo queda en cero ------------------------------------ */

    const despues = await client
      .get(`/api/v1/groups/${grupo.id}/balances`)
      .bearerToken(gente.dani.token)
    despues.assertStatus(200)
    assert.isTrue(despues.body().sums_to_zero)
    for (const saldo of despues.body().balances as Saldo[]) {
      assert.equal(saldo.balance_cents, 0, `${saldo.display_name} no quedo en cero`)
    }

    // Y el plan ya no tiene nada que proponer, que es la otra forma de decir lo
    // mismo y la que el frontend va a mostrar.
    const planFinal = await client
      .get(`/api/v1/groups/${grupo.id}/settlement`)
      .bearerToken(gente.dani.token)
    planFinal.assertStatus(200)
    assert.equal(planFinal.body().transfer_count, 0)
    assert.lengthOf(planFinal.body().transfers, 0)
    assert.isTrue(planFinal.body().verified)

    // El historial quedo completo: tres gastos y un pago por transferencia.
    const cierre = await client.get(`/api/v1/groups/${grupo.id}`).bearerToken(gente.ana.token)
    assert.equal(cierre.body().totals.expense_count, 3)
    assert.equal(cierre.body().totals.expense_total_cents, 120000 + 45000 + 31000)
    assert.equal(cierre.body().totals.payment_count, transferencias.length)
  })
})
