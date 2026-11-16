import { Money } from '#domain/money'
import { repartirPorMontosExactos } from '#domain/reparto'

/**
 * DOM-4 — Saldo neto de cada integrante, calculado desde gastos y pagos.
 *
 * El saldo de una persona es lo que puso menos lo que le corresponde poner.
 * Positivo quiere decir que le deben; negativo, que debe.
 *
 * La invariante de este modulo es que **la suma de todos los saldos es
 * exactamente cero**, siempre. No es una propiedad linda: es la precondicion
 * del minimizador de DOM-5. Si la suma no da cero, no existe ningun conjunto de
 * transferencias internas que deje a todos en cero, y el plan de cierre pasa de
 * ser subobtimo a ser imposible.
 *
 * Por que se cumple: cada gasto acredita el total a quien pago y debita las
 * partes, que por construccion suman ese mismo total — neto cero. Cada pago
 * acredita y debita el mismo monto — neto cero. Una suma de ceros es cero.
 *
 * Ese argumento se apoya en una condicion que el modulo no puede suponer: que
 * las partes de cada gasto sumen su total. Si no suman, el gasto mete o saca
 * plata del grupo y la invariante se cae. Por eso se verifica gasto por gasto y
 * se lanza nombrando la diferencia, en vez de devolver saldos que no cierran.
 *
 * Los saldos no se almacenan, se calculan: un saldo materializado es una
 * segunda fuente de verdad que tarde o temprano se desincroniza de los gastos.
 */

/** Identificador de un integrante dentro del grupo (la membresia, no el usuario). */
export type IntegranteId = string

/** Cuanto le toca poner a un integrante de un gasto puntual. */
export interface ParteDeGasto {
  integrante: IntegranteId
  monto: Money
}

/**
 * Un gasto ya cargado, con su reparto materializado. El reparto es un hecho
 * historico: viene resuelto desde `reparto.ts` en el momento de la carga y no
 * se recalcula aca, para que sumar gente al grupo no cambie los gastos viejos.
 */
export interface Gasto {
  pagadoPor: IntegranteId
  total: Money
  partes: ParteDeGasto[]
  /** Un gasto anulado sigue en el historial pero no influye en los saldos. */
  anulado?: boolean
}

/** Una transferencia ya confirmada entre dos integrantes del grupo. */
export interface Pago {
  de: IntegranteId
  para: IntegranteId
  monto: Money
}

export interface Saldo {
  integrante: IntegranteId
  monto: Money
}

/**
 * Calcula el saldo neto de cada integrante.
 *
 * Devuelve un saldo por integrante, en el mismo orden en que se recibieron: el
 * orden de presentacion es decision de quien llama, no de este modulo.
 */
export function calcularSaldos(
  integrantes: IntegranteId[],
  gastos: Gasto[],
  pagos: Pago[]
): Saldo[] {
  if (integrantes.length === 0) {
    throw new RangeError('Un grupo necesita al menos un integrante para tener saldos')
  }

  const cents = new Map<IntegranteId, number>()
  for (const integrante of integrantes) {
    if (cents.has(integrante)) {
      throw new RangeError(
        `El integrante "${integrante}" aparece repetido en el grupo; con un id duplicado su ` +
          `deuda se contaria dos veces`
      )
    }
    cents.set(integrante, 0)
  }

  /** Suma al saldo de alguien, verificando antes que ese alguien exista. */
  const acreditar = (integrante: IntegranteId, delta: number, donde: string) => {
    const actual = cents.get(integrante)
    if (actual === undefined) {
      throw new RangeError(
        `"${integrante}" no es integrante de este grupo y aparece en ${donde}; su parte quedaria ` +
          `afuera de los saldos y la suma no daria cero`
      )
    }
    // Pasa por Money para heredar su control de rango: un saldo que se sale del
    // entero seguro tiene que lanzar, no redondearse.
    cents.set(integrante, Money.fromCents(actual).plus(Money.fromCents(delta)).cents)
  }

  for (const gasto of gastos) {
    if (gasto.anulado) continue

    // Verifica que el reparto cierre y lanza nombrando la diferencia. Es la
    // misma comprobacion que hace el trigger de la base, aca arriba: si las
    // partes no suman el total, la invariante de suma cero no se sostiene.
    repartirPorMontosExactos(
      gasto.total,
      gasto.partes.map((parte) => parte.monto)
    )

    const vistos = new Set<IntegranteId>()
    for (const parte of gasto.partes) {
      if (vistos.has(parte.integrante)) {
        throw new RangeError(
          `El integrante "${parte.integrante}" aparece repetido en las partes de un gasto de ` +
            `$${gasto.total.toString()}; el reparto no dice cuanto le toca`
        )
      }
      vistos.add(parte.integrante)
      acreditar(parte.integrante, -parte.monto.cents, 'las partes de un gasto')
    }

    acreditar(gasto.pagadoPor, gasto.total.cents, 'el pagador de un gasto')
  }

  for (const pago of pagos) {
    if (pago.de === pago.para) {
      throw new RangeError(
        `"${pago.de}" no puede registrar un pago a si mismo; no mueve ningun saldo`
      )
    }
    // Quien transfiere queda menos en deuda; quien recibe deja de tener esa
    // plata a favor. Un pago mueve a los dos hacia cero sin cambiar la suma.
    acreditar(pago.de, pago.monto.cents, 'un pago')
    acreditar(pago.para, -pago.monto.cents, 'un pago')
  }

  return integrantes.map((integrante) => ({
    integrante,
    monto: Money.fromCents(cents.get(integrante)!),
  }))
}
