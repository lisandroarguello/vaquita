import db from '@adonisjs/lucid/services/db'
import { centsDe } from '#repositories/cents'

/**
 * Los gastos y su reparto (API-4 / DAT-4).
 *
 * Sigue el patron que establecio `grupo_repository.ts`: SQL crudo, `trx`
 * opcional, escritura multi-tabla en transaccion. Lo que este repositorio
 * agrega es una obligacion que viene de DAT-2 y que no se puede saltear.
 *
 * ## `SET CONSTRAINTS ALL IMMEDIATE`, y por que esta en cada escritura
 *
 * El trigger que exige que las partes sumen el total es `DEFERRABLE INITIALLY
 * DEFERRED`: tiene que serlo, porque la fila del gasto existe antes que sus
 * partes. Eso significa que la violacion se levanta en el `COMMIT`, y ahi
 * **Lucid no la propaga**: la promesa resuelve como si todo hubiera salido bien.
 * Los datos se revierten igual —la base nunca queda inconsistente— pero la
 * aplicacion no se entera y devolveria un `201` por un gasto que no existe.
 *
 * Pedir la verificacion antes de cerrar convierte eso en el error de una
 * sentencia comun, que si llega con su `code` y su `constraint`. Sacar esa
 * linea no rompe la base: rompe la verdad de la respuesta, que es peor porque
 * no se ve. Esta medido y fijado en `tests/database/reparto_cierra.spec.ts`.
 */

type Ejecutor = Pick<typeof db, 'rawQuery'>

export interface ParteDelGasto {
  membresiaId: string
  cents: number
}

export interface GastoConReparto {
  id: string
  grupoId: string
  pagadoPor: string
  cargadoPor: string
  totalCents: number
  descripcion: string
  fecha: string
  modo: 'equal' | 'exact' | 'percentage'
  estado: 'active' | 'voided'
  origen: string
  partes: { membresiaId: string; nombre: string; cents: number }[]
}

export interface DatosDeGasto {
  grupoId: string
  pagadoPor: string
  cargadoPor: string
  totalCents: number
  descripcion: string
  fecha: string
  modo: 'equal' | 'exact' | 'percentage'
}

/**
 * Le pide a Postgres que verifique **ahora** las restricciones diferidas.
 *
 * Es la ultima sentencia de toda escritura de este archivo. Ver la cabecera.
 */
async function verificarAhora(trx: Ejecutor) {
  await trx.rawQuery(`SET CONSTRAINTS ALL IMMEDIATE`)
}

/**
 * Crea el gasto y su reparto, juntos.
 *
 * `armarPartes` recibe el id que la base acaba de generar, y eso no es un
 * detalle de implementacion: el reparto en partes iguales necesita rotar a quien
 * le toca el centavo que sobra (el `desde` de DOM-2), y el id del gasto es el
 * dato estable que hace esa rotacion determinista sin que el reparto deje de ser
 * una funcion pura. El efecto util es que editar un gasto no le mueve el centavo
 * a otra persona, porque el id no cambia.
 */
export async function crearGasto(
  datos: DatosDeGasto,
  armarPartes: (gastoId: string) => ParteDelGasto[],
  trx?: Ejecutor
): Promise<GastoConReparto> {
  const escribir = async (eje: Ejecutor) => {
    const { rows } = await eje.rawQuery(
      `INSERT INTO expenses (group_id, paid_by, created_by, amount_cents, description,
                             incurred_on, split_mode, status, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 'manual')
       RETURNING id`,
      [
        datos.grupoId,
        datos.pagadoPor,
        datos.cargadoPor,
        datos.totalCents,
        datos.descripcion,
        datos.fecha,
        datos.modo,
      ]
    )
    const gastoId = rows[0].id as string

    await insertarPartes(eje, gastoId, datos.grupoId, armarPartes(gastoId))
    await verificarAhora(eje)
    return gastoId
  }

  const gastoId = trx !== undefined ? await escribir(trx) : await db.transaction(escribir)
  const gasto = await gastoPorId(datos.grupoId, gastoId)
  return gasto!
}

