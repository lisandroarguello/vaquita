import { test } from '@japa/runner'
import { Money } from '#domain/money'
import { repartirEnPartesIguales, repartirPorPorcentajes, porcentaje } from '#domain/reparto'
import { calcularSaldos, type Gasto, type Pago, type IntegranteId } from '#domain/saldos'

/**
 * DOM-4 — Calculo de saldos netos desde gastos y pagos.
 *
 * El criterio del ticket: la suma de los saldos es exactamente cero, con test
 * de propiedad. Dos ejemplos no alcanzan — la invariante tiene que valer para
 * cualquier combinacion de gastos, repartos y pagos, no para las dos que se me
 * ocurrieron. Si la suma no da cero, el minimizador de DOM-5 no tiene forma de
 * dejar a nadie en cero y el plan de cierre deja de ser verificable.
 *
 * El saldo de un integrante es lo que pago menos lo que le corresponde pagar.
 * Un pago ya hecho mueve el saldo de los dos involucrados hacia cero: quien
 * transfiere queda menos en deuda, quien recibe deja de tener esa plata a favor.
 */

const cents = (n: number) => Money.fromCents(n)
const aCentavos = (saldos: { monto: Money }[]) => saldos.map((s) => s.monto.cents)
const sumar = (saldos: { monto: Money }[]) =>
  saldos.reduce((acc, s) => acc.plus(s.monto), Money.zero())

/** Un gasto repartido en partes iguales entre los integrantes que se indiquen. */
function gastoEnPartesIguales(
  pagadoPor: IntegranteId,
  total: Money,
  entre: IntegranteId[],
  desde = 0
): Gasto {
  const partes = repartirEnPartesIguales(total, entre.length, desde)
  return {
    pagadoPor,
    total,
    partes: entre.map((integrante, i) => ({ integrante, monto: partes[i] })),
  }
}

/** Generador reproducible: la misma semilla da siempre la misma secuencia. */
function generador(semilla: number) {
  let estado = semilla
  return (max: number) => {
    estado = (estado * 1664525 + 1013904223) % 2 ** 32
    return estado % max
  }
}

test.group('saldos | el caso que define el producto', () => {
  test('quien pago de mas queda en positivo y el resto en negativo', ({ assert }) => {
    // Ana paga $100 de una cena entre tres. Le corresponde un tercio.
    const saldos = calcularSaldos(
      ['ana', 'beto', 'cata'],
      [gastoEnPartesIguales('ana', cents(10000), ['ana', 'beto', 'cata'])],
      []
    )

    assert.deepEqual(aCentavos(saldos), [6666, -3333, -3333])
    assert.isTrue(sumar(saldos).isZero())
  })

  test('devuelve un saldo por integrante, en el orden en que se pidieron', ({ assert }) => {
    const saldos = calcularSaldos(['cata', 'ana', 'beto'], [], [])
    assert.deepEqual(
      saldos.map((s) => s.integrante),
      ['cata', 'ana', 'beto']
    )
  })

  test('un grupo sin gastos tiene todos los saldos en cero', ({ assert }) => {
    const saldos = calcularSaldos(['ana', 'beto'], [], [])
    assert.deepEqual(aCentavos(saldos), [0, 0])
  })

  test('quien pago un gasto del que no participa queda acreedor de todo', ({ assert }) => {
    // Ana paga el regalo de cumpleaños de Beto: ella no esta entre las partes.
    const saldos = calcularSaldos(
      ['ana', 'beto', 'cata'],
      [gastoEnPartesIguales('ana', cents(10000), ['beto', 'cata'])],
      []
    )
    assert.deepEqual(aCentavos(saldos), [10000, -5000, -5000])
  })

  test('varios gastos se acumulan', ({ assert }) => {
    const saldos = calcularSaldos(
      ['ana', 'beto'],
      [
        gastoEnPartesIguales('ana', cents(10000), ['ana', 'beto']),
        gastoEnPartesIguales('beto', cents(4000), ['ana', 'beto']),
      ],
      []
    )
    // Ana: +10000 -5000 -2000 = 3000. Beto: +4000 -5000 -2000 = -3000.
    assert.deepEqual(aCentavos(saldos), [3000, -3000])
  })

  test('el centavo que sobra queda del lado de quien lo asumio en el reparto', ({ assert }) => {
    // El mismo gasto, rotando a quien le toca el centavo: el saldo lo refleja.
    const grupo: IntegranteId[] = ['ana', 'beto', 'cata']
    const conResto = calcularSaldos(grupo, [gastoEnPartesIguales('ana', cents(100), grupo, 1)], [])
    assert.deepEqual(aCentavos(conResto), [67, -34, -33])
    assert.isTrue(sumar(conResto).isZero())
  })
})

