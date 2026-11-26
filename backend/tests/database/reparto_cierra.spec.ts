import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'

/**
 * DAT-2 — las partes de un gasto suman su total, y lo exige la base.
 *
 * Es la invariante de la que depende todo lo demas: si un reparto pierde o gana
 * un centavo, los saldos del grupo dejan de sumar cero (DOM-4 lanza) y el plan
 * de cierre no se puede verificar. El dominio ya la garantiza para lo que entra
 * por `app/domain/reparto.ts`; esto la sostiene para lo que entra por otro lado
 * —una migracion de datos, un `psql`, un endpoint que se olvido de validar.
 *
 * ## Por que el trigger tiene que ser diferido
 *
 * Un gasto es una fila y su reparto son N. La fila del gasto existe antes que
 * sus partes, por fuerza. Con un trigger inmediato, el primer `INSERT` de un
 * reparto de seis personas ya viola la condicion y **no hay forma de cargar un
 * gasto**. `DEFERRABLE INITIALLY DEFERRED` corre la verificacion al `COMMIT`,
 * que es el unico momento en que la pregunta tiene sentido.
 *
 * El corolario es el que ordena el resto del proyecto: **toda escritura de
 * gastos va en una transaccion.** Sin transaccion, cada `INSERT` es su propia
 * transaccion y el diferido no sirve de nada.
 *
 * ## Y el corolario del corolario, que costo medirlo
 *
 * **Lucid se come el error del `COMMIT`.** Una violacion diferida se levanta al
 * commitear, y ahi ni `db.transaction(callback)` ni `trx.commit()` la propagan:
 * la promesa resuelve como si todo hubiera salido bien. Los datos **si** se
 * revierten, asi que la base queda consistente, pero la aplicacion no se
 * entera y devolveria un `201` por un gasto que no existe. Eso es peor que no
 * tener la restriccion: una mentira prolija.
 *
 * Por eso toda escritura de gastos termina con `SET CONSTRAINTS ALL IMMEDIATE`
 * **adentro de la transaccion**: fuerza la verificacion en ese momento, y ahi el
 * error es el de una sentencia comun, que si se propaga con su `code` y su
 * `constraint`. Hay un test abajo que fija las dos mitades de esto para que
 * nadie saque el `SET CONSTRAINTS` pensando que es decorativo.
 */

interface ErrorDePg extends Error {
  code?: string
  constraint?: string
}

const VIOLA_CHECK = '23514'
const RESTRICCION = 'expense_shares_suman_el_total'

/**
 * `TRUNCATE` y no una tanda de `DELETE`, por el invariante mismo: un `DELETE
 * FROM expense_shares` deja gastos con el reparto en cero y el trigger lo
 * rechaza, con razon. `TRUNCATE` no dispara triggers de fila, que es
 * exactamente lo que hace falta para vaciar la base.
 */
async function limpiar() {
  await db.rawQuery(
    `TRUNCATE users, groups, memberships, invitations, expenses, expense_shares, payments CASCADE`
  )
}

/** Un grupo de dos, lo minimo para repartir algo. */
async function armarGrupo() {
  const { rows: usuarios } = await db.rawQuery(
    `INSERT INTO users (email, password_hash, display_name)
     VALUES ('ana@vaquita.test', 'hash', 'Ana'), ('beto@vaquita.test', 'hash', 'Beto')
     RETURNING id, email`
  )
  const ana = usuarios.find((u: { email: string }) => u.email.startsWith('ana')).id
  const beto = usuarios.find((u: { email: string }) => u.email.startsWith('beto')).id

  const { rows: grupos } = await db.rawQuery(
    `INSERT INTO groups (name, currency, created_by) VALUES ('Reparto', 'ARS', ?) RETURNING id`,
    [ana]
  )
  const grupo = grupos[0].id

  const { rows: membresias } = await db.rawQuery(
    `INSERT INTO memberships (group_id, user_id, role)
     VALUES (?, ?, 'admin'), (?, ?, 'member') RETURNING id, role`,
    [grupo, ana, grupo, beto]
  )

  return {
    grupo,
    uno: membresias.find((m: { role: string }) => m.role === 'admin').id as string,
    dos: membresias.find((m: { role: string }) => m.role === 'member').id as string,
  }
}

