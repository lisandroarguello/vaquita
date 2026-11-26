import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ErrorApi, pedir } from '../api/cliente'
import { guardarToken, olvidarToken, rehidratarToken } from './token'

export interface Usuario {
  id: string
  email: string
  display_name: string
}

interface RespuestaDeSesion {
  user: Usuario
  token: { type: string; value: string; expires_at: string | null }
}

export interface Sesion {
  /**
   * `cargando` existe para que nadie tenga que adivinar entre "no hay sesion" y
   * "todavia no se sabe". Son los dos estados que un booleano confunde, y
   * confundirlos es exactamente el parpadeo de FE-1: la pantalla de login
   * aparece medio segundo y despues se va sola.
   */
  estado: 'cargando' | 'anonimo' | 'autenticado'
  usuario: Usuario | null
  entrar: (email: string, password: string) => Promise<void>
  registrarse: (email: string, password: string, display_name: string) => Promise<void>
  salir: () => Promise<void>
}

const Contexto = createContext<Sesion | null>(null)

export function useSesion(): Sesion {
  const sesion = useContext(Contexto)
  if (sesion === null) throw new Error('useSesion fuera de <ProveedorDeSesion>')
  return sesion
}

/**
 * FE-1 — el arranque, sin parpadeo.
 *
 * La secuencia es: traer el token guardado a memoria, preguntarle al backend
 * `GET /me` quien es, y **no dibujar nada de la aplicacion hasta tener la
 * respuesta**. Esa espera es el gate, y es la pieza que resuelve el "sin
 * parpadeo" sin trucos: sin ella, el primer render ocurre con `usuario: null`
 * —que es indistinguible de "no hay sesion"— la ruta protegida redirige al
 * login, y cuando `/me` contesta 200 la navegacion se deshace sola. El usuario
 * ve su login por un instante cada vez que recarga.
 *
 * Con esto el precio es una pantalla de carga al abrir, y solo cuando hay un
 * token guardado: sin token no hay nada que preguntar y se va derecho al login.
 */
export function ProveedorDeSesion({ children }: { children: ReactNode }) {
  /**
   * El token, como estado de React y no solo como variable del modulo.
   *
   * La rehidratacion es sincrona a proposito —se corre en el inicializador, de
   * modo que el `fetch` de `/me` ya sale firmado—, pero el valor tiene que
   * **cambiar** para que `enabled` cambie con el. Si `enabled` quedara fijo en
   * "habia token al arrancar", cerrar sesion vaciaria la cache y la misma
   * consulta volveria a pedir `/me` enseguida, dejando al usuario adentro o en
   * una pantalla de carga que no termina.
   */
  const [token, setToken] = useState(() => rehidratarToken())
  const clienteDeQuery = useQueryClient()

  const consulta = useQuery({
    queryKey: ['me'],
    queryFn: () => pedir<{ user: Usuario }>('/me'),
    enabled: token !== null,
    // Un token vencido o revocado da 401 y la respuesta correcta es ir al
    // login, no reintentar tres veces antes de dejar entrar.
    retry: false,
    staleTime: Infinity,
  })

  const entrar = useCallback(
    async (email: string, password: string) => {
      const r = await pedir<RespuestaDeSesion>('/auth/login', {
        metodo: 'POST',
        cuerpo: { email, password },
        token: null,
      })
      guardarToken(r.token.value)
      setToken(r.token.value)
      clienteDeQuery.setQueryData(['me'], { user: r.user })
    },
    [clienteDeQuery]
  )

  const registrarse = useCallback(
    async (email: string, password: string, display_name: string) => {
      const r = await pedir<RespuestaDeSesion>('/auth/signup', {
        metodo: 'POST',
        cuerpo: { email, password, display_name },
        token: null,
      })
      // El registro ya devuelve token usable (API-1): mandar al login despues
      // de registrarse es un paso que no informa nada.
      guardarToken(r.token.value)
      setToken(r.token.value)
      clienteDeQuery.setQueryData(['me'], { user: r.user })
    },
    [clienteDeQuery]
  )

  const salir = useCallback(async () => {
    try {
      await pedir('/auth/logout', { metodo: 'POST' })
    } catch {
      // Si el token ya estaba vencido, `logout` da 401 y eso **no** puede
      // impedir salir: el usuario pidio cerrar la sesion y lo local se limpia
      // igual. Lo que no se hace es saltearse el pedido: sin el, el token sigue
      // valido 30 dias en manos de cualquiera que lo haya visto.
    }
    olvidarToken()
    setToken(null)
    // Borra la cache entera, no solo `['me']`: ahi quedan los grupos y los
    // saldos de quien se fue, y el proximo que entre en esta pestaña los veria
    // mientras se recargan.
    clienteDeQuery.clear()
  }, [clienteDeQuery])

  /**
   * Un token guardado que ya no sirve se saca.
   *
   * Dejarlo puesto hace que cada pedido siguiente vuelva a salir firmado con un
   * token muerto y que la proxima recarga repita el mismo viaje inutil antes de
   * caer al login.
   */
  useEffect(() => {
    if (consulta.error instanceof ErrorApi && consulta.error.esSesionInvalida) {
      olvidarToken()
      setToken(null)
    }
  }, [consulta.error])

  const valor = useMemo<Sesion>(() => {
    // `isLoading` y no `isPending`: con `enabled: false` —el caso de arrancar
    // sin token guardado— `isPending` tambien es `true`, y eso dejaria la
    // pantalla de carga puesta para siempre en vez de ir al login.
    const estado: Sesion['estado'] = consulta.data
      ? 'autenticado'
      : consulta.isLoading
        ? 'cargando'
        : 'anonimo'

    return {
      estado,
      usuario: consulta.data?.user ?? null,
      entrar,
      registrarse,
      salir,
    }
  }, [consulta.data, consulta.isLoading, entrar, registrarse, salir])

  // El gate. Lo que sigue a este `if` solo se dibuja con la pregunta ya
  // contestada, en cualquiera de los dos sentidos.
  if (valor.estado === 'cargando') {
    return (
      <p role="status" aria-live="polite">
        Cargando tu sesion…
      </p>
    )
  }

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}
