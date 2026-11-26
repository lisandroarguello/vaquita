import db from '@adonisjs/lucid/services/db'
import { Money } from '#domain/money'
import type { Gasto, IntegranteId, Pago } from '#domain/saldos'
import { centsDe } from '#repositories/cents'

/**
 * Lee un grupo entero de la base y lo entrega en los tipos del dominio.
 *
 * Es el unico lugar donde se traduce entre filas de Postgres y `Gasto` / `Pago`.
 * El dominio no sabe que existe una base de datos y no tiene que enterarse: esa
 * es la regla de `app/domain/` (seccion 5.4 del Readme), y lo que permite que
 * los 160 tests de dominio corran sin levantar nada.
 */

/** Un integrante tal como lo necesita la API: la membresia, no el usuario. */
export interface IntegranteDelGrupo {
  id: IntegranteId
  nombre: string
  alias: string | null
  activo: boolean
}

export interface GrupoCargado {
  id: string
  nombre: string
  moneda: string
  estado: string
  integrantes: IntegranteDelGrupo[]
  gastos: Gasto[]
  pagos: Pago[]
}

/**
 * Devuelve el grupo con sus integrantes, gastos y pagos, o `null` si no existe.
 *
 * Los gastos vienen con su reparto ya materializado, que es como el dominio los
 * espera: el reparto es un hecho historico y no se recalcula al leerlo.
 */
export async function cargarGrupo(grupoId: string): Promise<GrupoCargado | null> {
  const { rows: grupos } = await db.rawQuery(
    `SELECT id, name, currency, status FROM groups WHERE id = ?`,
    [grupoId]
  )
  if (grupos.length === 0) return null
  const grupo = grupos[0]

  const { rows: integrantes } = await db.rawQuery(
    `SELECT m.id, m.payout_alias, m.active, u.display_name
       FROM memberships m
       JOIN users u ON u.id = m.user_id
      WHERE m.group_id = ?
      ORDER BY m.joined_at, m.id`,
    [grupoId]
  )

  const { rows: gastos } = await db.rawQuery(
    `SELECT id, paid_by, amount_cents, status
       FROM expenses
      WHERE group_id = ?
      ORDER BY incurred_on, id`,
    [grupoId]
  )

  const { rows: partes } = await db.rawQuery(
    `SELECT expense_id, membership_id, share_cents
       FROM expense_shares
      WHERE group_id = ?
      ORDER BY membership_id`,
    [grupoId]
  )

  const { rows: pagos } = await db.rawQuery(
    `SELECT from_membership, to_membership, amount_cents
       FROM payments
      WHERE group_id = ?
      ORDER BY confirmed_at, id`,
    [grupoId]
  )

  const partesPorGasto = new Map<string, { integrante: IntegranteId; monto: Money }[]>()
  for (const parte of partes) {
    const lista = partesPorGasto.get(parte.expense_id) ?? []
    lista.push({
      integrante: parte.membership_id,
      monto: Money.fromCents(centsDe(parte.share_cents, 'La parte de un reparto')),
    })
    partesPorGasto.set(parte.expense_id, lista)
  }

  return {
    id: grupo.id,
    nombre: grupo.name,
    moneda: grupo.currency,
    estado: grupo.status,
    integrantes: integrantes.map((i: Record<string, unknown>) => ({
      id: i.id as string,
      nombre: i.display_name as string,
      alias: (i.payout_alias as string | null) ?? null,
      activo: i.active as boolean,
    })),
    gastos: gastos.map(
      (g: Record<string, unknown>): Gasto => ({
        pagadoPor: g.paid_by as string,
        total: Money.fromCents(centsDe(g.amount_cents, 'El total de un gasto')),
        partes: partesPorGasto.get(g.id as string) ?? [],
        anulado: g.status === 'voided',
      })
    ),
    pagos: pagos.map(
      (p: Record<string, unknown>): Pago => ({
        de: p.from_membership as string,
        para: p.to_membership as string,
        monto: Money.fromCents(centsDe(p.amount_cents, 'El monto de un pago')),
      })
    ),
  }
}

/** La membresia de alguien en un grupo, que es la unidad de autorizacion. */
export interface Membresia {
  id: string
  grupoId: string
  usuarioId: string
  rol: 'admin' | 'member'
}

