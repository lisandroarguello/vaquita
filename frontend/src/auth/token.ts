/**
 * El token de la sesion: en memoria, con copia en `localStorage`.
 *
 * **En memoria** porque es de donde lo lee cada pedido: leer `localStorage` en
 * cada `fetch` es I/O sincrono contra el disco en el camino de todas las
 * pantallas, y ademas una pestaña que ya arranco no deberia cambiar de usuario
 * porque otra pestaña escribio ahi.
 *
 * **Con copia en `localStorage`** porque sin eso recargar la pagina es cerrar
 * la sesion. Es el compromiso conocido: un XSS puede leerlo. La alternativa
 * —cookie `HttpOnly`— pide CSRF y un backend que emita cookies, y este emite
 * tokens `Bearer` (API-1). Queda anotado como riesgo asumido y no como
 * descuido.
 */

export const CLAVE = 'vaquita.token'

let enMemoria: string | null = null

/**
 * El acceso a `localStorage` va envuelto: en Safari en modo privado y con las
 * cookies de terceros bloqueadas, **tocarlo tira**. Una excepcion ahi dejaria
 * la aplicacion en blanco en el arranque, que es peor que no recordar la sesion.
 */
function almacen(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function tokenActual(): string | null {
  return enMemoria
}

/** Al arrancar: trae el token guardado a memoria y lo devuelve. */
export function rehidratarToken(): string | null {
  try {
    enMemoria = almacen()?.getItem(CLAVE) ?? null
  } catch {
    enMemoria = null
  }
  return enMemoria
}

export function guardarToken(token: string): void {
  enMemoria = token
  try {
    almacen()?.setItem(CLAVE, token)
  } catch {
    // Sin almacen la sesion vive solo mientras la pestaña este abierta, que es
    // degradado pero usable. Fallar el login por esto no lo seria.
  }
}

/**
 * Olvida el token en los **dos** lados.
 *
 * Borrar solo la copia en memoria deja el token en `localStorage`: la proxima
 * recarga lo rehidrata y el usuario que cerro sesion vuelve adentro. Y borrar
 * solo `localStorage` deja los pedidos en curso firmados con un token que el
 * usuario ya revoco.
 */
export function olvidarToken(): void {
  enMemoria = null
  try {
    almacen()?.removeItem(CLAVE)
  } catch {
    // Ver `almacen()`.
  }
}
