import { test } from '@japa/runner'
import { Money } from '#domain/money'
import {
  repartirPorMontosExactos,
  repartirPorPorcentajes,
  porcentaje,
} from '#domain/reparto'

/**
 * DOM-3 — Reparto por montos exactos y por porcentajes.
 *
 * El criterio del ticket es "rechaza sumas que no cierran, indicando la
 * diferencia". Lo segundo importa tanto como lo primero: un error que dice
 * "los montos no suman el total" obliga a la persona a rehacer la cuenta a
 * mano. Uno que dice "faltan $12,50" le da la respuesta.
 */

const cents = (n: number) => Money.fromCents(n)
const aCentavos = (montos: Money[]) => montos.map((m) => m.cents)
const sumar = (montos: Money[]) => montos.reduce((acc, m) => acc.plus(m), Money.zero())

test.group('montos exactos | cuando cierran', () => {
  test('devuelve los mismos montos', ({ assert }) => {
    const partes = [cents(5000), cents(3000), cents(2000)]
    assert.deepEqual(aCentavos(repartirPorMontosExactos(cents(10000), partes)), [5000, 3000, 2000])
  })

  test('acepta montos en cero', ({ assert }) => {
    // Alguien que no participo de ese gasto puntual.
    const partes = [cents(10000), Money.zero()]
    assert.deepEqual(aCentavos(repartirPorMontosExactos(cents(10000), partes)), [10000, 0])
  })

  test('acepta un total negativo con partes negativas', ({ assert }) => {
    const partes = [cents(-6000), cents(-4000)]
    assert.equal(sumar(repartirPorMontosExactos(cents(-10000), partes)).cents, -10000)
  })
})

test.group('montos exactos | cuando no cierran', () => {
  test('dice cuanto falta', ({ assert }) => {
    try {
      repartirPorMontosExactos(cents(10000), [cents(5000), cents(3750)])
      assert.fail('deberia haber lanzado')
    } catch (error: any) {
      assert.match(error.message, /faltan/i)
      assert.match(error.message, /12\.50/)
    }
  })

  test('dice cuanto sobra', ({ assert }) => {
    try {
      repartirPorMontosExactos(cents(10000), [cents(5000), cents(6000)])
      assert.fail('deberia haber lanzado')
    } catch (error: any) {
      assert.match(error.message, /sobran/i)
      assert.match(error.message, /10\.00/)
    }
  })

  test('un solo centavo de diferencia tambien se rechaza', ({ assert }) => {
    assert.throws(() => repartirPorMontosExactos(cents(10000), [cents(9999)]), /faltan.*0\.01/is)
  })

  test('rechaza una lista vacia', ({ assert }) => {
    assert.throws(() => repartirPorMontosExactos(cents(100), []), /al menos una parte/i)
  })
})

test.group('porcentaje | se expresa sin floats', () => {
  test('parsea desde texto a centesimas de punto', ({ assert }) => {
    assert.equal(porcentaje('50'), 5000)
    assert.equal(porcentaje('33.33'), 3333)
    assert.equal(porcentaje('33,33'), 3333)
    assert.equal(porcentaje('100'), 10000)
  })

  test('rechaza mas de dos decimales', ({ assert }) => {
    assert.throws(() => porcentaje('33.333'), /dos decimales/i)
  })

  test('rechaza porcentajes fuera de rango', ({ assert }) => {
    assert.throws(() => porcentaje('-1'), /entre 0 y 100/i)
    assert.throws(() => porcentaje('101'), /entre 0 y 100/i)
  })
})

