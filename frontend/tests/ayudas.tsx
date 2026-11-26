import type { ReactNode } from 'react'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi } from 'vitest'

/* ------------------------------------------------------------------ */
/* Un backend de mentira, con los formatos reales                      */
/* ------------------------------------------------------------------ */

export interface Pedido {
  metodo: string
  ruta: string
  cuerpo: unknown
  autorizacion: string | null
}

export interface Respuesta {
  estado: number
  cuerpo?: unknown
}

export type Manejador = Respuesta | ((pedido: Pedido) => Respuesta | Promise<Respuesta>)

/**
 * Reemplaza `fetch` por un mapa de `"METODO /ruta"` a respuesta.
 *
 * Por que un mapa explicito y no un mock que devuelve siempre lo mismo: una
 * ruta que el test no declaro **falla con un mensaje que la nombra**. Si en
 * cambio contestara 200 vacio, un pedido que la aplicacion no deberia hacer
 * —`/me` despues de salir, por ejemplo— pasaria inadvertido y el test se
 * pondria verde por el motivo equivocado.
 *
 * Devuelve el registro de pedidos, que es lo que permite verificar que el token
 * viajo en el header y no solo que la pantalla se dibujo.
 */
export function instalarBackend(manejadores: Record<string, Manejador>): Pedido[] {
  const registro: Pedido[] = []

  vi.stubGlobal('fetch', async (url: string, opciones: RequestInit = {}) => {
    const metodo = (opciones.method ?? 'GET').toUpperCase()
    const ruta = String(url)
    const headers = new Headers(opciones.headers)
    const pedido: Pedido = {
      metodo,
      ruta,
      cuerpo: opciones.body === undefined ? undefined : JSON.parse(String(opciones.body)),
      autorizacion: headers.get('Authorization'),
    }
    registro.push(pedido)

    const clave = `${metodo} ${ruta}`
    const manejador = manejadores[clave]
    if (manejador === undefined) {
      throw new Error(`El test no declaro una respuesta para "${clave}"`)
    }

    const { estado, cuerpo } = typeof manejador === 'function' ? await manejador(pedido) : manejador
    return new Response(cuerpo === undefined ? null : JSON.stringify(cuerpo), {
      status: estado,
      headers: { 'Content-Type': 'application/json' },
    })
  })

  return registro
}

/**
 * Una respuesta que el test resuelve cuando quiere.
 *
 * Es la herramienta del gate de carga: sin poder dejar `/me` colgado no hay
 * forma de mirar lo que la aplicacion dibuja **mientras** no sabe quien es, que
 * es exactamente el instante donde vive el parpadeo de FE-1.
 */
export function respuestaDemorada(): {
  manejador: Manejador
  responder: (respuesta: Respuesta) => void
} {
  let resolver: (respuesta: Respuesta) => void = () => {}
  const promesa = new Promise<Respuesta>((r) => {
    resolver = r
  })
  return { manejador: () => promesa, responder: (respuesta) => resolver(respuesta) }
}

/* ------------------------------------------------------------------ */
/* Montaje                                                             */
/* ------------------------------------------------------------------ */

export const USUARIO = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'ana@vaquita.example',
  display_name: 'Ana',
}

export function respuestaDeSesion(token = 'vaq_token_de_prueba') {
  return { user: USUARIO, token: { type: 'bearer', value: token, expires_at: null } }
}

export function montar(ui: ReactNode, { ruta = '/' }: { ruta?: string } = {}) {
  // Un cliente por caso: la cache de TanStack Query es estado global, y
  // compartirla entre tests deja el `['me']` de uno contestando en el otro.
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[ruta]}>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}
