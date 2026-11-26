import { describe, expect, test } from 'vitest'
import { ErrorApi, pedir } from '../src/api/cliente'
import { instalarBackend } from './ayudas'
import { guardarToken, olvidarToken, rehidratarToken, CLAVE } from '../src/auth/token'

describe('cliente | la frontera con la API', () => {
  test('pega el prefijo /api/v1 una sola vez', async () => {
    const pedidos = instalarBackend({ 'GET /api/v1/groups': { estado: 200, cuerpo: { groups: [] } } })
    await pedir('/groups')
    expect(pedidos[0]?.ruta).toBe('/api/v1/groups')
  })

  /**
   * El 404 del backend es **tambien** "no sos integrante de este grupo", a
   * proposito: un 403 confirmaria que el grupo existe. Si el cliente aplanara
   * el error a "algo salio mal", la pantalla mostraria un error de sistema
   * donde lo correcto es decir que ese grupo no esta disponible. Por eso el
   * estado llega entero a quien decide que mostrar.
   */
  test('el 404 llega como 404 y no como error generico', async () => {
    instalarBackend({
      'GET /api/v1/groups/ajeno': {
        estado: 404,
        cuerpo: { errors: [{ message: 'Grupo no encontrado' }] },
      },
    })

    const error = await pedir('/groups/ajeno').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ErrorApi)
    expect((error as ErrorApi).estado).toBe(404)
    expect((error as ErrorApi).esNoDisponible).toBe(true)
    expect((error as ErrorApi).esSesionInvalida).toBe(false)
  })

  test('un cuerpo que no es JSON no se convierte en un error sobre JSON', async () => {
    instalarBackend({ 'GET /api/v1/groups': { estado: 502 } })

    const error = (await pedir('/groups').catch((e: unknown) => e)) as ErrorApi
    expect(error.estado).toBe(502)
    expect(error.message).toMatch(/502/)
    expect(error.message).not.toMatch(/JSON|token/i)
  })

  test('mensajeDe encuentra el campo que el backend señalo', () => {
    const error = new ErrorApi(409, [{ field: 'email', message: 'Ese mail ya tiene una cuenta' }])
    expect(error.mensajeDe('email')).toMatch(/ya tiene una cuenta/i)
    expect(error.mensajeDe('password')).toBeUndefined()
  })
})

describe('token | memoria y almacen', () => {
  test('guardar escribe en los dos lados y rehidratar lo recupera', () => {
    guardarToken('vaq_uno')
    expect(window.localStorage.getItem(CLAVE)).toBe('vaq_uno')
    expect(rehidratarToken()).toBe('vaq_uno')
  })

  test('olvidar borra tambien el almacen, no solo la memoria', () => {
    guardarToken('vaq_uno')
    olvidarToken()
    // Si quedara en el almacen, la proxima recarga lo rehidrata y el usuario
    // que cerro sesion vuelve adentro solo.
    expect(window.localStorage.getItem(CLAVE)).toBeNull()
    expect(rehidratarToken()).toBeNull()
  })
})
