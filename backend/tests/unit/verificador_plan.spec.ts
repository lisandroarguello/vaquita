import { test } from '@japa/runner'
import { Money } from '#domain/money'
import type { IntegranteId, Saldo } from '#domain/saldos'
import { minimizarExacto, minimizarGreedy, LIMITE_EXACTO } from '#domain/minimizador'
import type { Transferencia } from '#domain/minimizador'
import { verificarPlan } from '#domain/verificador_plan'

/**
 * DOM-7 — Verificador de invariantes del plan.
 *
 * El verificador se prueba al reves de los minimizadores: a los minimizadores
 * se les da una entrada y se mira el plan que sacan; al verificador se le da un
 * plan **armado a mano** y se mira el veredicto. Los planes roturados de este
 * archivo no los produce ningun minimizador — son los que produciria uno con un
 * bug, que es exactamente lo que el verificador tiene que agarrar.
 *
 * Por eso cada caso roto rompe **una** invariante a la vez, y varios de ellos
 * rompen una invariante sin romper el cero final. Un plan que falla tres cosas
 * juntas lo rechaza igual un verificador que solo mira una: lo que hay que
 * probar es que cada chequeo esta y dispara solo.
 */

const cents = (n: number) => Money.fromCents(n)

function saldosDe(valores: number[]): Saldo[] {
  return valores.map((monto, i) => ({ integrante: `i${i}`, monto: cents(monto) }))
}

const t = (de: IntegranteId, para: IntegranteId, monto: number): Transferencia => ({
  de,
  para,
  monto: cents(monto),
})

/** Generador reproducible: la misma semilla da siempre la misma secuencia. */
function generador(semilla: number) {
  let estado = semilla
  return (max: number) => {
    estado = (estado * 1664525 + 1013904223) % 2 ** 32
    return estado % max
  }
}

/**
 * Grupos que suman cero, plantados a proposito y mezclados. Mismo motivo que en
 * DOM-5 y DOM-6: montos al azar que cierran con el opuesto de la suma casi
 * nunca contienen un subconjunto propio que sume cero, y entonces ningun plan
 * generado baja de n-1 y la cota del verificador se cumple sin apretar nunca.
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
  for (let i = valores.length - 1; i > 0; i--) {
    const j = siguiente(i + 1)
    const guardado = valores[i]
    valores[i] = valores[j]
    valores[j] = guardado
  }
  return valores
}

/** Montos al azar y el ultimo cerrando la suma: casi siempre cadenas que no se
 * pueden partir, donde el plan da exactamente n-1 y la cota queda justa. */
function cadenaAlAzar(siguiente: (max: number) => number, cuantos: number) {
  const valores: number[] = []
  for (let i = 0; i < cuantos - 1; i++) valores.push(siguiente(1_000_001) - 500_000)
  valores.push(-valores.reduce((a, b) => a + b, 0))
  return valores
}

