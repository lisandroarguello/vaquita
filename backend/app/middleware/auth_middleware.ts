import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import type { Authenticators } from '@adonisjs/auth/types'

/**
 * Exige un token valido. Sin el, 401 y la peticion no llega al controlador.
 *
 * Responde siempre en JSON con la forma unica de error del proyecto: esta es
 * una API, y redirigir a una pantalla de login —que es lo que hace el stub por
 * omision— devolveria un 302 al que ningun cliente de esta API sabe que hacer.
 */
export default class AuthMiddleware {
  async handle(
    ctx: HttpContext,
    next: NextFn,
    options: { guards?: (keyof Authenticators)[] } = {}
  ) {
    try {
      await ctx.auth.authenticateUsing(options.guards)
    } catch {
      return ctx.response.unauthorized({
        errors: [{ message: 'Hace falta iniciar sesion' }],
      })
    }

    return next()
  }
}
