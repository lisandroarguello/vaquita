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

/** Un porcentaje, expresado en centesimas de punto: 10000 es el 100%. */
export type Porcentaje = number

/** 100% en centesimas de punto. */
const CIEN_POR_CIENTO = 10_000

/** Un porcentaje escrito por una persona: "50", "33.33", "33,33". */
const PORCENTAJE_VALIDO = /^-?\d{1,3}(\.\d{1,2})?$/
const PORCENTAJE_DEMASIADO_PRECISO = /^-?\d{1,3}\.\d{3,}$/

/**
 * DOM-3 — Convierte el porcentaje que escribe una persona a centesimas de
 * punto: "33.33" devuelve 3333.
 *
 * Un porcentaje con decimales es un decimal, y un decimal en coma flotante
 * trae el mismo problema que este modulo entero se ocupa de evitar. Por eso se
 * guarda como entero.
 *
 * No se parsea con las reglas de un monto, aunque la tentacion de reusar
 * `Money.fromDecimalString` sea obvia: un monto tiene separador de miles y un
 * porcentaje no, porque no llega a mil. Con las reglas de monto, "33.333" se
 * rechaza por ambiguo — podria ser treinta y tres mil — cuando en un porcentaje
 * el unico problema real es que tiene un decimal de mas.
 */
export function porcentaje(texto: string): Porcentaje {
  const normalizado = String(texto ?? '')
    .trim()
    .replace(',', '.')

  if (PORCENTAJE_DEMASIADO_PRECISO.test(normalizado)) {
    throw new RangeError(
      `"${texto}" tiene mas de dos decimales; un porcentaje se expresa con dos como maximo`
    )
  }
  if (!PORCENTAJE_VALIDO.test(normalizado)) {
    throw new TypeError(`"${texto}" no es un porcentaje valido`)
  }

  const [enteros, decimales = ''] = normalizado.replace('-', '').split('.')
  const centesimas = Number(enteros) * 100 + Number(decimales.padEnd(2, '0'))
  const conSigno = normalizado.startsWith('-') ? -centesimas : centesimas

  if (conSigno < 0 || conSigno > CIEN_POR_CIENTO) {
    throw new RangeError(`Un porcentaje tiene que estar entre 0 y 100; recibi "${texto}"`)
  }
  return conSigno
}

/** "faltan $12.50" / "sobran $10.00", segun el signo de la diferencia. */
function describirDiferencia(diferencia: Money, unidad: string): string {
  return diferencia.isNegative()
    ? `faltan ${unidad}${diferencia.negated().toString()}`
    : `sobran ${unidad}${diferencia.toString()}`
}

/**
 * DOM-3 — Reparto por montos exactos.
 *
 * No reparte nada: verifica. Cada integrante ya dijo cuanto le toca y lo unico
 * que falta es comprobar que la cuenta cierre. El valor esta en el error: decir
 * "los montos no suman el total" obliga a rehacer la cuenta a mano, decir
 * "faltan $12.50" la da hecha.
 */
export function repartirPorMontosExactos(total: Money, montos: Money[]): Money[] {
  if (montos.length === 0) {
    throw new RangeError('Un reparto necesita al menos una parte')
  }

  const suma = montos.reduce((acc, m) => acc.plus(m), Money.zero())
  const diferencia = suma.minus(total)

  if (!diferencia.isZero()) {
    throw new RangeError(
      `Los montos no cierran con el total de $${total.toString()}: ` +
        `${describirDiferencia(diferencia, '$')}`
    )
  }

  return [...montos]
}

/**
 * DOM-3 — Reparto por porcentajes.
 *
 * El resto se asigna por el metodo del mayor residuo: el centavo sobrante va a
 * quien quedo con la fraccion pendiente mas grande, que es el reparto que menos
 * se aleja de los porcentajes pedidos. Los empates se resuelven por orden de
 * aparicion, para que el resultado sea reproducible.
 */
export function repartirPorPorcentajes(total: Money, porcentajes: Porcentaje[]): Money[] {
  if (porcentajes.length === 0) {
    throw new RangeError('Un reparto necesita al menos una parte')
  }

  const sumaPorcentajes = porcentajes.reduce((acc, p) => acc + p, 0)
  if (sumaPorcentajes !== CIEN_POR_CIENTO) {
    const diferencia = Money.fromCents(sumaPorcentajes - CIEN_POR_CIENTO)
    throw new RangeError(
      `Los porcentajes no suman 100: ${describirDiferencia(diferencia, '')} puntos`
    )
  }

  // El calculo exacto necesita total * porcentaje como entero. Con montos
  // suficientemente grandes ese producto se sale del rango seguro y el reparto
  // empezaria a perder centavos en silencio: mejor decirlo.
  if (!Number.isSafeInteger(total.cents * CIEN_POR_CIENTO)) {
    throw new RangeError(
      `El total $${total.toString()} es demasiado grande para repartirlo por ` +
        `porcentajes sin perder precision`
    )
  }

  const partes = porcentajes.map((p, indice) => {
    const producto = total.cents * p
    const base = Math.trunc(producto / CIEN_POR_CIENTO)
    return { indice, base, fraccion: Math.abs(producto - base * CIEN_POR_CIENTO) }
  })

  const asignado = partes.reduce((acc, parte) => acc + parte.base, 0)
  const resto = total.cents - asignado
  const unidad = Math.sign(resto)

  const porMayorFraccion = [...partes].sort(
    (a, b) => b.fraccion - a.fraccion || a.indice - b.indice
  )
  for (let i = 0; i < Math.abs(resto); i++) {
    partes[porMayorFraccion[i % partes.length].indice].base += unidad
  }

  return partes.map((parte) => Money.fromCents(parte.base))
}