test.group('verificador | acepta los planes que cierran', () => {
  test('acepta el plan minimo de un caso conocido', ({ assert }) => {
    const saldos = saldosDe([10000, -6000, -4000])
    const resultado = verificarPlan(saldos, [t('i1', 'i0', 6000), t('i2', 'i0', 4000)])

    assert.isTrue(resultado.cierra)
    assert.deepEqual(resultado.problemas, [])
  })

  test('acepta un plan que no es minimo pero cierra y respeta n-1', ({ assert }) => {
    // Dos transferencias donde alcanzaba una. El verificador no opina sobre
    // optimalidad: la cota que el Readme promete es n-1, no el minimo. Si
    // rechazara lo subobtimo, el plan del greedy —que es subobtimo a
    // proposito— quedaria rechazado por un verificador que debe servir para
    // los dos.
    const saldos = saldosDe([10000, -6000, -4000])
    const resultado = verificarPlan(saldos, [t('i1', 'i0', 6000), t('i2', 'i0', 4000)])
    assert.isTrue(resultado.cierra)

    const saldosCadena = saldosDe([5000, -5000, 3000, -3000])
    const subobtimo = verificarPlan(saldosCadena, [
      t('i1', 'i0', 5000),
      t('i3', 'i0', 3000),
      t('i0', 'i2', 3000),
    ])
    assert.isTrue(subobtimo.cierra, 'tres transferencias con n=4 respeta n-1 y cierra')
  })

  test('acepta el plan vacio cuando todos los saldos ya estan en cero', ({ assert }) => {
    assert.isTrue(verificarPlan(saldosDe([0, 0, 0]), []).cierra)
  })

  test('acepta el plan vacio sobre un grupo sin saldos', ({ assert }) => {
    assert.isTrue(verificarPlan([], []).cierra)
  })

  test('los integrantes en cero no cuentan para la cota n-1', ({ assert }) => {
    // Cuatro integrantes, dos activos: la cota es 1, no 3. Un verificador que
    // contara el grupo entero aceptaria planes con transferencias de mas.
    const saldos = saldosDe([5000, 0, -5000, 0])
    assert.isTrue(verificarPlan(saldos, [t('i2', 'i0', 5000)]).cierra)
    assert.isFalse(
      verificarPlan(saldos, [t('i2', 'i1', 5000), t('i1', 'i0', 5000)]).cierra,
      'dos transferencias con dos saldos activos se pasa de n-1'
    )
  })
})

