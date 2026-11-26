/**
 * El unico lugar del frontend que habla HTTP.
 *
 * Tres cosas que no se repiten en ninguna pantalla: el prefijo `/api/v1`, el
 * header `Authorization` con el token de la sesion, y la traduccion del error
 * del backend a algo que un componente pueda mostrar.
 */

import { tokenActual } from '../auth/token'

export const BASE = '/api/v1'

/** La forma unica de error del backend (`CLAUDE.md`, seccion Convenciones). */
export interface ErrorDeCampo {
  rule?: string
  field?: string
  message: string
}

/**
 * Un error de la API con su codigo de estado a la vista.
 *
 * El estado no es decoracion: el backend contesta **404 a un no integrante de
 * un grupo**, a proposito, para que un 403 no confirme que el grupo existe. Si
 * el cliente tratara el 404 como "error raro", la pantalla mostraria "algo
 * salio mal" donde lo correcto es "este grupo no esta disponible para vos". Por
 * eso el estado viaja hasta quien decide que mostrar, y no se aplana a un
 * booleano aca.
 */
export class ErrorApi extends Error {
  readonly estado: number
  readonly errores: ErrorDeCampo[]

  constructor(estado: number, errores: ErrorDeCampo[]) {
    super(errores[0]?.message ?? `La API respondio ${estado}`)
    this.name = 'ErrorApi'
    this.estado = estado
    this.errores = errores
  }

  /** El mensaje del campo pedido, si el backend lo señalo. */
  mensajeDe(campo: string): string | undefined {
    return this.errores.find((e) => e.field === campo)?.message
  }

  /**
   * El login no distingue "ese mail no existe" de "la contraseña esta mal", y
   * eso es deliberado del backend: cualquier diferencia lo convierte en un
   * oraculo de quien tiene cuenta. Su 401 llega **sin** `field`, asi que el
   * formulario no tiene con que marcar un campo y no debe inventarlo.
   */
  get esSesionInvalida(): boolean {
    return this.estado === 401
  }

  /** Ver `ErrorApi`: 404 es tambien "no sos integrante", no solo "no existe". */
  get esNoDisponible(): boolean {
    return this.estado === 404
  }
}

interface Opciones {
  metodo?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  cuerpo?: unknown
  /** El token explicito, para el arranque: ahi todavia no hay sesion montada. */
  token?: string | null
}

export async function pedir<T>(ruta: string, opciones: Opciones = {}): Promise<T> {
  const token = opciones.token === undefined ? tokenActual() : opciones.token

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (opciones.cuerpo !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers['Authorization'] = `Bearer ${token}`

  const respuesta = await fetch(`${BASE}${ruta}`, {
    method: opciones.metodo ?? 'GET',
    headers,
    body: opciones.cuerpo === undefined ? undefined : JSON.stringify(opciones.cuerpo),
  })

  if (!respuesta.ok) throw new ErrorApi(respuesta.status, await erroresDe(respuesta))

  // 204 y amigos: no hay cuerpo que parsear y `json()` tiraria.
  if (respuesta.status === 204) return undefined as T
  return (await respuesta.json()) as T
}

/**
 * Saca la lista de errores de una respuesta que fallo.
 *
 * El cuerpo puede no ser JSON —un 502 del proxy, un HTML de error— y en ese
 * caso lo que **no** se puede hacer es dejar que el `json()` tire su propio
 * error: el componente mostraria "Unexpected token <" en lugar de algo sobre la
 * operacion que el usuario intento.
 */
async function erroresDe(respuesta: Response): Promise<ErrorDeCampo[]> {
  try {
    const cuerpo = (await respuesta.json()) as { errors?: ErrorDeCampo[] }
    if (Array.isArray(cuerpo.errors) && cuerpo.errors.length > 0) return cuerpo.errors
  } catch {
    // Cuerpo que no es JSON: cae al mensaje generico de abajo.
  }
  return [{ message: `La API respondio ${respuesta.status}` }]
}
