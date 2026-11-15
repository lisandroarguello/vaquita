import { test } from '@japa/runner'
import { Money } from '#domain/money'

/**
 * DOM-1 — Tipo Money en centavos enteros.
 *
 * El criterio de hecho del ticket es explicito: operaciones de suma, resta y
 * comparacion, y esta prohibido construir un Money a partir de un float. Los
 * tests estan ordenados para que la prohibicion quede primero, porque es la
 * razon de ser del tipo: si se puede construir desde 0.1 + 0.2, todo lo demas
 * sobra.
 */
test.group('Money | no se construye desde un float', () => {
  test('fromCents rechaza un numero con parte decimal', ({ assert }) => {
    assert.throws(() => Money.fromCents(10.5), /enter[oa]/i)
  })

  test('fromCents rechaza NaN e Infinity', ({ assert }) => {
    assert.throws(() => Money.fromCents(Number.NaN), /enter[oa]/i)
    assert.throws(() => Money.fromCents(Number.POSITIVE_INFINITY), /enter[oa]/i)
  })

  test('fromCents rechaza enteros fuera del rango seguro', ({ assert }) => {
    assert.throws(() => Money.fromCents(Number.MAX_SAFE_INTEGER + 2), /seguro/i)
  })

  test('el error clasico de coma flotante no entra al dominio', ({ assert }) => {
    // 0.1 + 0.2 === 0.30000000000000004. Si existiera una via para construir
    // Money desde ese numero, el dominio entero heredaria el problema.
    assert.throws(() => Money.fromCents((0.1 + 0.2) * 100), /enter[oa]/i)
  })
})

test.group('Money | construccion desde texto', () => {
  test('parsea dos decimales', ({ assert }) => {
    assert.equal(Money.fromDecimalString('1234.56').cents, 123456)
  })

  test('parsea un decimal y ninguno', ({ assert }) => {
    assert.equal(Money.fromDecimalString('10.5').cents, 1050)
    assert.equal(Money.fromDecimalString('10').cents, 1000)
  })

  test('parsea negativos', ({ assert }) => {
    assert.equal(Money.fromDecimalString('-10.50').cents, -1050)
  })

  test('acepta la coma como separador decimal', ({ assert }) => {
    // El usuario es argentino: va a escribir 1234,56 tanto como 1234.56.
    assert.equal(Money.fromDecimalString('1234,56').cents, 123456)
  })

  test('rechaza mas de dos decimales en vez de redondear', ({ assert }) => {
    // Redondear en silencio es como se pierde un centavo sin que nadie se entere.
    assert.throws(() => Money.fromDecimalString('10.5555'), /dos decimales/i)
  })

  test('rechaza texto que no es un monto', ({ assert }) => {
    assert.throws(() => Money.fromDecimalString('abc'), /monto/i)
    assert.throws(() => Money.fromDecimalString(''), /monto/i)
    assert.throws(() => Money.fromDecimalString('10.5.3'), /monto/i)
  })
})

/**
 * El punto es separador de miles en Argentina y separador decimal en formato
 * ingles. "1.500" significa mil quinientos para quien lo escribe y un peso con
 * cincuenta para un parser ingenuo. Adivinar es peor que fallar, pero fallar
 * acusando algo que no pasó ("tiene mas de dos decimales") es casi tan malo:
 * el mensaje tiene que nombrar la ambiguedad real y decir como salir de ella.
 */
test.group('Money | formato de miles argentino', () => {
  test('la coma decimal desambigua el punto de miles', ({ assert }) => {
    assert.equal(Money.fromDecimalString('1.234,56').cents, 123456)
    assert.equal(Money.fromDecimalString('1.234.567,89').cents, 123456789)
    assert.equal(Money.fromDecimalString('-1.234,56').cents, -123456)
  })

  test('dos o mas grupos de miles no son ambiguos sin coma', ({ assert }) => {
    // "1.234.567" no puede ser un decimal: ningun decimal tiene dos puntos.
    assert.equal(Money.fromDecimalString('1.234.567').cents, 123456700)
  })

  test('un solo grupo de tres cifras es ambiguo y se rechaza nombrandolo', ({ assert }) => {
    for (const ambiguo of ['1.500', '10.555', '123.456']) {
      assert.throws(() => Money.fromDecimalString(ambiguo), /ambigu/i)
    }
  })

  test('el error de ambiguedad sugiere como escribirlo', ({ assert }) => {
    try {
      Money.fromDecimalString('1.500')
      assert.fail('deberia haber lanzado')
    } catch (error: any) {
      assert.match(error.message, /1500/)
      assert.match(error.message, /1\.500,00/)
    }
  })

  test('uno y dos decimales siguen sin ser ambiguos', ({ assert }) => {
    assert.equal(Money.fromDecimalString('1.5').cents, 150)
    assert.equal(Money.fromDecimalString('1.50').cents, 150)
    assert.equal(Money.fromDecimalString('1234.56').cents, 123456)
  })

  test('rechaza grupos de miles mal formados', ({ assert }) => {
    assert.throws(() => Money.fromDecimalString('1.23,45'), /monto/i)
    assert.throws(() => Money.fromDecimalString('12.34.567'), /monto/i)
  })
})

