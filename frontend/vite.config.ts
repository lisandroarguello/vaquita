// `defineConfig` de `vitest/config` y no de `vite`: es el mismo config de Vite
// mas la clave `test`, que la version de Vite no conoce y rechaza al tipar.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * Un solo servicio para desplegar, cero CORS en produccion.
 *
 * El build no queda en `frontend/dist`: queda en `backend/public`, que es la
 * carpeta que `@adonisjs/static` sirve. En produccion no hay dos origenes, asi
 * que no hay nada que configurar en CORS y el token no viaja entre dominios.
 *
 * En desarrollo sí hay dos procesos (Vite en 5173, Adonis en 3333) y el puente
 * es `server.proxy`: el navegador ve un solo origen igual que en produccion, y
 * `fetch('/api/v1/...')` es el mismo codigo en los dos lados. La alternativa
 * —una variable con la URL del backend— obliga a que el codigo de produccion
 * tenga una rama que solo se ejercita en desarrollo.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../backend/public',
    // Vite se niega a vaciar un directorio fuera de su raiz sin esto, y vaciarlo
    // es lo correcto: un `assets/` con los hashes de un build viejo se acumula
    // para siempre y termina desplegandose junto al nuevo.
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3333',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/preparar.ts'],
    include: ['tests/**/*.spec.tsx', 'tests/**/*.spec.ts'],
  },
})