test.group('saldos | los pagos ya hechos', () => {
  test('un pago acerca a cero a los dos involucrados', ({ assert }) => {
    const gastos = [gastoEnPartesIguales('ana', cents(10000), ['ana', 'beto'])]
    // Beto le debe 5000 a Ana y le transfiere 5000.
    const saldos = calcularSaldos(['ana', 'beto'], gastos, [
      { de: 'beto', para: 'ana', monto: cents(5000) },
    ])
    assert.deepEqual(aCentavos(saldos), [0, 0])
  })

  test('un pago parcial deja la deuda restante', ({ assert }) => {
    const saldos = calcularSaldos(
      ['ana', 'beto'],
      [gastoEnPartesIguales('ana', cents(10000), ['ana', 'beto'])],
      [{ de: 'beto', para: 'ana', monto: cents(2000) }]
    )
    assert.deepEqual(aCentavos(saldos), [3000, -3000])
  })

  test('un pago de mas da la vuelta al signo, no se recorta', ({ assert }) => {
    // Beto debia 5000 y transfirio 8000. Ahora Ana le debe 3000 a Beto. El
    // dominio no tapa el error: lo muestra en el saldo, que es como se corrige.
    const saldos = calcularSaldos(
      ['ana', 'beto'],
      [gastoEnPartesIguales('ana', cents(10000), ['ana', 'beto'])],
      [{ de: 'beto', para: 'ana', monto: cents(8000) }]
    )
    assert.deepEqual(aCentavos(saldos), [-3000, 3000])
    assert.isTrue(sumar(saldos).isZero())
  })

  test('varios pagos se acumulan', ({ assert }) => {
    const saldos = calcularSaldos(
      ['ana', 'beto', 'cata'],
      [],
      [
        { de: 'beto', para: 'ana', monto: cents(1000) },
        { de: 'cata', para: 'ana', monto: cents(2500) },
      ]
    )
    assert.deepEqual(aCentavos(saldos), [-3500, 1000, 2500])
    assert.isTrue(sumar(saldos).isZero())
  })

  test('un pago sin gastos tambien mantiene la suma en cero', ({ assert }) => {
    const saldos = calcularSaldos(
      ['ana', 'beto'],
      [],
      [{ de: 'ana', para: 'beto', monto: cents(500) }]
    )
    assert.deepEqual(aCentavos(saldos), [500, -500])
  })
})

test.group('saldos | gastos anulados', () => {
  test('un gasto anulado no influye en los saldos', ({ assert }) => {
    const vigente = gastoEnPartesIguales('ana', cents(10000), ['ana', 'beto'])
    const anulado = {
      ...gastoEnPartesIguales('beto', cents(99999), ['ana', 'beto']),
      anulado: true,
    }

    const saldos = calcularSaldos(['ana', 'beto'], [vigente, anulado], [])
    assert.deepEqual(aCentavos(saldos), [5000, -5000])
  })

  test('un grupo donde todo esta anulado queda en cero', ({ assert }) => {
    const anulado = { ...gastoEnPartesIguales('ana', cents(10000), ['ana', 'beto']), anulado: true }
    assert.deepEqual(aCentavos(calcularSaldos(['ana', 'beto'], [anulado], [])), [0, 0])
  })

  test('un gasto anulado mal formado no impide leer los saldos', ({ assert }) => {
    // Un gasto anulado es historial, no un sumando. Validarlo haria que un dato
    // viejo y ya descartado bloquee la lectura de saldos de todo el grupo.
    const roto: Gasto = {
      pagadoPor: 'ana',
      total: cents(10000),
      partes: [{ integrante: 'ana', monto: cents(1) }],
      anulado: true,
    }
    assert.deepEqual(aCentavos(calcularSaldos(['ana', 'beto'], [roto], [])), [0, 0])
  })
})