test.group('Money | aritmetica', () => {
  test('suma y resta', ({ assert }) => {
    const a = Money.fromCents(1050)
    const b = Money.fromCents(325)
    assert.equal(a.plus(b).cents, 1375)
    assert.equal(a.minus(b).cents, 725)
  })

  test('la resta puede dar negativo', ({ assert }) => {
    assert.equal(Money.fromCents(100).minus(Money.fromCents(250)).cents, -150)
  })

  test('negated invierte el signo', ({ assert }) => {
    assert.equal(Money.fromCents(1050).negated().cents, -1050)
    assert.equal(Money.zero().negated().cents, 0)
  })

  test('las operaciones no mutan los operandos', ({ assert }) => {
    const a = Money.fromCents(1000)
    const b = Money.fromCents(500)
    a.plus(b)
    a.minus(b)
    assert.equal(a.cents, 1000)
    assert.equal(b.cents, 500)
  })

  test('sumar muchos montos no acumula error', ({ assert }) => {
    // El mismo bucle con floats da 0.9999999999999999 en vez de 1.
    let total = Money.zero()
    for (let i = 0; i < 10; i++) total = total.plus(Money.fromDecimalString('0.10'))
    assert.equal(total.cents, 100)
    assert.isTrue(total.equals(Money.fromDecimalString('1.00')))
  })
})

test.group('Money | comparacion', () => {
  test('equals compara por valor, no por identidad', ({ assert }) => {
    assert.isTrue(Money.fromCents(500).equals(Money.fromCents(500)))
    assert.isFalse(Money.fromCents(500).equals(Money.fromCents(501)))
  })

  test('compare ordena', ({ assert }) => {
    const chico = Money.fromCents(100)
    const grande = Money.fromCents(200)
    assert.isBelow(chico.compare(grande), 0)
    assert.isAbove(grande.compare(chico), 0)
    assert.equal(chico.compare(Money.fromCents(100)), 0)
  })

  test('compare sirve para ordenar una lista', ({ assert }) => {
    const montos = [300, -100, 0, 150].map(Money.fromCents)
    const ordenados = [...montos].sort((x, y) => x.compare(y)).map((m) => m.cents)
    assert.deepEqual(ordenados, [-100, 0, 150, 300])
  })

  test('isZero, isNegative e isPositive', ({ assert }) => {
    assert.isTrue(Money.zero().isZero())
    assert.isFalse(Money.zero().isNegative())
    assert.isFalse(Money.zero().isPositive())
    assert.isTrue(Money.fromCents(-1).isNegative())
    assert.isTrue(Money.fromCents(1).isPositive())
  })
})

test.group('Money | representacion', () => {
  test('toString usa siempre dos decimales', ({ assert }) => {
    assert.equal(Money.fromCents(123456).toString(), '1234.56')
    assert.equal(Money.fromCents(1050).toString(), '10.50')
    assert.equal(Money.fromCents(5).toString(), '0.05')
    assert.equal(Money.zero().toString(), '0.00')
  })

  test('toString conserva el signo', ({ assert }) => {
    assert.equal(Money.fromCents(-1050).toString(), '-10.50')
    assert.equal(Money.fromCents(-5).toString(), '-0.05')
  })

  test('texto a Money y vuelta es la identidad', ({ assert }) => {
    for (const texto of ['0.00', '10.50', '-10.50', '1234.56', '0.05', '-0.01']) {
      assert.equal(Money.fromDecimalString(texto).toString(), texto)
    }
  })

  test('toJSON serializa los centavos, no el texto', ({ assert }) => {
    // Lo que viaja por la API son centavos enteros. El formateo es del cliente.
    assert.deepEqual(JSON.parse(JSON.stringify({ monto: Money.fromCents(1050) })), {
      monto: 1050,
    })
  })
})
