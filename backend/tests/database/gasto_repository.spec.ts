import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { crearGasto, gastoPorId } from '#repositories/gasto_repository'

/**
 * El repositorio de gastos contra Postgres de verdad, y en particular **su
 * contrato con el trigger de DAT-2**.
 *
 * Por que hace falta este archivo y no alcanza con los tests funcionales: por la
 * API, un reparto que no cierra nunca llega a la base. `app/domain/reparto.ts`
 * garantiza la suma y el controlador rechaza con 422 todo lo demas, asi que el
 * trigger —y el `SET CONSTRAINTS ALL IMMEDIATE` que lo hace visible— no se
 * ejercita ni una vez. Salio de un mutante: **sacar el `SET CONSTRAINTS` del
 * repositorio no rompia ningun test**, y eso convierte una red de seguridad en
 * una linea que el proximo que pase borra por inutil.
 *
 * La red existe justamente para el dia en que el controlador tenga un bug. Para
 * mirarla hay que entrar por abajo, saltando el dominio, que es lo que hace este
 * archivo: le pasa al repositorio un reparto deliberadamente mal armado.
 */

interface ErrorDePg extends Error {
  code?: string
  constraint?: string
}

async function limpiar() {
  await db.rawQuery(
    `TRUNCATE users, groups, memberships, invitations, expenses, expense_shares, payments CASCADE`
  )
}

async function armarGrupo() {
  const { rows: usuarios } = await db.rawQuery(
    `INSERT INTO users (email, password_hash, display_name)
     VALUES ('ana@vaquita.test', 'hash', 'Ana'), ('beto@vaquita.test', 'hash', 'Beto')
     RETURNING id, email`
  )
  const ana = usuarios.find((u: { email: string }) => u.email.startsWith('ana')).id
  const beto = usuarios.find((u: { email: string }) => u.email.startsWith('beto')).id

  const { rows: grupos } = await db.rawQuery(
    `INSERT INTO groups (name, currency, created_by) VALUES ('G', 'ARS', ?) RETURNING id`,
    [ana]
  )
  const { rows: membresias } = await db.rawQuery(
    `INSERT INTO memberships (group_id, user_id, role)
     VALUES (?, ?, 'admin'), (?, ?, 'member') RETURNING id, role`,
    [grupos[0].id, ana, grupos[0].id, beto]
  )

  return {
    grupo: grupos[0].id as string,
    uno: membresias.find((m: { role: string }) => m.role === 'admin').id as string,
    dos: membresias.find((m: { role: string }) => m.role === 'member').id as string,
  }
}

function datosDe(g: { grupo: string; uno: string }) {
  return {
    grupoId: g.grupo,
    pagadoPor: g.uno,
    cargadoPor: g.uno,
    totalCents: 30000,
    descripcion: 'Asado',
    fecha: '2026-11-17',
    modo: 'equal' as const,
  }
}

test.group('gasto_repository | el reparto que no cierra no pasa', (group) => {
  group.each.setup(() => limpiar())
  group.each.teardown(() => limpiar())

  test('un reparto que no suma el total hace fallar la escritura', async ({ assert }) => {
    const g = await armarGrupo()

    // 10000 + 10000 contra un gasto de 30000: faltan $100. El dominio nunca
    // produciria esto; se entra por abajo a proposito.
    let error: ErrorDePg | null = null
    try {
      await crearGasto(datosDe(g), () => [
        { membresiaId: g.uno, cents: 10000 },
        { membresiaId: g.dos, cents: 10000 },
      ])
    } catch (e) {
      error = e as ErrorDePg
    }

    assert.isNotNull(
      error,
      'la escritura resolvio sin error: falta el SET CONSTRAINTS ALL IMMEDIATE'
    )
    assert.equal(error!.code, '23514')
    assert.equal(error!.constraint, 'expense_shares_suman_el_total')
  })

  test('y no deja nada escrito', async ({ assert }) => {
    const g = await armarGrupo()

    await crearGasto(datosDe(g), () => [{ membresiaId: g.uno, cents: 1 }]).catch(() => null)

    const { rows } = await db.rawQuery(`SELECT count(*)::int AS n FROM expenses`)
    assert.equal(rows[0].n, 0, 'quedo un gasto a medias')
  })

  test('un reparto que cierra entra, con sus partes', async ({ assert }) => {
    // La contracara: si lo de arriba fallara por cualquier otro motivo, este
    // test estaria en rojo tambien y el de arriba seria un "no pude mirar".
    const g = await armarGrupo()

    const gasto = await crearGasto(datosDe(g), () => [
      { membresiaId: g.uno, cents: 15000 },
      { membresiaId: g.dos, cents: 15000 },
    ])

    assert.equal(gasto.totalCents, 30000)
    assert.lengthOf(gasto.partes, 2)

    const leido = await gastoPorId(g.grupo, gasto.id)
    assert.equal(
      leido!.partes.reduce((acc, p) => acc + p.cents, 0),
      30000
    )
  })
})
