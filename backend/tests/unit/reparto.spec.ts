import { test } from '@japa/runner'
import { Money } from '#domain/money'
import { repartirEnPartesIguales } from '#domain/reparto'

/**
 * DOM-2 — Reparto en partes iguales con resto determinista.
 *
 * El criterio del ticket: $100 entre 3 da 3334/3333/3333, y la suma siempre
 * iguala el total. Esa segunda mitad es la invariante que sostiene al producto
 * entero: si un reparto pierde o inventa un centavo, los saldos dejan de sumar
 * cero y el plan de cierre se vuelve imposible de verificar.
 */

const cents = (n: number) => Money.fromCents(n)
const aCentavos = (montos: Money[]) => montos.map((m) => m.cents)
const sumar = (montos: Money[]) => montos.reduce((acc, m) => acc.plus(m), Money.zero())

/** Generador reproducible: la misma semilla da siempre la misma secuencia. */
function generador(semilla: number) {
  let estado = semilla
  return (max: number) => {
    estado = (estado * 1664525 + 1013904223) % 2 ** 32
    return estado % max
  }
}

test.group('reparto | el caso del ticket', () => {
  test('$100 entre 3 da 3334/3333/3333', ({ assert }) => {
    assert.deepEqual(aCentavos(repartirEnPartesIguales(cents(10000), 3)), [3334, 3333, 3333])
  })

  test('cuando divide exacto, todas las partes son iguales', ({ assert }) => {
    assert.deepEqual(aCentavos(repartirEnPartesIguales(cents(9000), 3)), [3000, 3000, 3000])
  })

  test('entre uno devuelve el total', ({ assert }) => {
    assert.deepEqual(aCentavos(repartirEnPartesIguales(cents(777), 1)), [777])
  })

  test('un total de cero reparte ceros', ({ assert }) => {
    assert.deepEqual(aCentavos(repartirEnPartesIguales(Money.zero(), 4)), [0, 0, 0, 0])
  })
})

test.group('reparto | la invariante que sostiene el producto', () => {
  test('la suma de las partes iguala el total, siempre', ({ assert }) => {
    const siguiente = generador(20261115)
    for (let caso = 0; caso < 2000; caso++) {
      const total = cents(siguiente(2_000_000) - 1_000_000)
      const partes = 1 + siguiente(15)
      const repartido = repartirEnPartesIguales(total, partes)

      assert.equal(repartido.length, partes)
      assert.equal(
        sumar(repartido).cents,
        total.cents,
        `fallo con total=${total.cents} partes=${partes}`
      )
    }
  })

  test('dos partes nunca difieren en mas de un centavo', ({ assert }) => {
    const siguiente = generador(42)
    for (let caso = 0; caso < 2000; caso++) {
      const total = cents(siguiente(2_000_000) - 1_000_000)
      const partes = 1 + siguiente(15)
      const valores = aCentavos(repartirEnPartesIguales(total, partes))

      const diferencia = Math.max(...valores) - Math.min(...valores)
      assert.isAtMost(diferencia, 1, `fallo con total=${total.cents} partes=${partes}`)
    }
  })

  test('es determinista: las mismas entradas dan el mismo resultado', ({ assert }) => {
    const primera = aCentavos(repartirEnPartesIguales(cents(10001), 7))
    const segunda = aCentavos(repartirEnPartesIguales(cents(10001), 7))
    assert.deepEqual(primera, segunda)
  })
})

test.group('reparto | montos negativos', () => {
  test('reparte un monto negativo sin perder centavos', ({ assert }) => {
    const repartido = repartirEnPartesIguales(cents(-10000), 3)
    assert.deepEqual(aCentavos(repartido), [-3334, -3333, -3333])
    assert.equal(sumar(repartido).cents, -10000)
  })

  test('la invariante tambien vale en negativo', ({ assert }) => {
    for (let total = -1; total > -500; total--) {
      for (let partes = 1; partes <= 8; partes++) {
        assert.equal(sumar(repartirEnPartesIguales(cents(total), partes)).cents, total)
      }
    }
  })
})

/**
 * El centavo que sobra tiene que caer en alguien, y si cae siempre en el mismo
 * integrante, esa persona paga de mas en todos los gastos del grupo. El reparto
 * se mantiene determinista — es un requisito del ticket y lo que hace que sea
 * testeable — pero acepta desde donde empezar, para que quien llame pueda rotar
 * usando algo estable del gasto en vez de dejar el sesgo fijo.
 */
test.group('reparto | a quien le toca el centavo que sobra', () => {
  test('por defecto el resto arranca en el primero', ({ assert }) => {
    assert.deepEqual(aCentavos(repartirEnPartesIguales(cents(100), 3)), [34, 33, 33])
  })

  test('desde corre el resto al integrante que se indique', ({ assert }) => {
    assert.deepEqual(aCentavos(repartirEnPartesIguales(cents(100), 3, 1)), [33, 34, 33])
    assert.deepEqual(aCentavos(repartirEnPartesIguales(cents(100), 3, 2)), [33, 33, 34])
  })

  test('desde da la vuelta cuando se pasa del final', ({ assert }) => {
    assert.deepEqual(aCentavos(repartirEnPartesIguales(cents(100), 3, 3)), [34, 33, 33])
    assert.deepEqual(aCentavos(repartirEnPartesIguales(cents(100), 3, 7)), [33, 34, 33])
  })

  test('cuando sobra mas de un centavo, se reparten consecutivos', ({ assert }) => {
    // 10 centavos entre 4: base 2, sobran 2.
    assert.deepEqual(aCentavos(repartirEnPartesIguales(cents(10), 4)), [3, 3, 2, 2])
    assert.deepEqual(aCentavos(repartirEnPartesIguales(cents(10), 4, 3)), [3, 2, 2, 3])
  })

  test('rotar no rompe la invariante', ({ assert }) => {
    for (let desde = 0; desde < 12; desde++) {
      assert.equal(sumar(repartirEnPartesIguales(cents(1001), 6, desde)).cents, 1001)
    }
  })
})

test.group('reparto | entradas invalidas', () => {
  test('rechaza repartir entre cero', ({ assert }) => {
    assert.throws(() => repartirEnPartesIguales(cents(100), 0), /al menos una parte/i)
  })

  test('rechaza una cantidad negativa de partes', ({ assert }) => {
    assert.throws(() => repartirEnPartesIguales(cents(100), -3), /al menos una parte/i)
  })

  test('rechaza una cantidad de partes que no es entera', ({ assert }) => {
    assert.throws(() => repartirEnPartesIguales(cents(100), 2.5), /enter[oa]/i)
  })

  test('rechaza un desde negativo o no entero', ({ assert }) => {
    assert.throws(() => repartirEnPartesIguales(cents(100), 3, -1), /enter[oa]/i)
    assert.throws(() => repartirEnPartesIguales(cents(100), 3, 1.5), /enter[oa]/i)
  })
})
