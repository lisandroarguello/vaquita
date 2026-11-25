import { defineConfig } from '@adonisjs/auth'
import { tokensGuard, tokensUserProvider } from '@adonisjs/auth/access_tokens'
import type { InferAuthenticators, InferAuthEvents, Authenticators } from '@adonisjs/auth/types'

/**
 * Autenticacion por **tokens de acceso**, no por sesion.
 *
 * El motivo no es preferencia:
 *
 * - No hay `@adonisjs/session` instalado, y el guard de sesion lo exige. Traerlo
 *   arrastra cookies, CSRF y politica de `sameSite` para un frontend que en
 *   desarrollo vive en otro puerto.
 * - `config/cors.ts` esta con `origin: true`. Con cookies y credenciales eso es
 *   inseguro y habria que acotarlo; con un bearer token el CORS actual alcanza.
 * - Los tests funcionales autentican con un header y no tienen que manejar un
 *   frasco de cookies.
 * - El ticket API-1 pide tokens con expiracion. El guard de sesion no da eso.
 */
const authConfig = defineConfig({
  default: 'api',
  guards: {
    api: tokensGuard({
      provider: tokensUserProvider({
        tokens: 'accessTokens',
        model: () => import('#models/user'),
      }),
    }),
  },
})

export default authConfig

declare module '@adonisjs/auth/types' {
  export interface Authenticators extends InferAuthenticators<typeof authConfig> {}
}
declare module '@adonisjs/core/types' {
  interface EventsList extends InferAuthEvents<Authenticators> {}
}
