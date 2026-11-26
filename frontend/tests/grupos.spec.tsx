import { describe, expect, test } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../src/App'
import { CLAVE } from '../src/auth/token'
import { USUARIO, instalarBackend, montar, respuestaDemorada } from './ayudas'
import type { Manejador } from './ayudas'

/**
 * FE-2 — lista de grupos y alta. Criterio de hecho: **estados de vacio, carga y
 * error cubiertos.**
 *
 * Los tres son estados, no decoracion: cada uno le dice a la persona algo
 * distinto sobre que hacer. "Todavia no cargo" invita a esperar, "no tenes
 * grupos" invita a crear uno, y "no se pudo traer" invita a reintentar. Un
 * listado que mostrara la lista vacia en los tres casos diria "no tenes grupos"
 * cuando lo que paso es que se cayo la red, y la persona crearia un grupo
 * nuevo arriba de los que ya tiene.
 */

const GRUPO_COSTA = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Finde en la costa',
  currency: 'ARS',
  status: 'open',
  my_membership_id: 'aaaa1111-1111-4111-8111-111111111111',
  my_role: 'admin',
  my_balance_cents: 1234567,
  member_count: 4,
}

const GRUPO_ASADO = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Asado de los jueves',
  currency: 'ARS',
  status: 'open',
  my_membership_id: 'bbbb2222-2222-4222-8222-222222222222',
  my_role: 'member',
  my_balance_cents: -50000,
  member_count: 3,
}

/** Arranca con sesion rehidratada, que es el camino normal de esta pantalla. */
function conSesion(grupos: Manejador, extra: Record<string, Manejador> = {}) {
  window.localStorage.setItem(CLAVE, 'vaq_token_guardado')
  return instalarBackend({
    'GET /api/v1/me': { estado: 200, cuerpo: { user: USUARIO } },
    'GET /api/v1/groups': grupos,
    ...extra,
  })
}