/**
 * Devuelve la membresia **activa** de un usuario en un grupo, o `null`.
 *
 * `null` significa las tres cosas a la vez: el grupo no existe, existe y no sos
 * parte, o eras parte y te desactivaron. Que las tres sean el mismo `null` no es
 * pereza: es lo que permite que el middleware responda lo mismo en los tres
 * casos sin tener que acordarse de hacerlo (API-8).
 *
 * El `active = true` no es opcional. Sacar a alguien del grupo es `active =
 * false` y nunca un DELETE, porque ya es parte del historial de gastos; sin este
 * filtro, "sacado del grupo" seguiria leyendo todo el grupo.
 */
export async function membresiaDe(grupoId: string, usuarioId: string): Promise<Membresia | null> {
  const { rows } = await db.rawQuery(
    `SELECT m.id, m.group_id, m.user_id, m.role
       FROM memberships m
       JOIN groups g ON g.id = m.group_id
      WHERE m.group_id = ? AND m.user_id = ? AND m.active = true`,
    [grupoId, usuarioId]
  )
  if (rows.length === 0) return null

  return {
    id: rows[0].id,
    grupoId: rows[0].group_id,
    usuarioId: rows[0].user_id,
    rol: rows[0].role,
  }
}

/**
 * De aca abajo, la escritura (API-2 / DAT-4).
 *
 * Todas las funciones de escritura aceptan un `trx` opcional y corren sobre el
 * si lo reciben. El patron no es decorativo: en cuanto una operacion toque dos
 * tablas —y la primera, crear un grupo, ya toca dos— tiene que poder entrar en
 * una transaccion de quien la llama sin reescribirla. `gasto_repository.ts`,
 * `pago_repository.ts` e `invitacion_repository.ts` nacen con sus tickets
 * (API-4, API-7, API-3) y siguen esta misma forma.
 */

/** Lo que corre la consulta: la conexion por omision o la transaccion recibida. */
type Ejecutor = Pick<typeof db, 'rawQuery'>

function ejecutor(trx?: Ejecutor): Ejecutor {
  return trx ?? db
}

export type Rol = 'admin' | 'member'

export interface GrupoFila {
  id: string
  nombre: string
  moneda: string
  estado: string
}

/**
 * Crea el grupo **y su primera membresia**, en una transaccion.
 *
 * Son una sola operacion y no dos pasos que suelen salir bien. Un grupo sin
 * membresias no es un grupo vacio: la membresia es la unidad de autorizacion
 * (API-8), asi que a ese grupo su propio creador recibe 404 y no hay forma de
 * volver a entrar ni de borrarlo desde la aplicacion. Si la segunda consulta
 * falla, la primera tiene que desaparecer.
 */
export async function crearGrupoConMembresia(
  datos: { nombre: string; moneda: string; creadorId: string; rol?: Rol },
  trx?: Ejecutor
): Promise<{ grupo: GrupoFila; membresia: Membresia }> {
  // Si ya viene una transaccion de afuera, se usa esa: abrir una adentro de otra
  // seria un savepoint que nadie pidio.
  if (trx !== undefined) return insertarGrupo(datos, trx)

  return db.transaction((nueva) => insertarGrupo(datos, nueva))
}

async function insertarGrupo(
  datos: { nombre: string; moneda: string; creadorId: string; rol?: Rol },
  trx: Ejecutor
): Promise<{ grupo: GrupoFila; membresia: Membresia }> {
  const { rows: grupos } = await trx.rawQuery(
    `INSERT INTO groups (name, currency, created_by, status)
     VALUES (?, ?, ?, 'open')
     RETURNING id, name, currency, status`,
    [datos.nombre, datos.moneda, datos.creadorId]
  )
  const grupo = grupos[0]

  const { rows: membresias } = await trx.rawQuery(
    `INSERT INTO memberships (group_id, user_id, role)
     VALUES (?, ?, ?)
     RETURNING id, group_id, user_id, role`,
    [grupo.id, datos.creadorId, datos.rol ?? 'admin']
  )

  return {
    grupo: { id: grupo.id, nombre: grupo.name, moneda: grupo.currency, estado: grupo.status },
    membresia: {
      id: membresias[0].id,
      grupoId: membresias[0].group_id,
      usuarioId: membresias[0].user_id,
      rol: membresias[0].role,
    },
  }
}