test.group('verificador | agarra cada invariante por separado', () => {
  test('rechaza un plan que deja saldos sin cerrar', ({ assert }) => {
    const saldos = saldosDe([10000, -6000, -4000])
    const resultado = verificarPlan(saldos, [t('i1', 'i0', 6000)])

    assert.isFalse(resultado.cierra)
    assert.lengthOf(resultado.problemas, 1)
    assert.match(resultado.problemas[0], /i2/)
    // El mensaje tiene que decir cuanto queda, en pesos: "no cierra" sin el
    // numero manda a quien lee a recalcularlo a mano.
    assert.match(resultado.problemas[0], /40\.00/)
  })

  test('rechaza un plan que pasa de rosca y deja los saldos del otro signo', ({ assert }) => {
    const saldos = saldosDe([5000, -5000])
    const resultado = verificarPlan(saldos, [t('i1', 'i0', 6000)])

    assert.isFalse(resultado.cierra)
    assert.match(resultado.problemas.join(' | '), /i0/)
    assert.match(resultado.problemas.join(' | '), /i1/)
  })

  test('rechaza mas de n-1 transferencias aunque el plan cierre', ({ assert }) => {
    // Este plan deja todo en cero: es solo mas largo de lo permitido. Si el
    // verificador mirara nada mas que el cero final, lo aceptaria.
    const saldos = saldosDe([5000, -5000])
    const resultado = verificarPlan(saldos, [t('i1', 'i0', 3000), t('i1', 'i0', 2000)])

    assert.isFalse(resultado.cierra)
    assert.lengthOf(resultado.problemas, 1)
    assert.match(resultado.problemas[0], /2 transferencias/)
  })

  test('rechaza un monto cero aunque el plan cierre', ({ assert }) => {
    // Una transferencia de cero no mueve nada: cierra igual, y manda a alguien
    // a abrir la app del banco para transferir $0.
    const saldos = saldosDe([5000, -5000])
    const resultado = verificarPlan(saldos, [t('i1', 'i0', 5000), t('i0', 'i1', 0)])

    assert.isFalse(resultado.cierra)
    assert.match(resultado.problemas.join(' | '), /monto/i)
  })

  test('rechaza un monto negativo aunque el plan cierre', ({ assert }) => {
    // -$50 de i0 a i1 mueve lo mismo que +$50 de i1 a i0, asi que el saldo
    // final da cero y solo el signo delata el bug. Una instruccion de pago con
    // monto negativo es una instruccion al reves.
    const saldos = saldosDe([5000, -5000])
    const resultado = verificarPlan(saldos, [t('i0', 'i1', -5000)])

    assert.isFalse(resultado.cierra)
    assert.match(resultado.problemas.join(' | '), /monto/i)
  })

  test('rechaza una transferencia de alguien a si mismo aunque el plan cierre', ({ assert }) => {
    const saldos = saldosDe([5000, -5000])
    const resultado = verificarPlan(saldos, [t('i1', 'i0', 5000), t('i0', 'i0', 100)])

    assert.isFalse(resultado.cierra)
    assert.match(resultado.problemas.join(' | '), /si mismo/i)
  })

  test('rechaza una transferencia donde el colado es el que paga', ({ assert }) => {
    // Plata que entra al grupo desde afuera: el plan deja de ser un cierre
    // interno.
    const saldos = saldosDe([5000, -5000])
    const resultado = verificarPlan(saldos, [t('colado', 'i0', 5000)])

    assert.isFalse(resultado.cierra)
    assert.match(resultado.problemas.join(' | '), /colado/)
  })

  test('rechaza una transferencia donde el colado es el que cobra', ({ assert }) => {
    // El test de arriba pone al colado del lado del que paga, asi que dejaba
    // la otra pierna sin verificar: chequear solo `de` y no `para` no rompia
    // ningun test. Salio de un mutante que sobrevivia.
    const saldos = saldosDe([5000, -5000])
    const resultado = verificarPlan(saldos, [t('i1', 'colado', 5000)])

    assert.isFalse(resultado.cierra)
    assert.match(resultado.problemas.join(' | '), /colado/)
  })

  test('rechaza un plan sobre saldos que no suman cero, y lo dice de los saldos', ({ assert }) => {
    // Aca no hay plan posible, y el problema no es del plan. Si el mensaje
    // culpara al plan, manda a depurar el minimizador en vez de los saldos.
    const resultado = verificarPlan(saldosDe([5000, -4999]), [t('i1', 'i0', 4999)])

    assert.isFalse(resultado.cierra)
    assert.match(resultado.problemas.join(' | '), /saldos/i)
    assert.match(resultado.problemas.join(' | '), /no suman cero/i)
  })

  test('dice "sobran" o "faltan" segun el signo de la diferencia', ({ assert }) => {
    // Las dos direcciones, porque dar vuelta las dos palabras no rompia ningun
    // test: el otro caso solo verificaba que apareciera "no suman cero". Y la
    // palabra no es cosmetica — manda a buscar un gasto de mas o uno de menos,
    // que son dos busquedas distintas.
    const sobran = verificarPlan(saldosDe([5000, -4999]), [t('i1', 'i0', 4999)])
    assert.match(sobran.problemas.join(' | '), /sobran \$0\.01/)

    const faltan = verificarPlan(saldosDe([4999, -5000]), [t('i1', 'i0', 4999)])
    assert.match(faltan.problemas.join(' | '), /faltan \$0\.01/)
  })

  test('reporta todos los problemas, no corta en el primero', ({ assert }) => {
    // Un plan con dos cosas distintas mal tiene que nombrar las dos: un
    // verificador que corta en el primer problema deja la segunda escondida
    // hasta el arreglo siguiente.
    const saldos = saldosDe([5000, -5000])
    const resultado = verificarPlan(saldos, [t('i0', 'i0', 0)])

    assert.isFalse(resultado.cierra)
    assert.isAtLeast(resultado.problemas.length, 2)
  })
})

test.group('verificador | no confunde "esta mal" con "no pude mirar"', () => {
  test('lanza —no devuelve veredicto— si los saldos tienen ids repetidos', ({ assert }) => {
    // Con un id repetido no se sabe cual de los dos saldos mover, asi que no
    // hay veredicto posible. Devolver `cierra: false` lo haria indistinguible
    // de un plan roto, y `cierra: true` seria mentir: lanzar es lo unico que no
    // se puede leer mal.
    const saldos: Saldo[] = [
      { integrante: 'ana', monto: cents(5000) },
      { integrante: 'ana', monto: cents(-5000) },
    ]
    assert.throws(() => verificarPlan(saldos, []), /ana.*repetid/is)
  })
})

