import { test } from '@japa/runner'
import { Money } from '#domain/money'
import { calcularSaldos, type IntegranteId, type Saldo } from '#domain/saldos'
import {
  minimizarExacto,
  minimizarGreedy,
  LIMITE_EXACTO,
  type Transferencia,
} from '#domain/minimizador'

/**
 * DOM-6 — Minimizador greedy, para los grupos que el exacto no alcanza.
 *
 * El exacto de DOM-5 es 3^n y se corta en 12 saldos no nulos. De ahi para
 * arriba hace falta algo que no explore particiones: emparejar iterativamente
 * al mayor acreedor con el mayor deudor.
 *
 * Lo que este modulo **garantiza** son dos cosas, y ninguna es "el optimo":
 *
 *   1. nunca propone mas de n-1 transferencias;
 *   2. aplicar el plan deja todos los saldos exactamente en cero.
 *
 * Las dos se verifican con test de propiedad, no con ejemplos. Y hay un test
 * que fija lo que el greedy **no** garantiza —hay casos donde da una
 * transferencia de mas que el exacto—, porque una aproximacion que nadie
 * documenta como aproximacion se termina leyendo como exacta.
 */

const cents = (n: number) => Money.fromCents(n)

/** Arma saldos con nombres i0, i1, ... desde una lista de centavos. */
function saldosDe(valores: number[]): Saldo[] {
  return valores.map((monto, i) => ({ integrante: `i${i}`, monto: cents(monto) }))
}

/** Como queda cada saldo despues de aplicar el plan. Debe quedar todo en cero. */
function aplicar(saldos: Saldo[], plan: Transferencia[]): Saldo[] {
  const integrantes = saldos.map((s) => s.integrante)
  const porIntegrante = new Map(saldos.map((s) => [s.integrante, s.monto.cents]))
  for (const t of plan) {
    porIntegrante.set(t.de, porIntegrante.get(t.de)! + t.monto.cents)
    porIntegrante.set(t.para, porIntegrante.get(t.para)! - t.monto.cents)
  }
  return integrantes.map((integrante) => ({
    integrante,
    monto: cents(porIntegrante.get(integrante)!),
  }))
}

const quedaTodoEnCero = (saldos: Saldo[], plan: Transferencia[]) =>
  aplicar(saldos, plan).every((s) => s.monto.isZero())

/** Generador reproducible: la misma semilla da siempre la misma secuencia. */
function generador(semilla: number) {
  let estado = semilla
  return (max: number) => {
    estado = (estado * 1664525 + 1013904223) % 2 ** 32
    return estado % max
  }
}

/**
 * Grupos que suman cero, plantados a proposito y mezclados.
 *
 * Mismo motivo que en DOM-5: montos al azar que cierran con el opuesto de la
 * suma casi nunca contienen un subconjunto propio que sume cero, y entonces
 * todos los casos necesitan n-1 y la cota se cumple sin que el algoritmo haga
 * nada interesante. Aca ademas importa para la otra mitad: el greedy encuentra
 * *algunos* de esos grupos sin buscarlos, y si no hay ninguno plantado no se
 * ve nunca un plan mas corto que n-1.
 */
function saldosConGruposPlantados(siguiente: (max: number) => number, minIntegrantes: number) {
  const valores: number[] = []

  while (valores.length < minIntegrantes) {
    const tamanio = 2 + siguiente(4)
    const grupo: number[] = []
    for (let i = 0; i < tamanio - 1; i++) grupo.push(siguiente(20_000) - 10_000)
    grupo.push(-grupo.reduce((a, b) => a + b, 0))
    valores.push(...grupo)
  }

  // Mezcla determinista: los grupos plantados no pueden quedar contiguos, o el
  // orden de entrada le estaria regalando la respuesta al algoritmo.
  for (let i = valores.length - 1; i > 0; i--) {
    const j = siguiente(i + 1)
    const guardado = valores[i]
    valores[i] = valores[j]
    valores[j] = guardado
  }
  return valores
}

/**
 * El otro regimen: montos al azar y el ultimo cerrando la suma. Casi siempre
 * son cadenas que no se pueden partir, o sea donde el plan tiene que dar
 * exactamente n-1 y la cota queda justa.
 */
function cadenaAlAzar(siguiente: (max: number) => number, cuantos: number) {
  const valores: number[] = []
  for (let i = 0; i < cuantos - 1; i++) valores.push(siguiente(1_000_001) - 500_000)
  valores.push(-valores.reduce((a, b) => a + b, 0))
  return valores
}

