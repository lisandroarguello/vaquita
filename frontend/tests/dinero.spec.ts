import { describe, expect, test } from 'vitest'
import { montoATexto, saldoEnPalabras } from '../src/dinero'

/**
 * El dinero llega del backend en **centavos enteros** y con el sufijo `_cents`
 * en el nombre del campo, justamente para que ningun cliente lo lea como
 * decimales. Dividir por 100 para mostrarlo es correcto; dividir por 100 para
 * **operar** no, y por eso aca no hay ninguna funcion que sume.
 */
describe('dinero | como se muestra un monto', () => {
  test('separa los miles y usa coma para los centavos', () => {
    expect(montoATexto(1234567, 'ARS')).toMatch(/12\.345,67/)
  })

  test('siempre muestra los dos centavos, incluso cuando son cero', () => {
    // "$500" y "$500,00" son el mismo numero, pero una columna de montos donde
    // algunos tienen centavos y otros no se lee mal y se sospecha redondeo.
    expect(montoATexto(50000, 'ARS')).toMatch(/500,00/)
  })

  test('muestra el valor absoluto: el signo lo dice la palabra, no el menos', () => {
    expect(montoATexto(-50000, 'ARS')).not.toMatch(/-/)
  })

  test('respeta la moneda del grupo', () => {
    // El grupo elige la moneda al crearse y los montos quedan en esa: mostrar
    // todo con el simbolo de pesos seria mentir sobre lo que se debe.
    expect(montoATexto(1000, 'USD')).toMatch(/US\$|\$/)
    expect(montoATexto(1000, 'EUR')).toMatch(/€|EUR/)
  })
})

describe('dinero | el signo en palabras', () => {
  test('positivo es que te deben', () => {
    expect(saldoEnPalabras(1).tono).toBe('acreedor')
    expect(saldoEnPalabras(1).texto).toMatch(/te deben/i)
  })

  test('negativo es que debes', () => {
    expect(saldoEnPalabras(-1).tono).toBe('deudor')
    expect(saldoEnPalabras(-1).texto).toMatch(/deb[eé]s/i)
  })

  /**
   * El cero es su propio caso y no "no positivo". Decirle "debes $0,00" a quien
   * esta saldado lo manda a buscar una deuda que no existe, y es justo el
   * estado que el producto busca: el cierre de la vaquita deja a todos aca.
   */
  test('cero es estar en cero, y no cae del lado del que debe', () => {
    expect(saldoEnPalabras(0).tono).toBe('saldado')
    expect(saldoEnPalabras(0).texto).toMatch(/en cero/i)
    expect(saldoEnPalabras(0).texto).not.toMatch(/deb[eé]s/i)
  })
})
