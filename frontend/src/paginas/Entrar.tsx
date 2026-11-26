import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ErrorApi } from '../api/cliente'
import { useSesion } from '../auth/sesion'

interface EstadoDeRuta {
  volverA?: string
}

/** FE-1 — inicio de sesion. */
export function Entrar() {
  const { estado, entrar } = useSesion()
  const navegar = useNavigate()
  const ubicacion = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  // Quien ya tiene sesion no tiene nada que hacer en el login.
  if (estado === 'autenticado') return <Navigate to="/" replace />

  const volverA = (ubicacion.state as EstadoDeRuta | null)?.volverA ?? '/'

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault()
    setError(null)
    setEnviando(true)
    try {
      await entrar(email, password)
      navegar(volverA, { replace: true })
    } catch (e) {
      /**
       * Un solo mensaje, y **no** pegado a ningun campo.
       *
       * El backend contesta el mismo 401 sin `field` para un mail que no existe
       * y para una contraseña equivocada, a proposito: cualquier diferencia
       * convierte este formulario en un oraculo de quien tiene cuenta. Marcar
       * aca "revisá el mail" o "revisá la contraseña" desarma esa decision del
       * lado del cliente, que es donde se ve.
       */
      setError(
        e instanceof ErrorApi && e.esSesionInvalida
          ? 'Mail o contraseña incorrectos'
          : 'No pudimos entrar. Probá de nuevo en un momento.'
      )
    } finally {
      setEnviando(false)
    }
  }

  return (
    <main>
      <h1>Entrar a Vaquita</h1>
      <form onSubmit={enviar} noValidate>
        <label htmlFor="email">Mail</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label htmlFor="password">Contraseña</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error !== null && <p role="alert">{error}</p>}

        <button type="submit" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
      <p>
        ¿No tenés cuenta? <Link to="/registro">Creá una</Link>
      </p>
    </main>
  )
}
