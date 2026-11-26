import { pedir } from './cliente'

/**
 * Los tipos son los de la seccion 7 del Readme, con los nombres de campo tal
 * como viajan por HTTP: `snake_case` y el sufijo `_cents` en los montos.
 *
 * No se renombran a `camelCase` al entrar. La tentacion es real, pero el costo
 * tambien: una capa de traduccion es un segundo lugar donde el contrato puede
 * estar mal, y cuando el backend agrega un campo hay que tocar dos archivos
 * para que llegue a la pantalla. Con los nombres crudos, un campo que cambia de
 * nombre rompe el typecheck en el unico lugar donde se usa.
 */
export interface GrupoListado {
  id: string
  name: string
  currency: string
  status: 'open' | 'closed'
  my_membership_id: string
  my_role: 'admin' | 'member'
  my_balance_cents: number
  member_count: number
}

export interface GrupoCreado {
  id: string
  name: string
  currency: string
  status: 'open' | 'closed'
  my_membership_id: string
  my_role: 'admin' | 'member'
}

/** La clave de cache del listado, en un solo lugar: la usan el alta y la vista. */
export const CLAVE_GRUPOS = ['grupos'] as const

export async function listarGrupos(): Promise<GrupoListado[]> {
  const { groups } = await pedir<{ groups: GrupoListado[] }>('/groups')
  return groups
}

/**
 * La moneda viaja **siempre**, aunque el backend tenga `ARS` por omision.
 *
 * El dia que el formulario ofrezca elegirla, el pedido ya es el mismo y no hay
 * que acordarse de agregar el campo; y mientras tanto el cuerpo que sale dice
 * exactamente en que moneda se esta creando el grupo, que es un dato que no se
 * puede cambiar despues.
 */
export async function crearGrupo(name: string, currency = 'ARS'): Promise<GrupoCreado> {
  const { group } = await pedir<{ group: GrupoCreado }>('/groups', {
    metodo: 'POST',
    cuerpo: { name, currency },
  })
  return group
}

/* ------------------------------------------------------------------ */
/* El detalle de un grupo y sus saldos (FE-3)                          */
/* ------------------------------------------------------------------ */

export interface Integrante {
  id: string
  display_name: string
  role: 'admin' | 'member'
  payout_alias: string | null
  active: boolean
}

export interface DetalleDeGrupo {
  group: GrupoCreado
  /** Vienen **todos**, activos e inactivos: el historial de gastos nombra
   * membresias de gente que ya no esta, y sin su fila no hay como ponerle
   * nombre a un `membership_id`. */
  members: Integrante[]
  totals: {
    expense_count: number
    expense_total_cents: number
    payment_count: number
  }
}

export interface Saldo {
  membership_id: string
  display_name: string
  balance_cents: number
}

export interface Balances {
  currency: string
  /** Cual de estos saldos es el de quien pregunta. Sin esto habria que cruzar
   * `/me` contra la lista de integrantes, y dos personas del mismo grupo
   * pueden llamarse igual. */
  my_membership_id: string
  balances: Saldo[]
  /**
   * La invariante de DOM-4 expuesta: la suma de los saldos da cero. **No es
   * decorativo.** Si llega en `false`, en el grupo falta o sobra plata y la
   * pantalla no muestra saldos: los mostraria para que alguien los copie a una
   * transferencia de verdad por un monto equivocado.
   */
  sums_to_zero: boolean
}

export const claveDeGrupo = (id: string) => ['grupo', id] as const
export const claveDeBalances = (id: string) => ['grupo', id, 'balances'] as const

export function cargarGrupo(id: string): Promise<DetalleDeGrupo> {
  return pedir<DetalleDeGrupo>(`/groups/${id}`)
}

export function cargarBalances(id: string): Promise<Balances> {
  return pedir<Balances>(`/groups/${id}/balances`)
}