test.group('porcentajes | cuando no cierran', () => {
  test('dice cuanto falta para llegar a 100', ({ assert }) => {
    try {
      repartirPorPorcentajes(cents(10000), [porcentaje('60'), porcentaje('30')])
      assert.fail('deberia haber lanzado')
    } catch (error: any) {
      assert.match(error.message, /faltan/i)
      assert.match(error.message, /10/)
    }
  })

  test('dice cuanto se pasa de 100', ({ assert }) => {
    assert.throws(
      () => repartirPorPorcentajes(cents(10000), [porcentaje('60'), porcentaje('50')]),
      /sobran.*10/is
    )
  })

  test('rechaza una lista vacia', ({ assert }) => {
    assert.throws(() => repartirPorPorcentajes(cents(100), []), /al menos una parte/i)
  })
})

test.group('porcentajes | reparto', () => {
  test('60/40 de un total que divide exacto', ({ assert }) => {
    const partes = repartirPorPorcentajes(cents(10000), [porcentaje('60'), porcentaje('40')])
    assert.deepEqual(aCentavos(partes), [6000, 4000])
  })

  test('el centavo que sobra va a la fraccion mas grande', ({ assert }) => {
    // 10001 centavos: 60% son 6000.6 y 40% son 4000.4. El de mayor fraccion
    // pendiente se lleva el centavo.
    const partes = repartirPorPorcentajes(cents(10001), [porcentaje('60'), porcentaje('40')])
    assert.deepEqual(aCentavos(partes), [6001, 4000])
    assert.equal(sumar(partes).cents, 10001)
  })

  test('tres tercios con decimales cierran exacto', ({ assert }) => {
    const tercios = [porcentaje('33.33'), porcentaje('33.33'), porcentaje('33.34')]
    const partes = repartirPorPorcentajes(cents(100), tercios)
    assert.equal(sumar(partes).cents, 100)
    assert.deepEqual(aCentavos(partes), [33, 33, 34])
  })

  test('la suma iguala el total en muchos repartos', ({ assert }) => {
    for (let total = 1; total <= 1500; total++) {
      const partes = repartirPorPorcentajes(cents(total), [
        porcentaje('33.33'),
        porcentaje('21.67'),
        porcentaje('45'),
      ])
      assert.equal(sumar(partes).cents, total, `fallo con total=${total}`)
    }
  })

  test('tambien cierra con totales negativos', ({ assert }) => {
    for (let total = -1; total >= -500; total--) {
      const partes = repartirPorPorcentajes(cents(total), [porcentaje('70'), porcentaje('30')])
      assert.equal(sumar(partes).cents, total, `fallo con total=${total}`)
    }
  })

  test('un unico participante al 100 por ciento se lleva todo', ({ assert }) => {
    assert.deepEqual(aCentavos(repartirPorPorcentajes(cents(7777), [porcentaje('100')])), [7777])
  })

  test('alguien al 0 por ciento no recibe nada', ({ assert }) => {
    const partes = repartirPorPorcentajes(cents(10000), [porcentaje('100'), porcentaje('0')])
    assert.deepEqual(aCentavos(partes), [10000, 0])
  })

  test('es determinista ante fracciones empatadas', ({ assert }) => {
    // Tres al 33.33% de 100: las tres fracciones empatan. El desempate tiene
    // que ser estable, no depender del orden en que el motor evalue.
    const iguales = [porcentaje('33.33'), porcentaje('33.33'), porcentaje('33.33')]
    assert.throws(() => repartirPorPorcentajes(cents(100), iguales), /faltan/i)

    const medios = [porcentaje('50'), porcentaje('50')]
    const primera = aCentavos(repartirPorPorcentajes(cents(101), medios))
    const segunda = aCentavos(repartirPorPorcentajes(cents(101), medios))
    assert.deepEqual(primera, segunda)
    assert.deepEqual(primera, [51, 50])
  })
})

test.group('porcentajes | limites de precision', () => {
  test('avisa cuando el monto es tan grande que no se puede repartir sin perder precision', ({
    assert,
  }) => {
    const enorme = Money.fromCents(Number.MAX_SAFE_INTEGER)
    assert.throws(
      () => repartirPorPorcentajes(enorme, [porcentaje('50'), porcentaje('50')]),
      /precision/i
    )
  })
})