async function insertarPartes(
  eje: Ejecutor,
  gastoId: string,
  grupoId: string,
  partes: ParteDelGasto[]
) {
  for (const parte of partes) {
    await eje.rawQuery(
      `INSERT INTO expense_shares (expense_id, membership_id, group_id, share_cents)
       VALUES (?, ?, ?, ?)`,
      [gastoId, parte.membresiaId, grupoId, parte.cents]
    )
  }
}

/**
 * Edita un gasto. Si viene `armarPartes`, **reemplaza** el reparto entero.
 *
 * Reemplazar y no corregir: un reparto es un conjunto, y "actualizar las partes
 * que cambiaron" obliga a decidir que hacer con las que desaparecieron y con las
 * que aparecieron. Borrar todo y volver a escribir es una operacion, cierra en
 * la misma transaccion y no deja estados intermedios que alguien pueda leer.
 */
export async function actualizarGasto(
  grupoId: string,
  gastoId: string,
  cambios: {
    pagadoPor?: string
    totalCents?: number
    descripcion?: string
    fecha?: string
    modo?: 'equal' | 'exact' | 'percentage'
  },
  armarPartes?: (gastoId: string) => ParteDelGasto[],
  trx?: Ejecutor
): Promise<GastoConReparto | null> {
  const escribir = async (eje: Ejecutor) => {
    const { rows } = await eje.rawQuery(
      `UPDATE expenses
          SET paid_by = COALESCE(?, paid_by),
              amount_cents = COALESCE(?, amount_cents),
              description = COALESCE(?, description),
              incurred_on = COALESCE(?, incurred_on),
              split_mode = COALESCE(?, split_mode)
        WHERE id = ? AND group_id = ?
        RETURNING id`,
      [
        cambios.pagadoPor ?? null,
        cambios.totalCents ?? null,
        cambios.descripcion ?? null,
        cambios.fecha ?? null,
        cambios.modo ?? null,
        gastoId,
        // El `group_id` esta repetido aca a proposito, igual que en
        // `grupo_repository`: que la capa de arriba ya haya chequeado el grupo no
        // es razon para que esta consulta pueda escribir en otro.
        grupoId,
      ]
    )
    if (rows.length === 0) return false

    if (armarPartes !== undefined) {
      await eje.rawQuery(`DELETE FROM expense_shares WHERE expense_id = ?`, [gastoId])
      await insertarPartes(eje, gastoId, grupoId, armarPartes(gastoId))
    }

    await verificarAhora(eje)
    return true
  }

  const existia = trx !== undefined ? await escribir(trx) : await db.transaction(escribir)
  if (!existia) return null

  return gastoPorId(grupoId, gastoId)
}

/**
 * Anula un gasto: pasa a `voided` y no se borra.
 *
 * Es historial del grupo, y borrar filas donde la gente discute plata es una
 * mala idea. Devuelve `null` si el gasto no es de ese grupo y `'ya_anulado'` si
 * ya estaba, para que la capa HTTP distinga el 404 del 409.
 */
export async function anularGasto(
  grupoId: string,
  gastoId: string,
  trx?: Ejecutor
): Promise<GastoConReparto | null | 'ya_anulado'> {
  const eje = trx ?? db

  const actual = await gastoPorId(grupoId, gastoId)
  if (actual === null) return null
  if (actual.estado === 'voided') return 'ya_anulado'

  // El trigger corre tambien con este UPDATE —esta sobre todo cambio de
  // `expenses`— y lo deja pasar: el reparto no se toca y sigue cerrando.
  await eje.rawQuery(`UPDATE expenses SET status = 'voided' WHERE id = ? AND group_id = ?`, [
    gastoId,
    grupoId,
  ])

  return gastoPorId(grupoId, gastoId)
}

