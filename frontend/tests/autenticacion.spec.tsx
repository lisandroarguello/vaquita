import { describe, expect, test } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../src/App'
import { CLAVE } from '../src/auth/token'
import { USUARIO, instalarBackend, montar, respuestaDeSesion } from './ayudas'

describe('rutas protegidas | lo de adentro exige sesion', () => {
  test('sin sesion, la pantalla de adentro manda al login', async () => {
    instalarBackend({})

    montar(<App />, { ruta: '/' })

    expect(await screen.findByRole('heading', { name: /entrar a vaquita/i })).toBeInTheDocument()
    // Lo que no puede pasar es que el contenido se dibuje "un momentito".
    expect(screen.queryByRole('heading', { name: /hola/i })).not.toBeInTheDocument()
  })

  test('una ruta que no existe tampoco es una puerta de atras', async () => {
    instalarBackend({})

    montar(<App />, { ruta: '/grupos/cualquiera' })

    expect(await screen.findByRole('heading', { name: /entrar a vaquita/i })).toBeInTheDocument()
  })

  test('quien ya tiene sesion no se queda en el login', async () => {
    window.localStorage.setItem(CLAVE, 'vaq_token_guardado')
    instalarBackend({ 'GET /api/v1/me': { estado: 200, cuerpo: { user: USUARIO } } })

    montar(<App />, { ruta: '/entrar' })

    expect(await screen.findByRole('heading', { name: /hola, ana/i })).toBeInTheDocument()
  })
})

describe('entrar | el formulario de inicio de sesion', () => {
  test('con las credenciales bien, entra y deja la sesion guardada', async () => {
    const pedidos = instalarBackend({
      'POST /api/v1/auth/login': { estado: 200, cuerpo: respuestaDeSesion('vaq_token_nuevo') },
    })

    montar(<App />, { ruta: '/entrar' })
    await entrarCon('ana@vaquita.example', 'una-clave-de-prueba-larga')

    expect(await screen.findByRole('heading', { name: /hola, ana/i })).toBeInTheDocument()
    // Sin la copia en el almacen, recargar la pagina es cerrar sesion.
    expect(window.localStorage.getItem(CLAVE)).toBe('vaq_token_nuevo')
    expect(pedidos[0]?.cuerpo).toEqual({
      email: 'ana@vaquita.example',
      password: 'una-clave-de-prueba-larga',
    })
  })

  /**
   * El backend contesta el **mismo** 401 sin `field` para un mail que no existe
   * y para una contraseña equivocada, para no ser un oraculo de quien tiene
   * cuenta. Este test fija que el formulario no desarme esa decision del lado
   * del cliente: un mensaje, y ningun campo señalado.
   */
  test('con las credenciales mal, un solo mensaje y ningun campo señalado', async () => {
    instalarBackend({
      'POST /api/v1/auth/login': {
        estado: 401,
        cuerpo: {
          errors: [{ rule: 'invalid_credentials', message: 'Mail o contraseña incorrectos' }],
        },
      },
    })

    montar(<App />, { ruta: '/entrar' })
    await entrarCon('ana@vaquita.example', 'la-que-no-era-larga')

    expect(await screen.findByRole('alert')).toHaveTextContent(/mail o contraseña incorrectos/i)
    expect(screen.getByLabelText('Mail')).not.toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Contraseña')).not.toHaveAttribute('aria-invalid', 'true')
    // Y no entro: una pantalla de adentro con un login fallido seria peor que
    // el parpadeo.
    expect(screen.queryByRole('heading', { name: /hola/i })).not.toBeInTheDocument()
    expect(window.localStorage.getItem(CLAVE)).toBeNull()
  })

  test('si el backend se cae, el mensaje habla de la operacion y no del JSON', async () => {
    instalarBackend({
      // Un 502 del proxy no trae `{ errors: [...] }`, ni siquiera JSON.
      'POST /api/v1/auth/login': { estado: 502 },
    })

    montar(<App />, { ruta: '/entrar' })
    await entrarCon('ana@vaquita.example', 'una-clave-de-prueba-larga')

    expect(await screen.findByRole('alert')).toHaveTextContent(/no pudimos entrar/i)
  })
})

