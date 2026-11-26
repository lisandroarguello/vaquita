import { describe, expect, test } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { App } from '../src/App'
import { CLAVE } from '../src/auth/token'
import { USUARIO, instalarBackend, montar, respuestaDemorada } from './ayudas'

/**
 * FE-1, el criterio de hecho: **sin parpadeo al recargar con sesion valida.**
 *
 * "Sin parpadeo" no se puede verificar mirando el final: al final la pantalla
 * correcta esta puesta igual, con gate o sin gate. Lo que hay que mirar es el
 * **medio**: lo que se dibuja mientras `/me` todavia no contesto. Por eso estos
 * tests dejan la respuesta colgada a proposito y recien ahi preguntan.
 */
describe('arranque | el gate de carga', () => {
  test('con token guardado, no muestra el login mientras no sabe quien sos', async () => {
    window.localStorage.setItem(CLAVE, 'vaq_token_guardado')
    const { manejador, responder } = respuestaDemorada()
    instalarBackend({ 'GET /api/v1/me': manejador })

    montar(<App />, { ruta: '/' })

    // El instante del parpadeo. Lo unico que se ve es la espera.
    expect(await screen.findByRole('status')).toHaveTextContent(/cargando/i)
    expect(screen.queryByRole('heading', { name: /entrar a vaquita/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /hola/i })).not.toBeInTheDocument()

    responder({ estado: 200, cuerpo: { user: USUARIO } })

    expect(await screen.findByRole('heading', { name: /hola, ana/i })).toBeInTheDocument()
    // Y el login no aparecio en ningun momento del camino.
    expect(screen.queryByRole('heading', { name: /entrar a vaquita/i })).not.toBeInTheDocument()
  })

  test('el token guardado viaja en el header del pedido de rehidratacion', async () => {
    window.localStorage.setItem(CLAVE, 'vaq_token_guardado')
    const pedidos = instalarBackend({
      'GET /api/v1/me': { estado: 200, cuerpo: { user: USUARIO } },
    })

    montar(<App />, { ruta: '/' })
    await screen.findByRole('heading', { name: /hola, ana/i })

    // Sin esto el gate espera una respuesta que siempre va a ser 401: la sesion
    // guardada no se rehidrata nunca y recargar es cerrar sesion.
    expect(pedidos[0]?.autorizacion).toBe('Bearer vaq_token_guardado')
  })

  test('sin token guardado va derecho al login, y no le pregunta nada al backend', async () => {
    // Ni un manejador declarado: cualquier `fetch` revienta con la ruta en el
    // mensaje. Preguntar `/me` sin token es un 401 garantizado y una pantalla de
    // carga que no hacia falta.
    const pedidos = instalarBackend({})

    montar(<App />, { ruta: '/' })

    expect(await screen.findByRole('heading', { name: /entrar a vaquita/i })).toBeInTheDocument()
    expect(pedidos).toHaveLength(0)
  })

  test('un token que ya no sirve termina en el login y se borra del almacen', async () => {
    window.localStorage.setItem(CLAVE, 'vaq_token_vencido')
    instalarBackend({
      'GET /api/v1/me': {
        estado: 401,
        cuerpo: { errors: [{ rule: 'unauthorized', message: 'Sesion invalida' }] },
      },
    })

    montar(<App />, { ruta: '/' })

    expect(await screen.findByRole('heading', { name: /entrar a vaquita/i })).toBeInTheDocument()
    // Dejarlo guardado hace que cada recarga repita el mismo viaje inutil.
    await waitFor(() => expect(window.localStorage.getItem(CLAVE)).toBeNull())
  })
})
