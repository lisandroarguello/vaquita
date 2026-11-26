import { Navigate, Route, Routes } from 'react-router-dom'
import { ProveedorDeSesion } from './auth/sesion'
import { RutaProtegida } from './rutas/RutaProtegida'
import { Cascara } from './rutas/Cascara'
import { Entrar } from './paginas/Entrar'
import { Registro } from './paginas/Registro'
import { Grupos } from './paginas/Grupos'
import { Grupo } from './paginas/Grupo'

/**
 * El arbol de rutas.
 *
 * `App` **no** trae el router ni el cliente de TanStack Query: los recibe de
 * afuera (`main.tsx` en el navegador, el helper de los tests en las pruebas).
 * Asi un test puede montar la aplicacion entera en la ruta que quiera, sin
 * tocar el historial del navegador ni compartir cache entre casos.
 *
 * Todo lo que necesita sesion va adentro del `<RutaProtegida>`, y adentro de la
 * `<Cascara>` que trae el encabezado: una pantalla nueva queda protegida y con
 * boton de salir por construccion, sin que nadie se acuerde de ponerselo.
 */
export function App() {
  return (
    <ProveedorDeSesion>
      <Routes>
        <Route path="/entrar" element={<Entrar />} />
        <Route path="/registro" element={<Registro />} />

        <Route element={<RutaProtegida />}>
          <Route element={<Cascara />}>
            <Route path="/" element={<Grupos />} />
            <Route path="/grupos/:id" element={<Grupo />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ProveedorDeSesion>
  )
}
