import { Money } from '#domain/money'

/**
 * DOM-2 — Reparto de un monto en partes iguales.
 *
 * Un total casi nunca se divide exacto. $100 entre 3 da 33,33 y sobra un
 * centavo, y ese centavo tiene que ir a algun lado: no se puede tirar ni
 * duplicar. La regla de este modulo es que **la suma de las partes iguala el
 * total, siempre**, sin excepcion ni tolerancia. Es la invariante sobre la que
 * se apoya todo lo demas: si un reparto pierde un centavo, los saldos del grupo
 * dejan de sumar cero y el plan de cierre no se puede verificar.
 *
 * El reparto es determinista: las mismas entradas dan siempre el mismo
 * resultado. Eso es lo que lo hace testeable, pero trae un problema de equidad
 * — si el centavo que sobra cae siempre en el primer integrante, esa persona
 * paga de mas en cada gasto del grupo. Por eso la funcion acepta `desde`: quien
 * llama puede rotar a quien le toca usando algo estable del gasto (su id, por
 * ejemplo) sin que el reparto deje de ser una funcion pura.
 */
export function repartirEnPartesIguales(total: Money, partes: number, desde: number = 0): Money[] {
  if (!Number.isInteger(partes)) {
    throw new TypeError(`La cantidad de partes tiene que ser un numero entero; recibi ${partes}`)
  }
  if (partes < 1) {
    throw new RangeError(`Un reparto necesita al menos una parte; recibi ${partes}`)
  }
  if (!Number.isInteger(desde) || desde < 0) {
    throw new TypeError(`El indice "desde" tiene que ser un entero no negativo; recibi ${desde}`)
  }

  // Math.trunc y no Math.floor: con totales negativos, floor redondearia hacia
  // abajo y el resto quedaria con el signo cambiado.
  const base = Math.trunc(total.cents / partes)
  const resto = total.cents - base * partes

  // El resto conserva el signo del total: repartir -10000 entre 3 reparte un
  // centavo negativo de mas, no uno positivo de menos.
  const unidad = Math.sign(resto)
  const cuantosLlevanDeMas = Math.abs(resto)

  const repartido = Array.from({ length: partes }, () => base)
  for (let i = 0; i < cuantosLlevanDeMas; i++) {
    repartido[(desde + i) % partes] += unidad
  }

  return repartido.map(Money.fromCents)
}
