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