test.group('minimizador greedy | los casos del ticket', () => {
  test('empareja al mayor acreedor con el mayor deudor', ({ assert }) => {
    const saldos = saldosDe([10000, -6000, -4000])
    const plan = minimizarGreedy(saldos)

    assert.deepEqual(
      plan.map((t) => [t.de, t.para, t.monto.cents]),
      [
        ['i1', 'i0', 6000],
        ['i2', 'i0', 4000],
      ]
    )
    assert.isTrue(quedaTodoEnCero(saldos, plan))
  })

  test('cierra un grupo de 30 integrantes, muy por encima del limite exacto', ({ assert }) => {
    // 29 deudores de $10 y un acreedor de $290: el exacto ni lo intenta.
    const valores = [29000, ...Array.from({ length: 29 }, () => -1000)]
    const saldos = saldosDe(valores)
    const plan = minimizarGreedy(saldos)

    assert.lengthOf(plan, 29)
    assert.isTrue(quedaTodoEnCero(saldos, plan))
    assert.throws(() => minimizarExacto(saldos), new RegExp(String(LIMITE_EXACTO)))
  })

  test('un grupo con todos los saldos en cero no tiene transferencias', ({ assert }) => {
    assert.deepEqual(minimizarGreedy(saldosDe([0, 0, 0])), [])
  })

  test('un grupo vacio no tiene transferencias', ({ assert }) => {
    assert.deepEqual(minimizarGreedy([]), [])
  })

  test('los integrantes en cero no aparecen en el plan', ({ assert }) => {
    const plan = minimizarGreedy(saldosDe([5000, 0, -5000, 0]))
    assert.deepEqual(
      plan.map((t) => [t.de, t.para, t.monto.cents]),
      [['i2', 'i0', 5000]]
    )
  })

  test('dos saldos iguales se desempatan por orden de entrada', ({ assert }) => {
    // Sin desempate estable el plan podria cambiar entre dos lecturas de la
    // misma pantalla, que se lee como un plan distinto.
    const saldos = saldosDe([3000, 3000, -2000, -4000])
    const plan = minimizarGreedy(saldos)

    assert.deepEqual(
      plan.map((t) => [t.de, t.para, t.monto.cents]),
      [
        ['i3', 'i0', 3000],
        ['i2', 'i1', 2000],
        ['i3', 'i1', 1000],
      ]
    )
  })

  test('dos deudores iguales tambien se desempatan por orden de entrada', ({ assert }) => {
    // El test de arriba empata dos *acreedores*, asi que dejaba el desempate
    // del lado de los deudores sin verificar: dar vuelta ese criterio no
    // rompia ningun test. Salio de un mutante que sobrevivia.
    const saldos = saldosDe([4000, -3000, -3000, 2000])
    const plan = minimizarGreedy(saldos)

    assert.deepEqual(
      plan.map((t) => [t.de, t.para, t.monto.cents]),
      [
        ['i1', 'i0', 3000],
        ['i2', 'i3', 2000],
        ['i2', 'i0', 1000],
      ]
    )
    assert.isTrue(quedaTodoEnCero(saldos, plan))
  })

  test('es determinista y no modifica los saldos que recibe', ({ assert }) => {
    const saldos = saldosDe([5000, 3000, -2000, -6000])
    const antes = JSON.stringify(saldos)

    const primera = minimizarGreedy(saldos).map((t) => [t.de, t.para, t.monto.cents])
    const segunda = minimizarGreedy(saldos).map((t) => [t.de, t.para, t.monto.cents])

    assert.deepEqual(primera, segunda)
    assert.equal(JSON.stringify(saldos), antes)
  })
})

/**
 * Las dos garantias del ticket, sobre casos generados y no sobre ejemplos
 * elegidos. Los contadores de abajo no son adorno: sin ellos el test puede
 * pasar sin haber ejercitado nunca ni los grupos grandes ni la cota ajustada.
 */