/**
 * Esta es la invariante del ticket, y la unica forma honesta de verificarla es
 * sobre casos generados: un grupo cualquiera, con gastos repartidos de las tres
 * maneras que soporta el dominio, pagos cruzados en cualquier direccion y
 * montos que incluyen los que no dividen exacto.
 */
test.group('saldos | la invariante: la suma es exactamente cero', () => {
  test('vale sobre 2000 grupos generados', ({ assert }) => {
    const siguiente = generador(20261116)

    for (let caso = 0; caso < 2000; caso++) {
      const cuantos = 2 + siguiente(14)
      const integrantes = Array.from({ length: cuantos }, (_, i) => `i${i}`)

      const gastos: Gasto[] = []
      const cuantosGastos = siguiente(8)
      for (let g = 0; g < cuantosGastos; g++) {
        const total = cents(1 + siguiente(500_000))
        const pagadoPor = integrantes[siguiente(cuantos)]

        // Un subconjunto no vacio del grupo participa del gasto.
        const participantes = integrantes.filter(() => siguiente(2) === 0)
        if (participantes.length === 0) participantes.push(integrantes[siguiente(cuantos)])

        const modo = siguiente(3)
        let partes
        if (modo === 0) {
          partes = repartirEnPartesIguales(total, participantes.length, siguiente(cuantos))
        } else if (modo === 1) {
          // Montos exactos armados desde un reparto valido, desordenados.
          partes = repartirEnPartesIguales(total, participantes.length).reverse()
        } else {
          partes = repartirPorPorcentajes(total, porcentajesQueCierran(participantes.length))
        }

        gastos.push({
          pagadoPor,
          total,
          partes: participantes.map((integrante, i) => ({ integrante, monto: partes[i] })),
          anulado: siguiente(5) === 0,
        })
      }

      const pagos: Pago[] = []
      const cuantosPagos = siguiente(5)
      for (let p = 0; p < cuantosPagos; p++) {
        const de = siguiente(cuantos)
        const para = (de + 1 + siguiente(cuantos - 1)) % cuantos
        pagos.push({
          de: integrantes[de],
          para: integrantes[para],
          monto: cents(1 + siguiente(200_000)),
        })
      }

      const saldos = calcularSaldos(integrantes, gastos, pagos)

      assert.equal(saldos.length, cuantos, `fallo con caso=${caso}`)
      assert.equal(
        sumar(saldos).cents,
        0,
        `la suma no dio cero en el caso ${caso}: ${JSON.stringify({ gastos, pagos })}`
      )
    }
  })

  test('vale tambien cuando los montos no dividen exacto, barriendo totales', ({ assert }) => {
    // El barrido completo: para cada total de 1 a 600 y cada tamaño de grupo,
    // la suma tiene que dar cero. Aca es donde aparece el centavo perdido si el
    // reparto y el saldo no usan el mismo criterio.
    const grupo: IntegranteId[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    for (let total = 1; total <= 600; total++) {
      for (let cuantos = 1; cuantos <= grupo.length; cuantos++) {
        const entre = grupo.slice(0, cuantos)
        const saldos = calcularSaldos(
          grupo,
          [gastoEnPartesIguales('g', cents(total), entre, total % cuantos)],
          []
        )
        assert.equal(sumar(saldos).cents, 0, `fallo con total=${total} cuantos=${cuantos}`)
      }
    }
  })

  test('es determinista: las mismas entradas dan el mismo resultado', ({ assert }) => {
    const grupo: IntegranteId[] = ['ana', 'beto', 'cata']
    const gastos = [gastoEnPartesIguales('ana', cents(10001), grupo)]
    const pagos: Pago[] = [{ de: 'beto', para: 'ana', monto: cents(1234) }]

    assert.deepEqual(
      aCentavos(calcularSaldos(grupo, gastos, pagos)),
      aCentavos(calcularSaldos(grupo, gastos, pagos))
    )
  })

  test('no modifica lo que recibe', ({ assert }) => {
    const grupo: IntegranteId[] = ['ana', 'beto']
    const gastos = [gastoEnPartesIguales('ana', cents(10000), grupo)]
    const pagos: Pago[] = [{ de: 'beto', para: 'ana', monto: cents(5000) }]
    const antes = JSON.stringify({ grupo, gastos, pagos })

    calcularSaldos(grupo, gastos, pagos)
    assert.equal(JSON.stringify({ grupo, gastos, pagos }), antes)
  })
})

/** Porcentajes enteros que suman 100 exacto, para n participantes. */
function porcentajesQueCierran(n: number) {
  const base = Math.trunc(100 / n)
  const valores = Array.from({ length: n }, () => base)
  valores[0] += 100 - base * n
  return valores.map((v) => porcentaje(String(v)))
}

/**
 * La invariante de arriba solo se sostiene si cada gasto esta bien formado: si
 * las partes no suman el total, el gasto mete o saca plata del grupo y la suma
 * deja de dar cero. El dominio no puede dejar pasar eso en silencio — es
 * exactamente el centavo perdido que nadie encuentra despues.
 */
test.group('saldos | lo que no puede pasar en silencio', () => {
  test('rechaza un gasto cuyas partes no suman el total, diciendo cuanto falta', ({ assert }) => {
    const roto: Gasto = {
      pagadoPor: 'ana',
      total: cents(10000),
      partes: [
        { integrante: 'ana', monto: cents(5000) },
        { integrante: 'beto', monto: cents(3750) },
      ],
    }
    try {
      calcularSaldos(['ana', 'beto'], [roto], [])
      assert.fail('deberia haber lanzado')
    } catch (error: any) {
      assert.match(error.message, /faltan/i)
      assert.match(error.message, /12\.50/)
    }
  })

  test('rechaza un gasto cuyas partes se pasan del total', ({ assert }) => {
    const roto: Gasto = {
      pagadoPor: 'ana',
      total: cents(10000),
      partes: [{ integrante: 'ana', monto: cents(10001) }],
    }
    assert.throws(() => calcularSaldos(['ana'], [roto], []), /sobran.*0\.01/is)
  })

  test('rechaza un gasto sin partes', ({ assert }) => {
    const roto: Gasto = { pagadoPor: 'ana', total: cents(10000), partes: [] }
    assert.throws(() => calcularSaldos(['ana'], [roto], []), /al menos una parte/i)
  })

  test('rechaza un gasto pagado por alguien que no esta en el grupo', ({ assert }) => {
    // Sin esto el credito del pagador se perderia y la suma no daria cero.
    const gasto = gastoEnPartesIguales('zoe', cents(10000), ['ana', 'beto'])
    assert.throws(() => calcularSaldos(['ana', 'beto'], [gasto], []), /zoe/i)
  })

  test('rechaza una parte asignada a alguien que no esta en el grupo', ({ assert }) => {
    const gasto = gastoEnPartesIguales('ana', cents(10000), ['ana', 'zoe'])
    assert.throws(() => calcularSaldos(['ana', 'beto'], [gasto], []), /zoe/i)
  })

  test('rechaza dos partes para el mismo integrante en un gasto', ({ assert }) => {
    // Dos filas para la misma persona en un gasto es un reparto mal armado:
    // el total cierra pero el gasto no dice cuanto le toca a cada uno.
    const roto: Gasto = {
      pagadoPor: 'ana',
      total: cents(10000),
      partes: [
        { integrante: 'ana', monto: cents(5000) },
        { integrante: 'ana', monto: cents(5000) },
      ],
    }
    assert.throws(() => calcularSaldos(['ana', 'beto'], [roto], []), /ana.*repetid/is)
  })

  test('rechaza un pago entre integrantes que no estan en el grupo', ({ assert }) => {
    assert.throws(
      () => calcularSaldos(['ana', 'beto'], [], [{ de: 'zoe', para: 'ana', monto: cents(100) }]),
      /zoe/i
    )
    assert.throws(
      () => calcularSaldos(['ana', 'beto'], [], [{ de: 'ana', para: 'zoe', monto: cents(100) }]),
      /zoe/i
    )
  })

  test('rechaza un pago de alguien a si mismo', ({ assert }) => {
    assert.throws(
      () => calcularSaldos(['ana', 'beto'], [], [{ de: 'ana', para: 'ana', monto: cents(100) }]),
      /a si mismo/i
    )
  })

  test('rechaza un integrante repetido en el grupo', ({ assert }) => {
    // Con un id repetido habria dos saldos para la misma persona y la suma
    // contaria su deuda dos veces.
    assert.throws(() => calcularSaldos(['ana', 'ana'], [], []), /ana.*repetid/is)
  })

  test('rechaza un grupo vacio', ({ assert }) => {
    assert.throws(() => calcularSaldos([], [], []), /al menos un integrante/i)
  })
})