describe('grupos | los tres estados del listado', () => {
  test('mientras carga lo dice, y no dice que no tenes grupos', async () => {
    const { manejador, responder } = respuestaDemorada()
    conSesion(manejador)

    montar(<App />, { ruta: '/' })

    // El gate de la sesion ya paso: lo que falta es la lista.
    expect(await screen.findByText(/cargando tus grupos/i)).toBeInTheDocument()
    expect(screen.queryByText(/todavia no tenes grupos/i)).not.toBeInTheDocument()

    responder({ estado: 200, cuerpo: { groups: [GRUPO_COSTA] } })
    expect(await screen.findByText('Finde en la costa')).toBeInTheDocument()
  })

  test('sin grupos invita a crear el primero, y no parece un error', async () => {
    conSesion({ estado: 200, cuerpo: { groups: [] } })

    montar(<App />, { ruta: '/' })

    expect(await screen.findByText(/todavia no tenes grupos/i)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // La salida del estado vacio es crear un grupo, asi que el formulario tiene
    // que estar a la vista y no detras de otro click.
    expect(screen.getByLabelText(/nombre del grupo/i)).toBeInTheDocument()
  })

  test('si falla lo dice y deja reintentar, sin confundirlo con estar vacio', async () => {
    let intentos = 0
    conSesion(() => {
      intentos += 1
      // El primer intento se cae; el segundo trae la lista de verdad.
      return intentos === 1
        ? { estado: 500, cuerpo: { errors: [{ message: 'Algo se rompio del otro lado' }] } }
        : { estado: 200, cuerpo: { groups: [GRUPO_COSTA] } }
    })

    montar(<App />, { ruta: '/' })

    const aviso = await screen.findByRole('alert')
    expect(aviso).toHaveTextContent(/no pudimos traer tus grupos/i)
    // Lo que no puede decir es que no tenes grupos: no se sabe.
    expect(screen.queryByText(/todavia no tenes grupos/i)).not.toBeInTheDocument()

    await userEvent.setup().click(screen.getByRole('button', { name: /probar de nuevo/i }))

    expect(await screen.findByText('Finde en la costa')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('grupos | lo que muestra cada grupo', () => {
  test('nombre, integrantes y el saldo propio con el signo en palabras', async () => {
    conSesion({ estado: 200, cuerpo: { groups: [GRUPO_COSTA, GRUPO_ASADO] } })

    montar(<App />, { ruta: '/' })
    await screen.findByText('Finde en la costa')

    const costa = screen.getByRole('listitem', { name: /finde en la costa/i })
    expect(costa).toHaveTextContent('4 integrantes')
    /**
     * El signo va en **palabras**, no solo en el color ni solo en un menos
     * adelante. Es el criterio de FE-3 y vale igual aca: "-$500,00" y "$500,00"
     * se distinguen por un caracter de un pixel, y quien no distingue rojo de
     * verde no tiene con que saber si le deben o debe.
     */
    expect(costa).toHaveTextContent(/te deben/i)
    expect(costa).toHaveTextContent('12.345,67')

    const asado = screen.getByRole('listitem', { name: /asado de los jueves/i })
    expect(asado).toHaveTextContent(/deb[eé]s/i)
    expect(asado).toHaveTextContent('500,00')
    // Y el monto que se muestra es el absoluto: el signo ya lo dijo la palabra.
    expect(asado).not.toHaveTextContent('-500,00')
  })

  test('un saldo en cero no dice ni que te deben ni que debes', async () => {
    conSesion({
      estado: 200,
      cuerpo: { groups: [{ ...GRUPO_COSTA, my_balance_cents: 0 }] },
    })

    montar(<App />, { ruta: '/' })

    const costa = await screen.findByRole('listitem', { name: /finde en la costa/i })
    expect(costa).toHaveTextContent(/est[aá]s en cero/i)
    expect(costa).not.toHaveTextContent(/te deben/i)
    expect(costa).not.toHaveTextContent(/deb[eé]s \$/i)
  })

  test('cada grupo es un enlace a su pantalla', async () => {
    conSesion({ estado: 200, cuerpo: { groups: [GRUPO_COSTA] } })

    montar(<App />, { ruta: '/' })

    const enlace = await screen.findByRole('link', { name: /finde en la costa/i })
    expect(enlace).toHaveAttribute('href', `/grupos/${GRUPO_COSTA.id}`)
  })
})

describe('grupos | el alta', () => {
  test('crea el grupo y aparece en la lista sin recargar', async () => {
    let listados = 0
    const pedidos = conSesion(
      () => {
        listados += 1
        return listados === 1
          ? { estado: 200, cuerpo: { groups: [] } }
          : { estado: 200, cuerpo: { groups: [GRUPO_COSTA] } }
      },
      {
        'POST /api/v1/groups': { estado: 201, cuerpo: { group: GRUPO_COSTA } },
      }
    )

    montar(<App />, { ruta: '/' })
    await screen.findByText(/todavia no tenes grupos/i)

    const usuario = userEvent.setup()
    await usuario.type(screen.getByLabelText(/nombre del grupo/i), 'Finde en la costa')
    await usuario.click(screen.getByRole('button', { name: /crear grupo/i }))

    // Aparece porque el listado se vuelve a pedir, no porque la pantalla haya
    // metido a mano el grupo en una lista local: si el backend lo guardo
    // distinto de lo que mandamos, se ve lo que el backend tiene.
    expect(await screen.findByText('Finde en la costa')).toBeInTheDocument()

    const alta = pedidos.find((p) => p.metodo === 'POST')
    expect(alta?.cuerpo).toEqual({ name: 'Finde en la costa', currency: 'ARS' })
    expect(alta?.autorizacion).toBe('Bearer vaq_token_guardado')
  })

  test('el campo queda limpio despues de crear, para poder crear otro', async () => {
    conSesion(
      { estado: 200, cuerpo: { groups: [] } },
      { 'POST /api/v1/groups': { estado: 201, cuerpo: { group: GRUPO_COSTA } } }
    )

    montar(<App />, { ruta: '/' })
    const usuario = userEvent.setup()
    await usuario.type(await screen.findByLabelText(/nombre del grupo/i), 'Finde en la costa')
    await usuario.click(screen.getByRole('button', { name: /crear grupo/i }))

    // Si el nombre quedara puesto, el proximo click crea un grupo repetido.
    await waitFor(() => expect(screen.getByLabelText(/nombre del grupo/i)).toHaveValue(''))
  })

  test('un nombre vacio no sale a la red', async () => {
    const pedidos = conSesion({ estado: 200, cuerpo: { groups: [] } })

    montar(<App />, { ruta: '/' })
    await screen.findByText(/todavia no tenes grupos/i)
    await userEvent.setup().click(screen.getByRole('button', { name: /crear grupo/i }))

    // No hay manejador de POST declarado: si saliera, el test revienta nombrando
    // la ruta. Y el aviso tiene que explicar que falta.
    expect(await screen.findByRole('alert')).toHaveTextContent(/nombre/i)
    expect(pedidos.filter((p) => p.metodo === 'POST')).toHaveLength(0)
  })

  test('el error del backend se muestra en el campo que el backend señalo', async () => {
    conSesion(
      { estado: 200, cuerpo: { groups: [] } },
      {
        'POST /api/v1/groups': {
          estado: 400,
          cuerpo: {
            errors: [
              { field: 'name', rule: 'maxLength', message: 'El nombre no puede pasar de 80' },
            ],
          },
        },
      }
    )

    montar(<App />, { ruta: '/' })
    const usuario = userEvent.setup()
    await usuario.type(await screen.findByLabelText(/nombre del grupo/i), 'Un nombre larguisimo')
    await usuario.click(screen.getByRole('button', { name: /crear grupo/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/no puede pasar de 80/i)
    expect(screen.getByLabelText(/nombre del grupo/i)).toHaveAttribute('aria-invalid', 'true')
  })

  test('mientras se crea, el boton no deja crear dos veces', async () => {
    const { manejador, responder } = respuestaDemorada()
    conSesion({ estado: 200, cuerpo: { groups: [] } }, { 'POST /api/v1/groups': manejador })

    montar(<App />, { ruta: '/' })
    const usuario = userEvent.setup()
    await usuario.type(await screen.findByLabelText(/nombre del grupo/i), 'Finde en la costa')
    const boton = screen.getByRole('button', { name: /crear grupo/i })
    await usuario.click(boton)

    // Un doble click en una conexion lenta crea dos grupos iguales, y despues
    // hay que explicarle a cuatro personas en cual cargan los gastos.
    await waitFor(() => expect(boton).toBeDisabled())
    responder({ estado: 201, cuerpo: { group: GRUPO_COSTA } })
  })
})

describe('grupos | la cascara', () => {
  test('el nombre de quien entro y el boton de salir viven arriba de todo', async () => {
    conSesion({ estado: 200, cuerpo: { groups: [GRUPO_COSTA] } })

    montar(<App />, { ruta: '/' })

    const encabezado = await screen.findByRole('banner')
    expect(within(encabezado).getByRole('heading', { name: /hola, ana/i })).toBeInTheDocument()
    expect(within(encabezado).getByRole('button', { name: /cerrar sesión/i })).toBeInTheDocument()
  })
})