test.group('minimizador greedy | las dos garantias', () => {
  test('nunca propone mas de n-1 transferencias', ({ assert }) => {
    const siguiente = generador(20261116)
    let casosGrandes = 0
    let casosAjustados = 0
    let casosPorDebajo = 0

    for (let caso = 0; caso < 2000; caso++) {
      const valores =
        caso % 2 === 0
          ? saldosConGruposPlantados(siguiente, LIMITE_EXACTO + 1 + siguiente(30))
          : cadenaAlAzar(siguiente, LIMITE_EXACTO + 1 + siguiente(30))

      const noCero = valores.filter((v) => v !== 0).length
      const plan = minimizarGreedy(saldosDe(valores))

      if (noCero > LIMITE_EXACTO) casosGrandes++
      if (plan.length === noCero - 1) casosAjustados++
      if (plan.length < noCero - 1) casosPorDebajo++

      assert.isAtMost(
        plan.length,
        valores.length - 1,
        `se paso de n-1 con saldos=${JSON.stringify(valores)}`
      )
    }

    // El greedy existe para los grupos que el exacto no toma. Si los casos
    // generados cayeran todos por debajo del limite, el test estaria probando
    // otro algoritmo que el que dice probar.
    // Medido con esta semilla: 2000 grandes, 1654 ajustados, 346 por debajo.
    // Los umbrales estan abajo de lo medido para dejar lugar a retoques del
    // generador, no para tolerar que alguno se caiga a cero.
    assert.isAbove(casosGrandes, 1800, 'los casos generados no son grupos grandes')
    // Si ningun caso llegara a n-1, el `isAtMost` nunca estaria cerca del
    // borde y un algoritmo que propone de mas pasaria igual.
    assert.isAbove(casosAjustados, 1000, 'ningun caso generado deja la cota ajustada')
    // Y si ninguno quedara por debajo, los grupos plantados no estarian
    // haciendo nada: serian cadenas con otro nombre, y la unica cota que el
    // test ejercitaria seria la trivial.
    assert.isAbove(casosPorDebajo, 200, 'los grupos plantados no acortan ningun plan')
  })

  test('aplicar el plan deja todos los saldos exactamente en cero', ({ assert }) => {
    const siguiente = generador(777)
    let casosGrandes = 0

    for (let caso = 0; caso < 2000; caso++) {
      const valores =
        caso % 2 === 0
          ? saldosConGruposPlantados(siguiente, LIMITE_EXACTO + 1 + siguiente(30))
          : cadenaAlAzar(siguiente, LIMITE_EXACTO + 1 + siguiente(30))

      if (valores.filter((v) => v !== 0).length > LIMITE_EXACTO) casosGrandes++

      const saldos = saldosDe(valores)
      assert.isTrue(
        quedaTodoEnCero(saldos, minimizarGreedy(saldos)),
        `no quedo en cero con saldos=${JSON.stringify(valores)}`
      )
    }

    assert.isAbove(casosGrandes, 1800, 'los casos generados no son grupos grandes')
  })

  test('toda transferencia es positiva y entre dos personas distintas', ({ assert }) => {
    const siguiente = generador(2718)

    for (let caso = 0; caso < 1000; caso++) {
      const valores =
        caso % 2 === 0
          ? saldosConGruposPlantados(siguiente, LIMITE_EXACTO + 1 + siguiente(30))
          : cadenaAlAzar(siguiente, LIMITE_EXACTO + 1 + siguiente(30))

      for (const t of minimizarGreedy(saldosDe(valores))) {
        assert.isTrue(t.monto.isPositive(), `transferencia no positiva: ${t.monto.toString()}`)
        assert.notEqual(t.de, t.para, 'una transferencia de alguien a si mismo')
      }
    }
  })

  test('el plan cierra el grupo de verdad, pasando por el calculo de saldos', ({ assert }) => {
    // De punta a punta: los saldos salen de DOM-4 a partir de gastos reales, y
    // volver a calcularlos con el plan agregado como pagos tiene que dar cero.
    // El grupo es de 20, fuera del alcance del exacto.
    const grupo: IntegranteId[] = Array.from({ length: 20 }, (_, i) => `p${i}`)
    const gastos = [
      {
        pagadoPor: 'p0',
        total: cents(20000),
        partes: grupo.map((integrante) => ({ integrante, monto: cents(1000) })),
      },
      {
        pagadoPor: 'p7',
        total: cents(3001),
        partes: [
          { integrante: 'p7', monto: cents(1001) },
          { integrante: 'p8', monto: cents(1000) },
          { integrante: 'p9', monto: cents(1000) },
        ],
      },
    ]

    const saldos = calcularSaldos(grupo, gastos, [])
    const plan = minimizarGreedy(saldos)
    const pagos = plan.map((t) => ({ de: t.de, para: t.para, monto: t.monto }))

    assert.isTrue(calcularSaldos(grupo, gastos, pagos).every((s) => s.monto.isZero()))
  })
})

