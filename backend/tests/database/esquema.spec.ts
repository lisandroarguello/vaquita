import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'

/**
 * DAT-1 — El esquema, verificado contra Postgres de verdad.
 *
 * Los tests insertan con SQL crudo a proposito: lo que se esta probando es la
 * base, no los modelos de Lucid (que todavia no existen). Si manana un modelo
 * valida lo mismo en TypeScript, estos tests siguen diciendo si la base aguanta
 * cuando alguien entra por otro lado —una migracion de datos, un `psql`, un
 * endpoint nuevo que se olvido de validar.
 *
 * Cada test que espera un rechazo verifica **el nombre de la restriccion**, no
 * solo que algo fallo. Un insert mal escrito tambien falla, y un test que mira
 * "fallo" se pone verde por el motivo equivocado: eso es "no pude mirar"
 * disfrazado de "esta mal".
 */

/** El error que devuelve `pg`, con lo que hace falta para identificar la causa. */
interface ErrorDePg extends Error {
  code?: string
  constraint?: string
}

/** Codigos SQLSTATE, para no escribir el numero suelto en cada assert. */
const VIOLA_CHECK = '23514'
const VIOLA_UNICO = '23505'
const VIOLA_FK = '23503'
const VIOLA_NO_NULO = '23502'

const TABLAS = [
  'users',
  'groups',
  'memberships',
  'invitations',
  'expenses',
  'expense_shares',
  'payments',
]

/** Corre algo que tiene que fallar y devuelve el error; null si no fallo. */
async function fallaCon(ejecutar: () => Promise<unknown>): Promise<ErrorDePg | null> {
  try {
    await ejecutar()
    return null
  } catch (error) {
    return error as ErrorDePg
  }
}

/**
 * Verifica que la base rechazo el insert por la restriccion esperada.
 *
 * Si no fallo nada, el mensaje lo dice asi: la restriccion no esta.
 */
function rechazadoPor(
  assert: { isNotNull: Function; equal: Function },
  error: ErrorDePg | null,
  codigo: string,
  restriccion: string
) {
  assert.isNotNull(error, `la base acepto la fila; falta la restriccion "${restriccion}"`)
  assert.equal(error!.code, codigo, `fallo pero con otro codigo: ${error!.message}`)
  assert.equal(error!.constraint, restriccion, `fallo pero por otra restriccion: ${error!.message}`)
}

let contador = 0

/** Un grupo armado de cero, con dos integrantes, listo para colgarle cosas. */
async function armarGrupo() {
  contador += 1
  const sufijo = contador
  const { rows: usuarios } = await db.rawQuery(
    `INSERT INTO users (email, password_hash, display_name)
     VALUES (?, 'hash', 'Ana'), (?, 'hash', 'Beto') RETURNING id`,
    [`ana${sufijo}@vaquita.test`, `beto${sufijo}@vaquita.test`]
  )
  const [ana, beto] = usuarios.map((u: { id: string }) => u.id)

  const { rows: grupos } = await db.rawQuery(
    `INSERT INTO groups (name, created_by) VALUES (?, ?) RETURNING id`,
    [`Grupo ${sufijo}`, ana]
  )
  const grupo = grupos[0].id

  const { rows: membresias } = await db.rawQuery(
    `INSERT INTO memberships (group_id, user_id, role)
     VALUES (?, ?, 'admin'), (?, ?, 'member') RETURNING id, role`,
    [grupo, ana, grupo, beto]
  )
  const admin = membresias.find((m: { role: string }) => m.role === 'admin').id
  const integrante = membresias.find((m: { role: string }) => m.role === 'member').id

  return { grupo, ana, beto, admin, integrante }
}

/**
 * Un gasto valido de $100 pagado por el admin, **con su reparto completo**.
 *
 * El reparto va adentro, y en la misma transaccion, desde DAT-2: el trigger
 * diferido exige que las partes de un gasto sumen su total, asi que un gasto
 * suelto ya no se puede commitear. Lo lleva entero el admin, que es el reparto
 * mas chico que cierra y deja a `integrante` libre para que cada test le cuelgue
 * lo que necesite probar.
 */