/** Un grupo del que alguien es integrante, tal como lo necesita el listado. */
export interface GrupoDeUsuario extends GrupoFila {
  membresiaId: string
  rol: Rol
  integrantes: number
}

/**
 * Los grupos en los que alguien tiene membresia **activa**, los mas nuevos
 * primero.
 *
 * El `active = true` es el mismo filtro de `membresiaDe` y por el mismo motivo:
 * un grupo del que te desactivaron no se lista, porque tampoco se puede abrir.
 */
export async function gruposDe(usuarioId: string): Promise<GrupoDeUsuario[]> {
  const { rows } = await db.rawQuery(
    `SELECT g.id, g.name, g.currency, g.status, m.id AS membership_id, m.role,
            (SELECT count(*) FROM memberships o
              WHERE o.group_id = g.id AND o.active = true)::int AS integrantes
       FROM memberships m
       JOIN groups g ON g.id = m.group_id
      WHERE m.user_id = ? AND m.active = true
      ORDER BY g.created_at DESC, g.id`,
    [usuarioId]
  )

  return rows.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    nombre: r.name as string,
    moneda: r.currency as string,
    estado: r.status as string,
    membresiaId: r.membership_id as string,
    rol: r.role as Rol,
    integrantes: r.integrantes as number,
  }))
}

/**
 * Renombra el grupo o le cambia el estado. Lo que no viene, no se toca.
 *
 * `COALESCE(?, columna)` en vez de armar el SET segun los campos presentes: una
 * sola consulta, sin concatenar SQL, y un `undefined` no puede pisar un valor
 * con `null` por accidente.
 */
export async function actualizarGrupo(
  grupoId: string,
  cambios: { nombre?: string; estado?: 'open' | 'closed' },
  trx?: Ejecutor
): Promise<GrupoFila | null> {
  const { rows } = await ejecutor(trx).rawQuery(
    `UPDATE groups
        SET name = COALESCE(?, name), status = COALESCE(?, status)
      WHERE id = ?
      RETURNING id, name, currency, status`,
    [cambios.nombre ?? null, cambios.estado ?? null, grupoId]
  )
  if (rows.length === 0) return null

  return { id: rows[0].id, nombre: rows[0].name, moneda: rows[0].currency, estado: rows[0].status }
}

/** Un integrante con todo lo que la API expone de el. */
export interface IntegranteDetallado {
  id: string
  usuarioId: string
  nombre: string
  rol: Rol
  alias: string | null
  activo: boolean
}

export async function integrantesDe(grupoId: string): Promise<IntegranteDetallado[]> {
  const { rows } = await db.rawQuery(
    `SELECT m.id, m.user_id, m.role, m.payout_alias, m.active, u.display_name
       FROM memberships m
       JOIN users u ON u.id = m.user_id
      WHERE m.group_id = ?
      ORDER BY m.joined_at, m.id`,
    [grupoId]
  )

  return rows.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    usuarioId: r.user_id as string,
    nombre: r.display_name as string,
    rol: r.role as Rol,
    alias: (r.payout_alias as string | null) ?? null,
    activo: r.active as boolean,
  }))
}

/**
 * La membresia con ese id **dentro de ese grupo**, o `null`.
 *
 * El `group_id` del WHERE es la mitad del sentido de esta funcion. El `:mid` de
 * la URL lo escribe el cliente; sin ese filtro, ser administrador de un grupo
 * cualquiera alcanzaria para desactivar integrantes de todos los demas, y el
 * UNIQUE `(id, group_id)` que el esquema trae para eso no se estaria usando.
 */
export async function membresiaPorId(
  grupoId: string,
  membresiaId: string
): Promise<IntegranteDetallado | null> {
  const { rows } = await db.rawQuery(
    `SELECT m.id, m.user_id, m.role, m.payout_alias, m.active, u.display_name
       FROM memberships m
       JOIN users u ON u.id = m.user_id
      WHERE m.id = ? AND m.group_id = ?`,
    [membresiaId, grupoId]
  )
  if (rows.length === 0) return null

  return {
    id: rows[0].id,
    usuarioId: rows[0].user_id,
    nombre: rows[0].display_name,
    rol: rows[0].role,
    alias: rows[0].payout_alias ?? null,
    activo: rows[0].active,
  }
}

