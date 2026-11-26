import { Outlet, useNavigate } from 'react-router-dom'
import { useSesion } from '../auth/sesion'

/**
 * La cascara de lo que esta adentro de la sesion: quien entro y como salir.
 *
 * Vive una sola vez, envolviendo las rutas protegidas, y no repetida en cada
 * pantalla. El boton de salir tiene que estar desde el primer dia en todas:
 * un token que no se puede revocar desde la interfaz dura 30 dias.
 */
export function Cascara() {
  const { usuario, salir } = useSesion()
  const navegar = useNavigate()

  async function cerrarSesion() {
    await salir()
    navegar('/entrar', { replace: true })
  }

  return (
    <>
      <header>
        <h1>Hola, {usuario?.display_name}</h1>
        <button type="button" onClick={cerrarSesion}>
          Cerrar sesión
        </button>
      </header>
      <Outlet />
    </>
  )
}