async function armarGasto(g: Awaited<ReturnType<typeof armarGrupo>>) {
  return db.transaction(async (trx) => {
    const { rows } = await trx.rawQuery(
      `INSERT INTO expenses (group_id, paid_by, created_by, amount_cents, description,
                             incurred_on, split_mode)
       VALUES (?, ?, ?, 10000, 'Asado', '2026-11-17', 'equal') RETURNING id`,
      [g.grupo, g.admin, g.admin]
    )
    await trx.rawQuery(
      `INSERT INTO expense_shares (expense_id, membership_id, group_id, share_cents)
       VALUES (?, ?, ?, 10000)`,
      [rows[0].id, g.admin, g.grupo]
    )
    return rows[0].id as string
  })
}

test.group('esquema | las tablas, las claves y los tipos', (group) => {
  group.each.setup(() => limpiar())

  test('estan las siete tablas del modelo', async ({ assert }) => {
    const { rows } = await db.rawQuery(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY(?)`,
      [TABLAS]
    )
    assert.sameMembers(
      rows.map((r: { table_name: string }) => r.table_name),
      TABLAS
    )
  })

  test('los montos son bigint, nunca float ni numeric', async ({ assert }) => {
    // La unidad del sistema es el centavo entero. Un `double precision` aca
    // deshace en silencio todo el trabajo de DOM-1: el redondeo vuelve a
    // entrar por la base.
    const { rows } = await db.rawQuery(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name IN ('amount_cents', 'share_cents')`
    )
    assert.isAbove(rows.length, 0, 'no encontre ninguna columna de montos')
    for (const fila of rows) {
      assert.equal(
        fila.data_type,
        'bigint',
        `${fila.table_name}.${fila.column_name} es ${fila.data_type}`
      )
    }
  })

  test('los ids los genera la base', async ({ assert }) => {
    // Sin esto, cada insert manual o semilla tiene que traer su propio uuid.
    const { rows } = await db.rawQuery(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ('sola@vaquita.test', 'hash', 'Sola') RETURNING id`
    )
    assert.match(
      rows[0].id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      'el id no parece un uuid generado'
    )
  })

  test('un gasto no se puede colgar de un grupo que no existe', async ({ assert }) => {
    const g = await armarGrupo()
    const error = await fallaCon(() =>
      db.rawQuery(
        `INSERT INTO expenses (group_id, paid_by, created_by, amount_cents, description,
                               incurred_on, split_mode)
         VALUES ('00000000-0000-0000-0000-000000000000', ?, ?, 10000, 'Asado',
                 '2026-11-17', 'equal')`,
        [g.admin, g.admin]
      )
    )
    assert.isNotNull(error)
    assert.equal(error!.code, VIOLA_FK)
  })

  test('un gasto sin monto no entra', async ({ assert }) => {
    const g = await armarGrupo()
    const error = await fallaCon(() =>
      db.rawQuery(
        `INSERT INTO expenses (group_id, paid_by, created_by, description, incurred_on, split_mode)
         VALUES (?, ?, ?, 'Asado', '2026-11-17', 'equal')`,
        [g.grupo, g.admin, g.admin]
      )
    )
    assert.isNotNull(error)
    assert.equal(error!.code, VIOLA_NO_NULO)
  })
})

test.group('esquema | los CHECK rechazan lo que no tiene sentido', (group) => {
  group.each.setup(() => limpiar())

  test('un gasto de cero o negativo no entra', async ({ assert }) => {
    const g = await armarGrupo()
    for (const monto of [0, -1]) {
      const error = await fallaCon(() =>
        db.rawQuery(
          `INSERT INTO expenses (group_id, paid_by, created_by, amount_cents, description,
                                 incurred_on, split_mode)
           VALUES (?, ?, ?, ?, 'Asado', '2026-11-17', 'equal')`,
          [g.grupo, g.admin, g.admin, monto]
        )
      )
      rechazadoPor(assert, error, VIOLA_CHECK, 'expenses_monto_positivo')
    }
  })

  test('un pago de cero o negativo no entra', async ({ assert }) => {
    const g = await armarGrupo()
    for (const monto of [0, -1]) {
      const error = await fallaCon(() =>
        db.rawQuery(
          `INSERT INTO payments (group_id, from_membership, to_membership, amount_cents, confirmed_by)
           VALUES (?, ?, ?, ?, ?)`,
          [g.grupo, g.admin, g.integrante, monto, g.admin]
        )
      )
      rechazadoPor(assert, error, VIOLA_CHECK, 'payments_monto_positivo')
    }
  })

  test('una parte de reparto negativa no entra, pero una en cero si', async ({ assert }) => {
    // Las dos caras del mismo borde. El cero es legitimo y hay que dejarlo
    // pasar: `repartirEnPartesIguales($0.01, 3)` da 1/0/0, y un reparto por
    // porcentajes admite 0%. Una parte **negativa** en cambio significa que el
    // grupo le esta pagando a alguien por un gasto, que no es un gasto.
    const g = await armarGrupo()
    const gasto = await armarGasto(g)

    const error = await fallaCon(() =>
      db.rawQuery(
        `INSERT INTO expense_shares (expense_id, membership_id, group_id, share_cents)
         VALUES (?, ?, ?, -1)`,
        [gasto, g.admin, g.grupo]
      )
    )
    rechazadoPor(assert, error, VIOLA_CHECK, 'expense_shares_parte_no_negativa')

    await db.rawQuery(
      `INSERT INTO expense_shares (expense_id, membership_id, group_id, share_cents)
       VALUES (?, ?, ?, 0)`,
      [gasto, g.integrante, g.grupo]
    )
    const { rows } = await db.rawQuery(`SELECT count(*)::int AS n FROM expense_shares`)
    // Dos: la del admin que `armarGasto` deja para que el gasto cierre, y esta.
    assert.equal(rows[0].n, 2, 'la parte en cero tendria que haber entrado')
  })

  test('un pago de alguien a si mismo no entra', async ({ assert }) => {
    const g = await armarGrupo()
    const error = await fallaCon(() =>
      db.rawQuery(
        `INSERT INTO payments (group_id, from_membership, to_membership, amount_cents, confirmed_by)
         VALUES (?, ?, ?, 5000, ?)`,
        [g.grupo, g.admin, g.admin, g.admin]
      )
    )
    rechazadoPor(assert, error, VIOLA_CHECK, 'payments_entre_dos_distintos')
  })

  test('los estados y modos fuera del conjunto no entran', async ({ assert }) => {
    const g = await armarGrupo()
    const casos = [
      {
        restriccion: 'groups_estado_conocido',
        sql: `INSERT INTO groups (name, created_by, status) VALUES ('X', ?, 'archivado')`,
        valores: [g.ana],
      },
      {
        restriccion: 'memberships_rol_conocido',
        sql: `INSERT INTO memberships (group_id, user_id, role) VALUES (?, ?, 'dueño')`,
        valores: [g.grupo, g.beto],
      },
      {
        restriccion: 'expenses_modo_conocido',
        sql: `INSERT INTO expenses (group_id, paid_by, created_by, amount_cents, description,
                                    incurred_on, split_mode)
              VALUES (?, ?, ?, 10000, 'X', '2026-11-17', 'a-ojo')`,
        valores: [g.grupo, g.admin, g.admin],
      },
      {
        restriccion: 'expenses_estado_conocido',
        sql: `INSERT INTO expenses (group_id, paid_by, created_by, amount_cents, description,
                                    incurred_on, split_mode, status)
              VALUES (?, ?, ?, 10000, 'X', '2026-11-17', 'equal', 'borrado')`,
        valores: [g.grupo, g.admin, g.admin],
      },
      {
        restriccion: 'expenses_origen_conocido',
        sql: `INSERT INTO expenses (group_id, paid_by, created_by, amount_cents, description,
                                    incurred_on, split_mode, source)
              VALUES (?, ?, ?, 10000, 'X', '2026-11-17', 'equal', 'audio')`,
        valores: [g.grupo, g.admin, g.admin],
      },
    ]

    for (const caso of casos) {
      const error = await fallaCon(() => db.rawQuery(caso.sql, caso.valores))
      rechazadoPor(assert, error, VIOLA_CHECK, caso.restriccion)
    }
  })

  test('la moneda tiene que ser un codigo ISO de tres letras', async ({ assert }) => {
    const g = await armarGrupo()
    const error = await fallaCon(() =>
      db.rawQuery(`INSERT INTO groups (name, created_by, currency) VALUES ('X', ?, 'pesos')`, [
        g.ana,
      ])
    )
    rechazadoPor(assert, error, VIOLA_CHECK, 'groups_moneda_iso')

    await db.rawQuery(`INSERT INTO groups (name, created_by, currency) VALUES ('X', ?, 'USD')`, [
      g.ana,
    ])
  })

  test('el mail se guarda en minuscula y la base lo exige', async ({ assert }) => {
    // Sin esto, "Ana@x.com" y "ana@x.com" son dos usuarios distintos y el
    // UNIQUE no sirve para nada: alguien se registra dos veces sin querer.
    const error = await fallaCon(() =>
      db.rawQuery(
        `INSERT INTO users (email, password_hash, display_name)
         VALUES ('Ana@Vaquita.test', 'hash', 'Ana')`
      )
    )
    rechazadoPor(assert, error, VIOLA_CHECK, 'users_mail_en_minuscula')
  })

  test('una invitacion no puede tener cero usos ni gastar mas de los que tiene', async ({
    assert,
  }) => {
    const g = await armarGrupo()
    const sinUsos = await fallaCon(() =>
      db.rawQuery(
        `INSERT INTO invitations (group_id, token, expires_at, max_uses)
         VALUES (?, 'tok-a', now() + interval '1 day', 0)`,
        [g.grupo]
      )
    )
    rechazadoPor(assert, sinUsos, VIOLA_CHECK, 'invitations_usos_positivos')

    const pasada = await fallaCon(() =>
      db.rawQuery(
        `INSERT INTO invitations (group_id, token, expires_at, max_uses, used_count)
         VALUES (?, 'tok-b', now() + interval '1 day', 2, 3)`,
        [g.grupo]
      )
    )
    rechazadoPor(assert, pasada, VIOLA_CHECK, 'invitations_usos_no_pasados')

    // La tercera restriccion de la tabla es su propia: `used_count <= max_uses`
    // no alcanza para atajar un contador negativo si `max_uses` es grande.
    const negativo = await fallaCon(() =>
      db.rawQuery(
        `INSERT INTO invitations (group_id, token, expires_at, max_uses, used_count)
         VALUES (?, 'tok-c', now() + interval '1 day', 5, -1)`,
        [g.grupo]
      )
    )
    rechazadoPor(assert, negativo, VIOLA_CHECK, 'invitations_usos_no_negativos')
  })
})

test.group('esquema | lo que es unico es unico', (group) => {
  group.each.setup(() => limpiar())

  test('la misma persona no entra dos veces al mismo grupo', async ({ assert }) => {
    const g = await armarGrupo()
    const error = await fallaCon(() =>
      db.rawQuery(`INSERT INTO memberships (group_id, user_id) VALUES (?, ?)`, [g.grupo, g.ana])
    )
    rechazadoPor(assert, error, VIOLA_UNICO, 'memberships_uno_por_grupo')
  })

  test('la misma persona no aparece dos veces en el reparto de un gasto', async ({ assert }) => {
    // Dos filas para la misma persona se suman, asi que el trigger de DAT-2
    // las dejaria pasar: la suma sigue dando el total. Lo que cambia es el
    // saldo, en silencio y al doble.
    //
    // Los dos montos son **distintos** a proposito. Con dos filas identicas el
    // test tambien pasaba, pero pasaba de mas: una unicidad que incluyera
    // `share_cents` por error —`(expense_id, membership_id, share_cents)`—
    // rechazaba igual la fila repetida y el test no se enteraba. Salio de un
    // mutante que sobrevivia por no llegar a dispararse.
    const g = await armarGrupo()
    // `armarGasto` ya dejo la parte del admin, de $100. Esta intenta ser la
    // segunda de la misma persona en el mismo gasto, por un monto distinto.
    const gasto = await armarGasto(g)
    const error = await fallaCon(() =>
      db.rawQuery(
        `INSERT INTO expense_shares (expense_id, membership_id, group_id, share_cents)
         VALUES (?, ?, ?, 3000)`,
        [gasto, g.admin, g.grupo]
      )
    )
    rechazadoPor(assert, error, VIOLA_UNICO, 'expense_shares_uno_por_gasto')
  })

  test('dos invitaciones no comparten token', async ({ assert }) => {
    const g = await armarGrupo()
    await db.rawQuery(
      `INSERT INTO invitations (group_id, token, expires_at)
       VALUES (?, 'mismo-token', now() + interval '1 day')`,
      [g.grupo]
    )
    const error = await fallaCon(() =>
      db.rawQuery(
        `INSERT INTO invitations (group_id, token, expires_at)
         VALUES (?, 'mismo-token', now() + interval '1 day')`,
        [g.grupo]
      )
    )
    rechazadoPor(assert, error, VIOLA_UNICO, 'invitations_token_unico')
  })

  test('dos usuarios no comparten mail', async ({ assert }) => {
    const error = await fallaCon(() =>
      db.rawQuery(
        `INSERT INTO users (email, password_hash, display_name)
         VALUES ('dup@vaquita.test', 'hash', 'Uno'), ('dup@vaquita.test', 'hash', 'Otro')`
      )
    )
    rechazadoPor(assert, error, VIOLA_UNICO, 'users_mail_unico')
  })
})

test.group('esquema | nada cruza de un grupo a otro', (group) => {
  group.each.setup(() => limpiar())

  // Este es el agujero que una clave foranea simple no tapa: `paid_by` apunta a
  // `memberships`, y una membresia de otro grupo tambien es una membresia
  // valida. El dominio ya lanza por esto en DOM-4 —un pagador de afuera deja
  // el credito afuera de la suma y los saldos dejan de dar cero—, asi que la
  // base lo sostiene con claves compuestas (id, group_id) en vez de confiar en
  // que todos los caminos de escritura se acuerden de validarlo.

  test('un gasto no lo paga alguien de otro grupo', async ({ assert }) => {
    const uno = await armarGrupo()
    const otro = await armarGrupo()
    const error = await fallaCon(() =>
      db.rawQuery(
        `INSERT INTO expenses (group_id, paid_by, created_by, amount_cents, description,
                               incurred_on, split_mode)
         VALUES (?, ?, ?, 10000, 'Asado', '2026-11-17', 'equal')`,
        [uno.grupo, otro.admin, uno.admin]
      )
    )
    rechazadoPor(assert, error, VIOLA_FK, 'expenses_pagador_del_grupo')
  })

  test('un gasto no lo carga alguien de otro grupo', async ({ assert }) => {
    const uno = await armarGrupo()
    const otro = await armarGrupo()
    const error = await fallaCon(() =>
      db.rawQuery(
        `INSERT INTO expenses (group_id, paid_by, created_by, amount_cents, description,
                               incurred_on, split_mode)
         VALUES (?, ?, ?, 10000, 'Asado', '2026-11-17', 'equal')`,
        [uno.grupo, uno.admin, otro.admin]
      )
    )
    rechazadoPor(assert, error, VIOLA_FK, 'expenses_cargador_del_grupo')
  })

  test('un reparto no incluye a alguien de otro grupo', async ({ assert }) => {
    const uno = await armarGrupo()
    const otro = await armarGrupo()
    const gasto = await armarGasto(uno)
    const error = await fallaCon(() =>
      db.rawQuery(
        `INSERT INTO expense_shares (expense_id, membership_id, group_id, share_cents)
         VALUES (?, ?, ?, 10000)`,
        [gasto, otro.admin, uno.grupo]
      )
    )
    rechazadoPor(assert, error, VIOLA_FK, 'expense_shares_integrante_del_grupo')
  })

  test('un reparto no se cuelga de un gasto de otro grupo', async ({ assert }) => {
    // La otra pierna de la misma clave compuesta: el `group_id` del reparto
    // tiene que ser el del gasto, no uno cualquiera donde el integrante exista.
    const uno = await armarGrupo()
    const otro = await armarGrupo()
    const gasto = await armarGasto(uno)
    const error = await fallaCon(() =>
      db.rawQuery(
        `INSERT INTO expense_shares (expense_id, membership_id, group_id, share_cents)
         VALUES (?, ?, ?, 10000)`,
        [gasto, otro.admin, otro.grupo]
      )
    )
    rechazadoPor(assert, error, VIOLA_FK, 'expense_shares_gasto_del_grupo')
  })

  test('un pago no sale ni entra de otro grupo', async ({ assert }) => {
    const uno = await armarGrupo()
    const otro = await armarGrupo()

    const desdeAfuera = await fallaCon(() =>
      db.rawQuery(
        `INSERT INTO payments (group_id, from_membership, to_membership, amount_cents, confirmed_by)
         VALUES (?, ?, ?, 5000, ?)`,
        [uno.grupo, otro.admin, uno.integrante, uno.admin]
      )
    )
    rechazadoPor(assert, desdeAfuera, VIOLA_FK, 'payments_pagador_del_grupo')

    const haciaAfuera = await fallaCon(() =>
      db.rawQuery(
        `INSERT INTO payments (group_id, from_membership, to_membership, amount_cents, confirmed_by)
         VALUES (?, ?, ?, 5000, ?)`,
        [uno.grupo, uno.admin, otro.integrante, uno.admin]
      )
    )
    rechazadoPor(assert, haciaAfuera, VIOLA_FK, 'payments_cobrador_del_grupo')
  })
})

test.group('esquema | las consultas que importan tienen indice', (group) => {
  group.each.setup(() => limpiar())

  test('cada clave foranea que se consulta por su lado tiene indice', async ({ assert }) => {
    // Postgres indexa la clave primaria y los UNIQUE, pero **no** las claves
    // foraneas. Sin indice, listar los gastos de un grupo o el reparto de un
    // gasto es un recorrido completo de la tabla, y es justo lo que hace la
    // pantalla de saldos cada vez que se abre.
    const esperados = [
      'memberships_user_id_index',
      'invitations_group_id_index',
      'expenses_group_id_incurred_on_index',
      'expenses_paid_by_index',
      'expense_shares_membership_id_index',
      'payments_group_id_index',
      'payments_from_membership_index',
      'payments_to_membership_index',
    ]
    const { rows } = await db.rawQuery(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`
    )
    const existentes = rows.map((r: { indexname: string }) => r.indexname)
    for (const indice of esperados) {
      assert.include(existentes, indice)
    }
  })

  test('el reparto de un gasto se borra con el gasto y nada mas', async ({ assert }) => {
    // Un reparto no tiene vida propia. El gasto, en cambio, no se borra nunca:
    // se anula. Esto fija el cascade para la unica fila que si es dependiente.
    const g = await armarGrupo()
    const gasto = await armarGasto(g)
    await db.rawQuery(`DELETE FROM expenses WHERE id = ?`, [gasto])
    const { rows } = await db.rawQuery(`SELECT count(*)::int AS n FROM expense_shares`)
    assert.equal(rows[0].n, 0)
  })

  test('un integrante con gastos no se puede borrar', async ({ assert }) => {
    // El historial manda: si alguien pago un asado, su membresia queda. Para
    // sacarlo del grupo esta `active = false`.
    const g = await armarGrupo()
    await armarGasto(g)
    const error = await fallaCon(() =>
      db.rawQuery(`DELETE FROM memberships WHERE id = ?`, [g.admin])
    )
    assert.isNotNull(error)
    assert.equal(error!.code, VIOLA_FK)
  })
})

/** Deja las siete tablas vacias. Sin transaccion global: un CHECK que salta */
/** adentro de una transaccion la envenena y los inserts que siguen fallan por */
/** el motivo equivocado. */
async function limpiar() {
  await db.rawQuery(`TRUNCATE ${TABLAS.join(', ')} CASCADE`)
}
