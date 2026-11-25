import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import hash from '@adonisjs/core/services/hash'
import {
  buscarPorMail,
  crearUsuario,
  verificarCredenciales,
} from '#repositories/usuario_repository'

/**
 * El repositorio de usuarios, contra Postgres de verdad.
 *
 * Es la unica puerta de entrada al login, asi que lo que se prueba aca no es
 * "guarda y lee": es que la contraseña nunca quede en claro, que el mail no
 * dependa de como lo escribio el usuario, y que **un mail inexistente y una
 * contraseña equivocada sean indistinguibles**. Esa ultima es la que importa:
 * si difieren, cualquiera puede averiguar quien tiene cuenta.
 */

const CLAVE = 'una-clave-de-prueba-larga'

async function limpiar() {
  await db.rawQuery(`DELETE FROM users WHERE email LIKE '%@prueba.example'`)
}

test.group('usuarios | el alta y la busqueda', (group) => {
  group.each.setup(() => limpiar())
  group.each.teardown(() => limpiar())

  test('guarda el mail en minuscula aunque llegue en mayusculas', async ({ assert }) => {
    const creado = await crearUsuario({
      email: 'Ana.Perez@Prueba.Example',
      passwordPlano: CLAVE,
      nombre: 'Ana',
    })

    assert.equal(creado.email, 'ana.perez@prueba.example')

    // Y se encuentra escribiendolo de cualquier forma: nadie recuerda como se
    // registro.
    const hallado = await buscarPorMail('ANA.PEREZ@PRUEBA.EXAMPLE')
    assert.isNotNull(hallado)
    assert.equal(hallado!.id, creado.id)
  })

  test('un mail repetido no entra, ni cambiandole las mayusculas', async ({ assert }) => {
    await crearUsuario({ email: 'ana@prueba.example', passwordPlano: CLAVE, nombre: 'Ana' })

    await assert.rejects(async () => {
      await crearUsuario({ email: 'ANA@prueba.example', passwordPlano: CLAVE, nombre: 'Otra Ana' })
    }, /users_mail_unico/)
  })

  test('buscar un mail que no existe devuelve null y no explota', async ({ assert }) => {
    assert.isNull(await buscarPorMail('nadie@prueba.example'))
  })

  test('la contraseña se guarda hasheada, nunca en claro', async ({ assert }) => {
    const creado = await crearUsuario({
      email: 'ana@prueba.example',
      passwordPlano: CLAVE,
      nombre: 'Ana',
    })

    const { rows } = await db.rawQuery(`SELECT password_hash FROM users WHERE id = ?`, [creado.id])
    const guardado = rows[0].password_hash

    assert.notEqual(guardado, CLAVE)
    assert.notInclude(guardado, CLAVE)
    assert.isTrue(await hash.verify(guardado, CLAVE), 'el hash guardado tiene que verificar')
  })

  test('el usuario que devuelve el alta no trae el hash', async ({ assert }) => {
    // Lo que sale del repositorio hacia arriba viaja a la respuesta HTTP. Si el
    // hash viene en el objeto, tarde o temprano alguien lo serializa.
    const creado = await crearUsuario({
      email: 'ana@prueba.example',
      passwordPlano: CLAVE,
      nombre: 'Ana',
    })

    assert.notProperty(creado, 'password_hash')
    assert.notProperty(creado, 'passwordHash')
  })
})

test.group('usuarios | la verificacion de credenciales', (group) => {
  group.each.setup(async () => {
    await limpiar()
    await crearUsuario({ email: 'ana@prueba.example', passwordPlano: CLAVE, nombre: 'Ana' })
  })
  group.each.teardown(() => limpiar())

  test('acepta la contraseña correcta', async ({ assert }) => {
    const usuario = await verificarCredenciales('ana@prueba.example', CLAVE)
    assert.isNotNull(usuario)
    assert.equal(usuario!.nombre, 'Ana')
  })

  test('acepta la contraseña correcta con el mail en otra capitalizacion', async ({ assert }) => {
    assert.isNotNull(await verificarCredenciales('ANA@Prueba.Example', CLAVE))
  })

  test('rechaza la contraseña equivocada', async ({ assert }) => {
    assert.isNull(await verificarCredenciales('ana@prueba.example', 'otra-clave-cualquiera'))
  })

  test('rechaza un mail que no existe', async ({ assert }) => {
    assert.isNull(await verificarCredenciales('nadie@prueba.example', CLAVE))
  })

  test('no distingue entre mail inexistente y contraseña equivocada', async ({ assert }) => {
    // Las dos tienen que dar exactamente lo mismo. Si una devolviera, por
    // ejemplo, un motivo distinto, alcanzaria para saber quien tiene cuenta.
    const porMail = await verificarCredenciales('nadie@prueba.example', CLAVE)
    const porClave = await verificarCredenciales('ana@prueba.example', 'otra-clave-cualquiera')

    assert.deepEqual(porMail, porClave)
  })

  test('tampoco los distingue por el tiempo que tarda', async ({ assert }) => {
    // El cuerpo de la respuesta puede ser identico y el reloj delatarlo igual:
    // si el mail no existe no hay hash que verificar, y la respuesta vuelve al
    // instante. Por eso `verificarCredenciales` hashea una clave descartable en
    // ese camino.
    //
    // El umbral no es arbitrario, esta medido en esta maquina:
    //   con el hash descartable ..... 3,1 ms de diferencia
    //   sin el (el mutante) ........ 53,6 ms de diferencia
    // 25 ms cae en el medio con margen de sobra para los dos lados, asi que el
    // test no es fragil: distingue 3 de 53, no 3 de 4.
    const inexistente = await medianaDe(() => verificarCredenciales('nadie@prueba.example', CLAVE))
    const claveMala = await medianaDe(() =>
      verificarCredenciales('ana@prueba.example', 'otra-clave-cualquiera')
    )

    assert.isBelow(
      Math.abs(inexistente - claveMala),
      25,
      `el tiempo delata si el mail existe: ${inexistente.toFixed(1)}ms contra ${claveMala.toFixed(1)}ms`
    )
  }).timeout(60000)
})

/** Mediana de varias corridas: una sola medicion la ensucia cualquier cosa. */
async function medianaDe(fn: () => Promise<unknown>, vueltas = 9): Promise<number> {
  const muestras: number[] = []
  for (let i = 0; i < vueltas; i++) {
    const comienzo = performance.now()
    await fn()
    muestras.push(performance.now() - comienzo)
  }
  muestras.sort((a, b) => a - b)
  return muestras[Math.floor(muestras.length / 2)]
}