describe('registro | el alta de cuenta', () => {
  test('crea la cuenta y entra sin pedir el login de nuevo', async () => {
    const pedidos = instalarBackend({
      'POST /api/v1/auth/signup': { estado: 201, cuerpo: respuestaDeSesion('vaq_token_de_alta') },
    })

    montar(<App />, { ruta: '/registro' })
    const usuario = userEvent.setup()
    await usuario.type(screen.getByLabelText('Tu nombre'), 'Ana')
    await usuario.type(screen.getByLabelText('Mail'), 'ana@vaquita.example')
    await usuario.type(screen.getByLabelText('Contraseña'), 'una-clave-de-prueba-larga')
    await usuario.click(screen.getByRole('button', { name: /crear cuenta/i }))

    expect(await screen.findByRole('heading', { name: /hola, ana/i })).toBeInTheDocument()
    expect(window.localStorage.getItem(CLAVE)).toBe('vaq_token_de_alta')
    expect(pedidos[0]?.cuerpo).toEqual({
      email: 'ana@vaquita.example',
      password: 'una-clave-de-prueba-larga',
      display_name: 'Ana',
    })
  })

  /**
   * Aca **sí** se marca el campo, y no contradice al login: el 409 del backend
   * viene con `field: "email"` porque quien se registra necesita saber que ese
   * mail ya tiene cuenta para poder entrar en vez de insistir.
   */
  test('un mail ya registrado se señala en el campo del mail', async () => {
    instalarBackend({
      'POST /api/v1/auth/signup': {
        estado: 409,
        cuerpo: {
          errors: [{ field: 'email', rule: 'unique', message: 'Ese mail ya tiene una cuenta' }],
        },
      },
    })

    montar(<App />, { ruta: '/registro' })
    const usuario = userEvent.setup()
    await usuario.type(screen.getByLabelText('Tu nombre'), 'Ana')
    await usuario.type(screen.getByLabelText('Mail'), 'ana@vaquita.example')
    await usuario.type(screen.getByLabelText('Contraseña'), 'una-clave-de-prueba-larga')
    await usuario.click(screen.getByRole('button', { name: /crear cuenta/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/ya tiene una cuenta/i)
    expect(screen.getByLabelText('Mail')).toHaveAttribute('aria-invalid', 'true')
  })
})

describe('salir | cerrar sesion', () => {
  test('revoca el token en el backend, lo borra del almacen y vuelve al login', async () => {
    window.localStorage.setItem(CLAVE, 'vaq_token_guardado')
    const pedidos = instalarBackend({
      'GET /api/v1/me': { estado: 200, cuerpo: { user: USUARIO } },
      'POST /api/v1/auth/logout': { estado: 200, cuerpo: { revoked: true } },
    })

    montar(<App />, { ruta: '/' })
    await screen.findByRole('heading', { name: /hola, ana/i })
    await userEvent.setup().click(screen.getByRole('button', { name: /cerrar sesión/i }))

    expect(await screen.findByRole('heading', { name: /entrar a vaquita/i })).toBeInTheDocument()

    // Las dos mitades del logout, que fallan por separado:
    // el pedido —sin el, el token sigue vivo 30 dias en el servidor—
    expect(pedidos.map((p) => `${p.metodo} ${p.ruta}`)).toContain('POST /api/v1/auth/logout')
    expect(pedidos.at(-1)?.autorizacion).toBe('Bearer vaq_token_guardado')
    // y el borrado local, sin el cual la proxima recarga vuelve a entrar sola.
    expect(window.localStorage.getItem(CLAVE)).toBeNull()
  })

  test('un logout que falla igual cierra la sesion del lado del cliente', async () => {
    window.localStorage.setItem(CLAVE, 'vaq_token_vencido')
    instalarBackend({
      'GET /api/v1/me': { estado: 200, cuerpo: { user: USUARIO } },
      // El token vencio entre que se dibujo la pantalla y el click.
      'POST /api/v1/auth/logout': { estado: 401, cuerpo: { errors: [{ message: 'Sin sesion' }] } },
    })

    montar(<App />, { ruta: '/' })
    await screen.findByRole('heading', { name: /hola, ana/i })
    await userEvent.setup().click(screen.getByRole('button', { name: /cerrar sesión/i }))

    // El usuario pidio salir: quedarse adentro porque el servidor dijo 401
    // seria obedecer al error en vez de a la persona.
    expect(await screen.findByRole('heading', { name: /entrar a vaquita/i })).toBeInTheDocument()
    await waitFor(() => expect(window.localStorage.getItem(CLAVE)).toBeNull())
  })
})

async function entrarCon(email: string, password: string) {
  const usuario = userEvent.setup()
  await usuario.type(screen.getByLabelText('Mail'), email)
  await usuario.type(screen.getByLabelText('Contraseña'), password)
  await usuario.click(screen.getByRole('button', { name: /^entrar$/i }))
}
