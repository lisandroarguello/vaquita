import { useNavigate } from 'react-router-dom'
import { useSesion } from '../auth/sesion'

/**
 * Pantalla de adentro, por ahora un marcador.
 *
 * Lo que va a ir aca es la lista de grupos (FE-2). Existe en esta sesion porque
 * las rutas protegidas necesitan algo que proteger, y porque el boton de salir
 * tiene que vivir en algun lado desde el primer dia: un token que no se puede
 * revocar desde la interfaz dura 30 dias.
 */
export function Inicio() {
  const { usuario, salir } = useSesion()
  const navegar = useNavigate()

  async function cerrarSesion() {
    await salir()
    navegar('/entrar', { replace: true })
  }

  return (
    <main>
      <h1>Hola, {usuario?.display_name}</h1>
      <p>Tus grupos van a aparecer acá.</p>
      <button type="button" onClick={cerrarSesion}>
        Cerrar sesión
      </button>
    </main>
  )
}