/**
 * Suma a alguien al grupo, o lo **reactiva** si ya estuvo.
 *
 * Reactivar no es una comodidad: el UNIQUE `(group_id, user_id)` no permite una
 * segunda membresia, y esta bien que no lo permita, porque la primera es la que
 * los gastos ya pagados referencian. Dar de alta una nueva dejaria la historia
 * colgada de una membresia inactiva.
 *
 * Devuelve `ya_estaba` para que la capa HTTP distinga el 201 del alta del 409
 * de agregar dos veces a alguien que ya esta adentro.
 */
export async function agregarIntegrante(
  datos: { grupoId: string; usuarioId: string; rol?: Rol },
  trx?: Ejecutor
): Promise<{ membresia: IntegranteDetallado; reactivado: boolean } | 'ya_estaba'> {
  const eje = ejecutor(trx)

  const { rows: existentes } = await eje.rawQuery(
    `SELECT id, active FROM memberships WHERE group_id = ? AND user_id = ?`,
    [datos.grupoId, datos.usuarioId]
  )

  if (existentes.length > 0) {
    if (existentes[0].active === true) return 'ya_estaba'

    await eje.rawQuery(`UPDATE memberships SET active = true WHERE id = ?`, [existentes[0].id])
    const membresia = await membresiaPorId(datos.grupoId, existentes[0].id)
    return { membresia: membresia!, reactivado: true }
  }

  const { rows } = await eje.rawQuery(
    `INSERT INTO memberships (group_id, user_id, role)
     VALUES (?, ?, ?)
     RETURNING id`,
    [datos.grupoId, datos.usuarioId, datos.rol ?? 'member']
  )
  const membresia = await membresiaPorId(datos.grupoId, rows[0].id)
  return { membresia: membresia!, reactivado: false }
}

/**
 * Cambia alias, rol o estado de una membresia. Lo que no viene, no se toca.
 *
 * El `AND group_id = ?` del WHERE esta por lo mismo que en `membresiaPorId`, y
 * esta repetido a proposito: que la capa de arriba ya haya chequeado el grupo no
 * es una razon para que esta consulta pueda escribir en otro.
 */
export async function actualizarMembresia(
  grupoId: string,
  membresiaId: string,
  cambios: { alias?: string | null; rol?: Rol; activo?: boolean },
  trx?: Ejecutor
): Promise<IntegranteDetallado | null> {
  const { rows } = await ejecutor(trx).rawQuery(
    `UPDATE memberships
        SET payout_alias = CASE WHEN ? THEN ? ELSE payout_alias END,
            role = COALESCE(?, role),
            active = COALESCE(?, active)
      WHERE id = ? AND group_id = ?
      RETURNING id`,
    [
      // El alias es el unico campo que se puede querer **borrar**, asi que
      // `null` es un valor y no "no vino": hace falta la bandera aparte.
      cambios.alias !== undefined,
      cambios.alias ?? null,
      cambios.rol ?? null,
      cambios.activo ?? null,
      membresiaId,
      grupoId,
    ]
  )
  if (rows.length === 0) return null

  return membresiaPorId(grupoId, membresiaId)
}

/**
 * Cuantos administradores activos quedan sin contar esa membresia.
 *
 * Un grupo sin administrador activo no se puede administrar nunca mas: nadie
 * agrega, nadie desactiva, nadie cierra. Es el mismo agujero que el grupo sin
 * membresias, un paso mas adelante, y la unica forma de evitarlo es contar antes
 * de escribir.
 */
export async function otrosAdminsActivos(
  grupoId: string,
  exceptoMembresia: string
): Promise<number> {
  const { rows } = await db.rawQuery(
    `SELECT count(*)::int AS n
       FROM memberships
      WHERE group_id = ? AND id <> ? AND role = 'admin' AND active = true`,
    [grupoId, exceptoMembresia]
  )
  return rows[0].n
}
