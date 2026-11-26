import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

/**
 * Cada caso arranca de cero: sin DOM del anterior, sin token guardado y sin
 * `fetch` trucado.
 *
 * `localStorage` sobrevive entre casos dentro del mismo archivo —es el mismo
 * jsdom— y un token olvidado ahi hace que el test siguiente arranque con sesion
 * sin pedirla. Es la clase de contaminacion que pone verde a un test que no
 * probo lo que dice.
 */
beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
