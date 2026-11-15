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

/** Forma canonica, ya normalizada: "1234.56", "10", "-10.50". */
const MONTO_VALIDO = /^-?\d+(\.\d{1,2})?$/
/** Bien formado pero con demasiada precision: "10.5555". */
const DEMASIADOS_DECIMALES = /^-?\d+\.\d{3,}$/

/**
 * Formato local con coma decimal: "1234,56", "1.234,56", "1.234.567,89".
 * La coma fija la interpretacion: si esta, los puntos son separadores de miles.
 */
const CON_COMA_DECIMAL = /^-?(\d{1,3}(\.\d{3})+|\d+),\d{1,2}$/
/**
 * Miles con punto y sin coma, pero con dos grupos o mas: "1.234.567".
 * Ningun numero decimal tiene dos puntos, asi que no hay ambiguedad.
 */
const MILES_SIN_AMBIGUEDAD = /^-?\d{1,3}(\.\d{3}){2,}$/
/**
 * Un unico grupo de tres cifras despues de un punto: "1.500", "10.555".
 * Esto es genuinamente ambiguo — mil quinientos en Argentina, un peso con
 * cincuenta en formato ingles — y no se puede resolver adivinando.
 */
const AMBIGUO = /^-?\d{1,3}\.\d{3}$/

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
   * Construye desde el texto que escribe una persona.
   *
   * Acepta la forma canonica ("1234.56", "10", "-10.50") y el formato local
   * cuando no deja lugar a duda: "1.234,56" y "1.234.567" se entienden, porque
   * la coma decimal o el segundo punto fijan que los puntos son miles.
   *
   * Hay dos cosas que no hace, y las dos a proposito:
   *
   * No redondea cuando sobran decimales. Redondear en silencio es exactamente
   * la forma en que se pierde un centavo sin que nadie se entere, y este sistema
   * promete que los repartos cierran exacto.
   *
   * No adivina cuando el texto es ambiguo. "1.500" son mil quinientos para
   * quien lo escribe en Argentina y un peso con cincuenta para un parser
   * ingenuo; no hay informacion en el texto para decidir. Lanza nombrando la
   * ambiguedad y proponiendo las dos formas no ambiguas de escribirlo.
   */
  static fromDecimalString(input: string): Money {
    const texto = String(input ?? '').trim()

    if (AMBIGUO.test(texto)) {
      const comoEntero = texto.replace(/\./g, '')
      throw new RangeError(
        `"${input}" es ambiguo: no puedo saber si son ${comoEntero} o ${texto} con el punto ` +
          `como separador decimal. Escribilo como ${comoEntero} o como ${texto},00`
      )
    }

    const normalizado = Money.#normalizar(texto)

    if (DEMASIADOS_DECIMALES.test(normalizado)) {
      throw new RangeError(
        `"${input}" tiene mas de dos decimales; un monto se expresa con dos decimales exactos`
      )
    }
    if (!MONTO_VALIDO.test(normalizado)) {
      throw new TypeError(`"${input}" no es un monto valido`)
    }

    const negativo = normalizado.startsWith('-')
    const [enteros, decimales = ''] = normalizado.replace('-', '').split('.')
    const cents = Number(enteros) * 100 + Number(decimales.padEnd(2, '0'))

    return Money.fromCents(negativo ? -cents : cents)
  }

  /**
   * Lleva el formato local a la forma canonica con punto decimal. Solo toca el
   * texto cuando reconoce el formato sin ambiguedad; en cualquier otro caso lo
   * devuelve igual, para que la validacion de mas abajo decida y el mensaje de
   * error hable del texto que escribio la persona.
   */
  static #normalizar(texto: string): string {
    if (CON_COMA_DECIMAL.test(texto)) {
      return texto.replace(/\./g, '').replace(',', '.')
    }
    if (MILES_SIN_AMBIGUEDAD.test(texto)) {
      return texto.replace(/\./g, '')
    }
    return texto
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
