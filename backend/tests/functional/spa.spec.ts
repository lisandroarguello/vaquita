import { test } from '@japa/runner'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import app from '@adonisjs/core/services/app'

/**
 * Un solo servicio: la API y el frontend salen del mismo origen.
 *
 * Lo que estos tests fijan es el reparto de `/`: todo lo que empieza con `/api`
 * es la API y contesta JSON —incluido su 404—, y **todo lo demas** devuelve el
 * `index.html` del build para que el router del navegador decida. Sin eso,
 * recargar la pagina estando en `/grupos/abc` da el 404 del backend: la ruta
 * existe en React y no existe en Adonis, y el navegador le pregunta a Adonis.
 *
 * El `index.html` se escribe aca y se borra al final: en el repositorio no hay
 * ninguno —es un producto del build de Vite, que esta en `.gitignore`— y un
 * test que dependiera de haber corrido `npm run build` antes seria un test que
 * falla en CI por un motivo que no tiene nada que ver con lo que prueba.
 */

const PAGINA = '<!doctype html><title>Vaquita</title><div id="raiz"></div>'

async function conIndex() {
  await mkdir(app.publicPath(), { recursive: true })
  await writeFile(app.publicPath('index.html'), PAGINA, 'utf-8')
}

async function sinIndex() {
  await rm(app.publicPath('index.html'), { force: true })
}

test.group('spa | un solo origen para la API y el frontend', (group) => {
  group.each.setup(() => conIndex())
  group.each.teardown(() => sinIndex())

  test('la raiz devuelve la pagina del frontend', async ({ client, assert }) => {
    const r = await client.get('/')
    r.assertStatus(200)
    assert.include(r.text(), 'id="raiz"')
  })

  test('una ruta del router del navegador devuelve la pagina, no un 404', async ({
    client,
    assert,
  }) => {
    // Es el caso de recargar con la sesion abierta, que es justo donde vive el
    // criterio de FE-1.
    const r = await client.get('/grupos/11111111-1111-4111-8111-111111111111')
    r.assertStatus(200)
    assert.include(r.text(), 'id="raiz"')
  })

  test('un endpoint que no existe bajo /api sigue siendo un 404 de la API', async ({
    client,
    assert,
  }) => {
    const r = await client.get('/api/v1/no-existe')
    r.assertStatus(404)
    // Devolver la pagina aca seria peor que un 404: un `fetch` que esperaba
    // JSON recibiria HTML y el error del cliente hablaria del parseo.
    assert.notInclude(r.text(), 'id="raiz"')
  })

  test('el estado del servicio no se lo come el comodin', async ({ client }) => {
    // Vive bajo `/api` justamente porque `/` ahora es del frontend.
    const r = await client.get('/api/v1/health')
    r.assertStatus(200)
    r.assertBodyContains({ name: 'vaquita', status: 'ok' })
  })
})

test.group('spa | sin build del frontend', () => {
  test('lo dice en vez de reventar', async ({ client, assert }) => {
    await sinIndex()

    const r = await client.get('/grupos/cualquiera')
    // 503 y no 404: la ruta es correcta y lo que falta es el despliegue del
    // frontend. Un 404 mandaria a buscar el error en el router del navegador,
    // que es el lugar equivocado.
    r.assertStatus(503)
    assert.match(r.body().errors[0].message, /build|frontend/i)
  })
})