/**
 * Pide la verificacion de las restricciones diferidas **ahora**.
 *
 * Es la ultima sentencia de toda escritura de gastos, aca y en
 * `gasto_repository.ts`, y no es opcional: sin esto la violacion se levanta en
 * el `COMMIT` y Lucid no la propaga.
 */
async function verificarAhora(trx: { rawQuery: Function }) {
  await trx.rawQuery(`SET CONSTRAINTS ALL IMMEDIATE`)
}

/** Corre algo que tiene que fallar y devuelve el error; null si no fallo. */
async function fallaCon(ejecutar: () => Promise<unknown>): Promise<ErrorDePg | null> {
  try {
    await ejecutar()
    return null
  } catch (error) {
    return error as ErrorDePg
  }
}

function rechazadoPorElTrigger(
  assert: { isNotNull: Function; equal: Function },
  error: ErrorDePg | null
) {
  assert.isNotNull(
    error,
    `el trigger ${RESTRICCION} no esta: la base acepto un reparto que no cierra`
  )
  assert.equal(error!.code, VIOLA_CHECK, `el codigo no es el de una violacion de CHECK`)
  assert.equal(error!.constraint, RESTRICCION, 'fallo, pero por otra restriccion')
}

test.group('reparto | la base exige que las partes sumen el total', (group) => {
  group.each.setup(() => limpiar())
  group.each.teardown(() => limpiar())

  test('un gasto con su reparto bien armado entra', async ({ assert }) => {
    const g = await armarGrupo()

    await db.transaction(async (trx) => {
      const { rows } = await trx.rawQuery(
        `INSERT INTO expenses (group_id, paid_by, created_by, amount_cents, description,
                               incurred_on, split_mode)
         VALUES (?, ?, ?, 10001, 'Asado', '2026-11-17', 'equal') RETURNING id`,
        [g.grupo, g.uno, g.uno]
      )
      // 5001 + 5000 = 10001: el centavo que sobra va a alguien, no se tira.
      await trx.rawQuery(
        `INSERT INTO expense_shares (expense_id, membership_id, group_id, share_cents)
         VALUES (?, ?, ?, 5001), (?, ?, ?, 5000)`,
        [rows[0].id, g.uno, g.grupo, rows[0].id, g.dos, g.grupo]
      )
      await verificarAhora(trx)
    })

    const { rows } = await db.rawQuery(`SELECT count(*)::int AS n FROM expense_shares`)
    assert.equal(rows[0].n, 2, 'el reparto que cierra tendria que haber entrado')
  })

  test('un reparto que no suma falla **al commit**, no antes', async ({ assert }) => {
    // Lo que se verifica no es solo que falle: es **cuando**. Si fallara en el
    // primer INSERT, no habria forma de cargar un gasto de seis personas.
    const g = await armarGrupo()
    let primerInsertPaso = false

    const error = await fallaCon(() =>
      db.transaction(async (trx) => {
        const { rows } = await trx.rawQuery(
          `INSERT INTO expenses (group_id, paid_by, created_by, amount_cents, description,
                                 incurred_on, split_mode)
           VALUES (?, ?, ?, 10000, 'Asado', '2026-11-17', 'equal') RETURNING id`,
          [g.grupo, g.uno, g.uno]
        )
        await trx.rawQuery(
          `INSERT INTO expense_shares (expense_id, membership_id, group_id, share_cents)
           VALUES (?, ?, ?, 4000)`,
          [rows[0].id, g.uno, g.grupo]
        )
        // Si esta linea se alcanza, el trigger no se disparo todavia: es lo que
        // "diferido" significa, y es la mitad del test.
        primerInsertPaso = true
        await verificarAhora(trx)
      })
    )

    assert.isTrue(primerInsertPaso, 'el trigger se disparo antes del commit: no esta diferido')
    rechazadoPorElTrigger(assert, error)

    const { rows } = await db.rawQuery(`SELECT count(*)::int AS n FROM expenses`)
    assert.equal(rows[0].n, 0, 'el rollback tendria que haberse llevado el gasto tambien')
  })

  test('sin pedir la verificacion, el rechazo no llega a la aplicacion', async ({ assert }) => {
    // El test mas importante de este archivo, y el que mas cuesta creer.
    //
    // Una violacion diferida se levanta en el `COMMIT`, y ahi **Lucid no la
    // propaga**: la promesa resuelve como si todo hubiera salido bien. La base
    // queda consistente —los datos se revierten— pero la aplicacion devolveria
    // un 201 por un gasto que no existe.
    //
    // Esto fija las dos mitades del hallazgo: que la promesa resuelve y que
    // igual no se escribio nada. Si una version futura de Lucid empieza a
    // propagar el error, este test se pone rojo y lo dice, que es justo lo que
    // uno quiere que pase. Y mientras siga asi, es la razon por la que
    // `gasto_repository.ts` termina toda escritura con `SET CONSTRAINTS ALL
    // IMMEDIATE`: sacarlo no rompe la base, rompe la verdad de la respuesta.
    const g = await armarGrupo()

    let resolvio = false
    await db.transaction(async (trx) => {
      await trx.rawQuery(
        `INSERT INTO expenses (group_id, paid_by, created_by, amount_cents, description,
                               incurred_on, split_mode)
         VALUES (?, ?, ?, 10000, 'Asado', '2026-11-17', 'equal')`,
        [g.grupo, g.uno, g.uno]
      )
      // A proposito: **no** se llama a `verificarAhora`.
    })
    resolvio = true

    assert.isTrue(resolvio, 'si esto cambia, Lucid empezo a propagar el error del commit')
    const { rows } = await db.rawQuery(`SELECT count(*)::int AS n FROM expenses`)
    assert.equal(rows[0].n, 0, 'la base igual se protegio: el gasto no quedo')
  })

  test('un gasto sin ninguna parte no entra', async ({ assert }) => {
    // Un gasto sin reparto le acredita la plata al pagador y no le debita a
    // nadie: los saldos del grupo dejan de sumar cero. Es el caso que obliga a
    // que el trigger este tambien sobre `expenses` y no solo sobre las partes.
    const g = await armarGrupo()

    const error = await fallaCon(() =>
      db.transaction(async (trx) => {
        await trx.rawQuery(
          `INSERT INTO expenses (group_id, paid_by, created_by, amount_cents, description,
                                 incurred_on, split_mode)
           VALUES (?, ?, ?, 10000, 'Asado', '2026-11-17', 'equal')`,
          [g.grupo, g.uno, g.uno]
        )
        await verificarAhora(trx)
      })
    )
    rechazadoPorElTrigger(assert, error)
  })

  test('cambiarle el monto a un gasto sin tocar el reparto se rechaza', async ({ assert }) => {
    // Es el camino por el que se cuela el error mas facil de cometer: corregir
    // el total de un gasto y olvidarse de recalcular las partes.
    const g = await armarGrupo()
    const gasto = await gastoValido(g)

    const error = await fallaCon(() =>
      db.transaction(async (trx) => {
        await trx.rawQuery(`UPDATE expenses SET amount_cents = 99999 WHERE id = ?`, [gasto])
        await verificarAhora(trx)
      })
    )
    rechazadoPorElTrigger(assert, error)
  })

  test('borrarle una parte a un gasto se rechaza', async ({ assert }) => {
    const g = await armarGrupo()
    const gasto = await gastoValido(g)

    const error = await fallaCon(() =>
      db.transaction(async (trx) => {
        await trx.rawQuery(
          `DELETE FROM expense_shares WHERE expense_id = ? AND membership_id = ?`,
          [gasto, g.dos]
        )
        await verificarAhora(trx)
      })
    )
    rechazadoPorElTrigger(assert, error)
  })

  test('cambiarle el monto a una parte sin compensar se rechaza', async ({ assert }) => {
    const g = await armarGrupo()
    const gasto = await gastoValido(g)

    const error = await fallaCon(() =>
      db.transaction(async (trx) => {
        await trx.rawQuery(`UPDATE expense_shares SET share_cents = 1 WHERE expense_id = ?`, [
          gasto,
        ])
        await verificarAhora(trx)
      })
    )
    rechazadoPorElTrigger(assert, error)
  })

  test('corregir el monto y el reparto a la vez si entra', async ({ assert }) => {
    // La contracara del test de arriba, y la que hace que el trigger sea util en
    // vez de solo molesto: la edicion de un gasto (API-4) es exactamente esto.
    const g = await armarGrupo()
    const gasto = await gastoValido(g)

    await db.transaction(async (trx) => {
      await trx.rawQuery(`UPDATE expenses SET amount_cents = 30000 WHERE id = ?`, [gasto])
      await trx.rawQuery(`DELETE FROM expense_shares WHERE expense_id = ?`, [gasto])
      await trx.rawQuery(
        `INSERT INTO expense_shares (expense_id, membership_id, group_id, share_cents)
         VALUES (?, ?, ?, 15000), (?, ?, ?, 15000)`,
        [gasto, g.uno, g.grupo, gasto, g.dos, g.grupo]
      )
      await verificarAhora(trx)
    })

    const { rows } = await db.rawQuery(
      `SELECT sum(share_cents)::bigint AS suma FROM expense_shares WHERE expense_id = ?`,
      [gasto]
    )
    assert.equal(Number(rows[0].suma), 30000)
  })

  test('anular un gasto no toca el reparto y no lo rechaza', async ({ assert }) => {
    // Anular es un cambio de estado: el gasto sigue en el historial con sus
    // partes intactas. El trigger corre igual —esta sobre todo UPDATE de
    // `expenses`— y tiene que dejarlo pasar.
    const g = await armarGrupo()
    const gasto = await gastoValido(g)

    await db.transaction(async (trx) => {
      await trx.rawQuery(`UPDATE expenses SET status = 'voided' WHERE id = ?`, [gasto])
      await verificarAhora(trx)
    })

    const { rows } = await db.rawQuery(`SELECT status FROM expenses WHERE id = ?`, [gasto])
    assert.equal(rows[0].status, 'voided')
  })

  test('borrar un gasto se lleva su reparto sin que el trigger proteste', async ({ assert }) => {
    // El reparto se va en cascada y el trigger se dispara por cada parte
    // borrada. Si no mirara que el gasto ya no existe, un borrado valido
    // quedaria bloqueado para siempre.
    const g = await armarGrupo()
    const gasto = await gastoValido(g)

    await db.transaction(async (trx) => {
      await trx.rawQuery(`DELETE FROM expenses WHERE id = ?`, [gasto])
      await verificarAhora(trx)
    })

    const { rows } = await db.rawQuery(`SELECT count(*)::int AS n FROM expense_shares`)
    assert.equal(rows[0].n, 0)
  })
})

/** Un gasto de $200 repartido 100/100, ya commiteado. */
async function gastoValido(g: { grupo: string; uno: string; dos: string }): Promise<string> {
  return db.transaction(async (trx) => {
    const { rows } = await trx.rawQuery(
      `INSERT INTO expenses (group_id, paid_by, created_by, amount_cents, description,
                             incurred_on, split_mode)
       VALUES (?, ?, ?, 20000, 'Asado', '2026-11-17', 'equal') RETURNING id`,
      [g.grupo, g.uno, g.uno]
    )
    await trx.rawQuery(
      `INSERT INTO expense_shares (expense_id, membership_id, group_id, share_cents)
       VALUES (?, ?, ?, 10000), (?, ?, ?, 10000)`,
      [rows[0].id, g.uno, g.grupo, rows[0].id, g.dos, g.grupo]
    )
    await trx.rawQuery(`SET CONSTRAINTS ALL IMMEDIATE`)
    return rows[0].id as string
  })
}
