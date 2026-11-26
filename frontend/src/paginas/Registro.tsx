import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { ErrorApi } from '../api/cliente'
import { useSesion } from '../auth/sesion'

/** El minimo que pide el backend (API-1). Repetirlo aca es para avisar antes. */
const LARGO_MINIMO = 12

/** FE-1 — alta de cuenta. */
export function Registro() {
  const { estado, registrarse } = useSesion()
  const navegar = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [nombre, setNombre] = useState('')
  const [errorDeEmail, setErrorDeEmail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  if (estado === 'autenticado') return <Navigate to="/" replace />

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault()
    setError(null)
    setErrorDeEmail(null)
    setEnviando(true)
    try {
      await registrarse(email, password, nombre)
      navegar('/', { replace: true })
    } catch (e) {
      /**
       * Aca sí se marca el campo, y no es una contradiccion con el login: el
       * backend contesta 409 **con** `field: "email"` porque "ese mail ya tiene
       * cuenta" es algo que quien se registra necesita saber para poder entrar
       * en vez de insistir. El oraculo que el login evita, el registro no puede
       * evitarlo: un alta que no avisara daria 409 para siempre sin decir por
       * que.
       */
      const mensajeDelCampo = e instanceof ErrorApi ? e.mensajeDe('email') : undefined
      if (mensajeDelCampo !== undefined) setErrorDeEmail(mensajeDelCampo)
      else if (e instanceof ErrorApi && e.estado === 400)
        setError(e.errores[0]?.message ?? 'Revisá los datos.')
      else setError('No pudimos crear la cuenta. Probá de nuevo en un momento.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <main>
      <h1>Crear cuenta en Vaquita</h1>
      <form onSubmit={enviar} noValidate>
        <label htmlFor="nombre">Tu nombre</label>
        <input
          id="nombre"
          name="display_name"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
        />

        <label htmlFor="email">Mail</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          aria-invalid={errorDeEmail !== null}
          aria-describedby={errorDeEmail !== null ? 'error-email' : undefined}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {errorDeEmail !== null && (
          <p id="error-email" role="alert">
            {errorDeEmail}
          </p>
        )}

        <label htmlFor="password">Contraseña</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={LARGO_MINIMO}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p id="ayuda-password">Al menos {LARGO_MINIMO} caracteres.</p>

        {error !== null && <p role="alert">{error}</p>}

        <button type="submit" disabled={enviando}>
          {enviando ? 'Creando…' : 'Crear cuenta'}
        </button>
      </form>
      <p>
        ¿Ya tenés cuenta? <Link to="/entrar">Entrá</Link>
      </p>
    </main>
  )
}