test.group('verificador | sirve para los dos minimizadores', () => {
  test('acepta todo plan del exacto sobre 500 casos generados', ({ assert }) => {
    const siguiente = generador(20261117)
    let casosPorDebajo = 0

    for (let caso = 0; caso < 500; caso++) {
      const valores =
        caso % 2 === 0
          ? saldosConGruposPlantados(siguiente, 2 + siguiente(7)).slice(0, LIMITE_EXACTO)
          : cadenaAlAzar(siguiente, 2 + siguiente(LIMITE_EXACTO - 1))

      const suma = valores.reduce((a, b) => a + b, 0)
      if (suma !== 0) valores.push(-suma)
      const activos = valores.filter((v) => v !== 0).length
      if (activos > LIMITE_EXACTO) continue

      const saldos = saldosDe(valores)
      const plan = minimizarExacto(saldos)
      const resultado = verificarPlan(saldos, plan)

      if (plan.length < activos - 1) casosPorDebajo++

      assert.isTrue(
        resultado.cierra,
        `rechazo un plan del exacto: ${resultado.problemas.join(' | ')} ` +
          `con saldos=${JSON.stringify(valores)}`
      )
    }

    // Si todos los planes dieran exactamente n-1, la cota del verificador
    // estaria siempre en el borde y nunca se veria que acepta planes mas
    // cortos. Medido con esta semilla: 167 de 500. El umbral esta abajo de lo
    // medido para dejar lugar a retoques del generador, no para tolerar que se
    // caiga a cero.
    assert.isAbove(casosPorDebajo, 50, 'los casos generados no ejercitan planes bajo n-1')
  })

  test('acepta todo plan del greedy sobre 500 casos generados, grupos grandes', ({ assert }) => {
    const siguiente = generador(31416)
    let casosGrandes = 0

    for (let caso = 0; caso < 500; caso++) {
      const valores =
        caso % 2 === 0
          ? saldosConGruposPlantados(siguiente, LIMITE_EXACTO + 1 + siguiente(30))
          : cadenaAlAzar(siguiente, LIMITE_EXACTO + 1 + siguiente(30))

      if (valores.filter((v) => v !== 0).length > LIMITE_EXACTO) casosGrandes++

      const saldos = saldosDe(valores)
      const resultado = verificarPlan(saldos, minimizarGreedy(saldos))

      assert.isTrue(
        resultado.cierra,
        `rechazo un plan del greedy: ${resultado.problemas.join(' | ')} ` +
          `con saldos=${JSON.stringify(valores)}`
      )
    }

    // El greedy existe para los grupos que el exacto no toma; si los casos
    // cayeran por debajo del limite, el verificador no se estaria probando
    // sobre los planes que de verdad va a ver. Medido: 500 de 500.
    assert.isAbove(casosGrandes, 450, 'los casos generados no son grupos grandes')
  })

  test('agarra un plan roto sobre un caso que el greedy resuelve bien', ({ assert }) => {
    // El contraste de los dos tests de arriba: sobre los mismos saldos, el plan
    // bueno pasa y el mismo plan con una transferencia borrada no. Sin esto,
    // los dos podrian estar pasando con un verificador que dice `true` a todo.
    const saldos = saldosDe([29000, ...Array.from({ length: 29 }, () => -1000)])
    const plan = minimizarGreedy(saldos)

    assert.isTrue(verificarPlan(saldos, plan).cierra)
    assert.isFalse(verificarPlan(saldos, plan.slice(1)).cierra)
  })

  test('no modifica ni los saldos ni el plan que recibe', ({ assert }) => {
    const saldos = saldosDe([5000, 3000, -2000, -6000])
    const plan = minimizarGreedy(saldos)
    const saldosAntes = JSON.stringify(saldos)
    const planAntes = JSON.stringify(plan)

    verificarPlan(saldos, plan)

    assert.equal(JSON.stringify(saldos), saldosAntes)
    assert.equal(JSON.stringify(plan), planAntes)
  })
})