/** Un gasto con su reparto, **si es de ese grupo**. */
export async function gastoPorId(
  grupoId: string,
  gastoId: string
): Promise<GastoConReparto | null> {
  const { rows } = await db.rawQuery(
    `SELECT id, group_id, paid_by, created_by, amount_cents, description,
            to_char(incurred_on, 'YYYY-MM-DD') AS incurred_on, split_mode, status, source
       FROM expenses
      WHERE id = ? AND group_id = ?`,
    [gastoId, grupoId]
  )
  if (rows.length === 0) return null

  const partes = await partesDe([rows[0].id])
  return armar(rows[0], partes.get(rows[0].id) ?? [])
}

/**
 * El historial del grupo, paginado, **con los anulados adentro**.
 *
 * Un gasto anulado no mueve plata pero si es parte de la discusion: sacarlo del
 * historial es la forma mas rapida de que alguien pregunte "y el asado que
 * cargamos?" y no haya respuesta.
 */
export async function gastosDe(
  grupoId: string,
  paginado: { pagina: number; porPagina: number }
): Promise<{ gastos: GastoConReparto[]; total: number }> {
  const { rows: cuenta } = await db.rawQuery(
    `SELECT count(*)::int AS n FROM expenses WHERE group_id = ?`,
    [grupoId]
  )

  const { rows } = await db.rawQuery(
    `SELECT id, group_id, paid_by, created_by, amount_cents, description,
            to_char(incurred_on, 'YYYY-MM-DD') AS incurred_on, split_mode, status, source
       FROM expenses
      WHERE group_id = ?
      ORDER BY incurred_on DESC, created_at DESC, id
      LIMIT ? OFFSET ?`,
    [grupoId, paginado.porPagina, (paginado.pagina - 1) * paginado.porPagina]
  )

  const partes = await partesDe(rows.map((r: { id: string }) => r.id))
  return {
    gastos: rows.map((r: Record<string, unknown>) => armar(r, partes.get(r.id as string) ?? [])),
    total: cuenta[0].n,
  }
}

/**
 * El reparto de varios gastos en una consulta.
 *
 * Una consulta por gasto convertiria el historial paginado en N+1 contra la
 * base; aca el N es "los gastos de una pagina", asi que una sola consulta con
 * `= ANY(?)` alcanza.
 */
async function partesDe(
  gastoIds: string[]
): Promise<Map<string, { membresiaId: string; nombre: string; cents: number }[]>> {
  const mapa = new Map<string, { membresiaId: string; nombre: string; cents: number }[]>()
  if (gastoIds.length === 0) return mapa

  const { rows } = await db.rawQuery(
    `SELECT s.expense_id, s.membership_id, s.share_cents, u.display_name
       FROM expense_shares s
       JOIN memberships m ON m.id = s.membership_id
       JOIN users u ON u.id = m.user_id
      WHERE s.expense_id = ANY(?)
      ORDER BY m.joined_at, m.id`,
    [gastoIds]
  )

  for (const fila of rows) {
    const lista = mapa.get(fila.expense_id) ?? []
    lista.push({
      membresiaId: fila.membership_id,
      nombre: fila.display_name,
      cents: centsDe(fila.share_cents, 'La parte de un reparto'),
    })
    mapa.set(fila.expense_id, lista)
  }
  return mapa
}

function armar(
  fila: Record<string, unknown>,
  partes: { membresiaId: string; nombre: string; cents: number }[]
): GastoConReparto {
  return {
    id: fila.id as string,
    grupoId: fila.group_id as string,
    pagadoPor: fila.paid_by as string,
    cargadoPor: fila.created_by as string,
    totalCents: centsDe(fila.amount_cents, 'El total de un gasto'),
    descripcion: fila.description as string,
    fecha: fila.incurred_on as string,
    modo: fila.split_mode as 'equal' | 'exact' | 'percentage',
    estado: fila.status as 'active' | 'voided',
    origen: fila.source as string,
    partes,
  }
}
