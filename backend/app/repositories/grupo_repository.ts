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