/**
 * Lo que el greedy no garantiza. Un plan subobtimo esta bien —es el precio de
 * no explorar particiones— pero tiene que estar escrito en alguna parte que no
 * sea un comentario, o la proxima sesion lo lee como exacto.
 */
test.group('minimizador greedy | es aproximado, y se nota', () => {
  test('hay casos donde propone una transferencia mas que el exacto', ({ assert }) => {
    // {+$50, -$50} y {+$60, -$30, -$30} son dos grupos independientes: el
    // exacto los cierra en 1 + 2 = 3. El greedy empareja el mayor acreedor
    // ($60) con el mayor deudor (-$50), que son de grupos distintos, parte los
    // dos al medio y termina en 4.
    const saldos = saldosDe([5000, -5000, 6000, -3000, -3000])

    assert.lengthOf(minimizarExacto(saldos), 3)
    const plan = minimizarGreedy(saldos)
    assert.lengthOf(plan, 4)
    assert.isTrue(quedaTodoEnCero(saldos, plan))
  })

  test('nunca es mejor que el exacto, y a veces es peor', ({ assert }) => {
    const siguiente = generador(31416)
    let casosPeores = 0

    for (let caso = 0; caso < 400; caso++) {
      // Chicos a proposito: es el unico rango donde se puede comparar contra
      // el exacto, que es quien sabe cual es el optimo.
      const valores =
        caso % 2 === 0
          ? saldosConGruposPlantados(siguiente, 2 + siguiente(7)).slice(0, LIMITE_EXACTO)
          : cadenaAlAzar(siguiente, 2 + siguiente(LIMITE_EXACTO - 1))

      // El recorte de arriba puede romper la suma cero; se cierra de nuevo.
      const suma = valores.reduce((a, b) => a + b, 0)
      if (suma !== 0) valores.push(-suma)
      if (valores.filter((v) => v !== 0).length > LIMITE_EXACTO) continue

      const optimo = minimizarExacto(saldosDe(valores)).length
      const aproximado = minimizarGreedy(saldosDe(valores)).length

      assert.isAtLeast(
        aproximado,
        optimo,
        `el greedy dio menos que el optimo con saldos=${JSON.stringify(valores)}`
      )
      if (aproximado > optimo) casosPeores++
    }

    // Si nunca fuera peor, este test no estaria comparando nada: estaria
    // midiendo dos veces el mismo algoritmo. Medido: la cuenta no se mueve
    // sola porque la semilla es fija.
    assert.isAbove(casosPeores, 10, 'el greedy nunca se separo del optimo')
  })
})

/**
 * El greedy aproxima el tamaño del plan, no la aritmetica. Un plan que no
 * cierra manda a alguien a transferir plata que no debe.
 */
test.group('minimizador greedy | lo que no puede pasar en silencio', () => {
  test('rechaza saldos que no suman cero', ({ assert }) => {
    try {
      minimizarGreedy(saldosDe([10000, -6000, -3999]))
      assert.fail('deberia haber lanzado')
    } catch (error: any) {
      assert.match(error.message, /no suman cero/i)
      assert.match(error.message, /0\.01/)
    }
  })

  test('no usa tolerancia: un centavo de diferencia ya es un error', ({ assert }) => {
    assert.throws(() => minimizarGreedy(saldosDe([1, -2, 0])), /no suman cero/i)
  })

  test('rechaza un integrante repetido en los saldos', ({ assert }) => {
    const saldos: Saldo[] = [
      { integrante: 'ana', monto: cents(5000) },
      { integrante: 'ana', monto: cents(-5000) },
    ]
    assert.throws(() => minimizarGreedy(saldos), /ana.*repetid/is)
  })

  test('no tiene limite de tamanio: 200 integrantes entran', ({ assert }) => {
    const valores = [...Array.from({ length: 199 }, (_, i) => 100 + i), 0]
    valores[199] = -valores.slice(0, 199).reduce((a, b) => a + b, 0)
    const saldos = saldosDe(valores)
    const plan = minimizarGreedy(saldos)

    assert.isAtMost(plan.length, 199)
    assert.isTrue(quedaTodoEnCero(saldos, plan))
  })
})
