import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useSesion } from '../auth/sesion'

/**
 * FE-1 — lo que exige sesion.
 *
 * Envuelve rutas enteras y no pantallas sueltas, por el mismo motivo por el que
 * el backend pone `middleware.miembro()` en el grupo de rutas y no en cada
 * accion (API-8): una pantalla nueva queda protegida por construccion, sin que
 * nadie se acuerde de protegerla. Olvidarse el guardia en una pantalla nueva no
 * rompe ningun test —la pantalla funciona, solo que para cualquiera— y es la
 * clase de agujero que nadie encuentra leyendo.
 *
 * Aca no hay rama de "cargando": cuando este componente se dibuja, el gate del
 * proveedor ya contesto. Por eso `anonimo` significa anonimo de verdad y
 * redirigir es correcto.
 */
export function RutaProtegida() {
  const { estado } = useSesion()
  const ubicacion = useLocation()

  if (estado !== 'autenticado') {
    // `replace` y no un push: el historial no debe guardar la pantalla a la que
    // no se pudo entrar, porque el boton de atras volveria a rebotar. Y `state`
    // se lleva a donde queria ir para volver despues de entrar.
    return <Navigate to="/entrar" replace state={{ volverA: ubicacion.pathname }} />
  }

  return <Outlet />
}
