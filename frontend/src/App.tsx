import { Navigate, Route, Routes } from 'react-router-dom'
import { ProveedorDeSesion } from './auth/sesion'
import { RutaProtegida } from './rutas/RutaProtegida'
import { Entrar } from './paginas/Entrar'
import { Registro } from './paginas/Registro'
import { Inicio } from './paginas/Inicio'

/**
 * El arbol de rutas.
 *
 * `App` **no** trae el router ni el cliente de TanStack Query: los recibe de
 * afuera (`main.tsx` en el navegador, el helper de los tests en las pruebas).
 * Asi un test puede montar la aplicacion entera en la ruta que quiera, sin
 * tocar el historial del navegador ni compartir cache entre casos.
 */
export function App() {
  return (
    <ProveedorDeSesion>
      <Routes>
        <Route path="/entrar" element={<Entrar />} />
        <Route path="/registro" element={<Registro />} />

        <Route element={<RutaProtegida />}>
          <Route path="/" element={<Inicio />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ProveedorDeSesion>
  )
}
