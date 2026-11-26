/**
 * Mostrar dinero. **Solo mostrar**: aca no hay ninguna funcion que sume.
 *
 * Los montos llegan del backend en centavos enteros, con el sufijo `_cents` en
 * el nombre del campo, para que ningun cliente los lea como decimales. Dividir
 * por 100 para dibujar un texto es correcto; dividir por 100 para operar
 * reintroduce el float que todo el dominio evita. Si alguna pantalla necesita
 * sumar, suma centavos enteros y recien despues llama aca.
 */

/** El idioma de la interfaz, no el de la moneda: separador de miles y coma. */
const LOCAL = 'es-AR'

/**
 * El monto, en **valor absoluto**.
 *
 * El signo no se dibuja con un menos: lo dice `saldoEnPalabras`. Un menos
 * adelante es un caracter de un pixel que decide si te deben o debes, y esa es
 * la clase de diferencia que se pierde en una lista leida rapido.
 */
export function montoATexto(cents: number, moneda: string): string {
  return new Intl.NumberFormat(LOCAL, {
    style: 'currency',
    currency: moneda,
    // Los dos centavos, siempre. Una columna donde algunos montos los tienen y
    // otros no se lee mal y hace sospechar un redondeo que no hubo.
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(cents) / 100)
}

export type Tono = 'acreedor' | 'deudor' | 'saldado'

/**
 * El signo del saldo, en palabras.
 *
 * Es el criterio de FE-3 —"signo legible sin depender solo del color"— y vale
 * igual en el listado: quien no distingue rojo de verde no tiene con que saber
 * si le deben o debe, y el color tampoco sobrevive a una captura en escala de
 * grises ni a un lector de pantalla.
 *
 * El **cero es su propio caso**, no "no positivo": decirle "debes $0,00" a quien
 * esta saldado lo manda a buscar una deuda que no existe, y ese es justamente el
 * estado que el producto persigue.
 */
export function saldoEnPalabras(cents: number): { tono: Tono; texto: string } {
  if (cents > 0) return { tono: 'acreedor', texto: 'te deben' }
  if (cents < 0) return { tono: 'deudor', texto: 'debés' }
  return { tono: 'saldado', texto: 'estás en cero' }
}
