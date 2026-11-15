/**
 * DOM-1 — Un monto de dinero, representado como una cantidad entera de centavos.
 *
 * Por que existe este tipo: en coma flotante, 0.1 + 0.2 no da 0.3. Un sistema
 * que reparte gastos y promete que los saldos suman cero no puede apoyarse en
 * eso. La defensa no es redondear al final — es no dejar que un decimal entre
 * al dominio. Por eso no hay ninguna via publica para construir un Money a
 * partir de un numero con parte decimal: se entra por centavos enteros o por
 * texto.
 *
 * El tipo es inmutable. Toda operacion devuelve un Money nuevo.
 */

/** Acepta "1234.56", "10", "-10.50". La coma como separador se normaliza antes. */
const MONTO_VALIDO = /^-?\d+(\.\d{1,2})?$/
/** Un monto bien formado pero con demasiada precision: "10.555". */
const DEMASIADOS_DECIMALES = /^-?\d+\.\d{3,}$/

export class Money {
  readonly #cents: number

  private constructor(cents: number) {
    this.#cents = cents
    Object.freeze(this)
  }

  /**
   * Construye desde una cantidad entera de centavos.
   *
   * Rechaza cualquier cosa que no sea un entero seguro. Esta es la puerta que
   * mantiene a los floats afuera: `Money.fromCents(10.5)` lanza, igual que
   * `Money.fromCents((0.1 + 0.2) * 100)`.
   */
  static fromCents(cents: number): Money {
    if (!Number.isInteger(cents)) {
      throw new TypeError(
        `Un monto se construye desde una cantidad entera de centavos; recibi ${cents}`
      )
    }
    if (!Number.isSafeInteger(cents)) {
      throw new RangeError(
        `${cents} esta fuera del rango de enteros seguros y no se puede representar sin perdida`
      )
    }
    return new Money(cents)
  }

  /**
   * Construye desde el texto que escribe una persona: "1234.56", "1234,56", "10".
   *
   * Rechaza mas de dos decimales en vez de redondear. Redondear en silencio es
   * exactamente la forma en que se pierde un centavo sin que nadie se entere, y
   * este sistema promete que los repartos cierran exacto.
   */
  static fromDecimalString(input: string): Money {
    const texto = String(input ?? '')
      .trim()
      .replace(',', '.')

    if (DEMASIADOS_DECIMALES.test(texto)) {
      throw new RangeError(
        `"${input}" tiene mas de dos decimales; un monto se expresa con dos decimales exactos`
      )
    }
    if (!MONTO_VALIDO.test(texto)) {
      throw new TypeError(`"${input}" no es un monto valido`)
    }

    const negativo = texto.startsWith('-')
    const [enteros, decimales = ''] = texto.replace('-', '').split('.')
    const cents = Number(enteros) * 100 + Number(decimales.padEnd(2, '0'))

    return Money.fromCents(negativo ? -cents : cents)
  }

  static zero(): Money {
    return new Money(0)
  }

  get cents(): number {
    return this.#cents
  }

  plus(other: Money): Money {
    return Money.fromCents(this.#cents + other.cents)
  }

  minus(other: Money): Money {
    return Money.fromCents(this.#cents - other.cents)
  }

  negated(): Money {
    return Money.fromCents(-this.#cents)
  }

  equals(other: Money): boolean {
    return this.#cents === other.cents
  }

  /** Negativo si este monto es menor, positivo si es mayor, cero si son iguales. */
  compare(other: Money): number {
    return this.#cents - other.cents
  }

  isZero(): boolean {
    return this.#cents === 0
  }

  isNegative(): boolean {
    return this.#cents < 0
  }

  isPositive(): boolean {
    return this.#cents > 0
  }

  /** Siempre dos decimales: "10.50", "0.05", "-10.50". */
  toString(): string {
    const signo = this.#cents < 0 ? '-' : ''
    const absoluto = Math.abs(this.#cents)
    const enteros = Math.floor(absoluto / 100)
    const decimales = String(absoluto % 100).padStart(2, '0')
    return `${signo}${enteros}.${decimales}`
  }

  /**
   * Lo que viaja por la API son centavos enteros, no texto formateado: el
   * formato depende de la configuracion regional de quien mira la pantalla, y
   * esa decision es del cliente.
   */
  toJSON(): number {
    return this.#cents
  }
}
