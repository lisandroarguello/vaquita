import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import { crearUsuario, verificarCredenciales } from '#repositories/usuario_repository'
import type { UsuarioPublico } from '#repositories/usuario_repository'
import { loginValidator, registroValidator } from '#validators/auth_validator'
import type { AccessToken } from '@adonisjs/auth/access_tokens'

/**
 * API-1 — registro, inicio de sesion, cierre de sesion y `/me`.
 *
 * El alta y la verificacion de credenciales van por `usuario_repository.ts` con
 * SQL crudo. El modelo Lucid aparece en un solo lugar y para una sola cosa:
 * emitir y revocar tokens, que es lo unico que `@adonisjs/auth` sabe hacer
 * contra un `BaseModel`.
 */
export default class AuthController {
  /**
   * `POST /api/v1/auth/signup` — registro. Devuelve el usuario y un token ya
   * usable: pedirle iniciar sesion inmediatamente despues de registrarse es un
   * paso que no informa nada.
   */
  async signup({ request, response }: HttpContext) {
    let datos: { email: string; password: string; display_name: string }
    try {
      datos = await registroValidator.validate(request.all())
    } catch (error) {
      return response.badRequest(errorDeValidacion(error))
    }

    let usuario: UsuarioPublico
    try {
      usuario = await crearUsuario({
        email: datos.email,
        passwordPlano: datos.password,
        nombre: datos.display_name,
      })
    } catch (error) {
      // El UNIQUE de la base es la unica autoridad sobre "este mail ya esta":
      // consultar antes y despues insertar deja una ventana en la que dos altas
      // simultaneas pasan las dos. Lo que no puede salir de aca es el error de
      // Postgres en crudo, que lleva adentro el nombre del indice y la consulta.
      if (esMailRepetido(error)) {
        return response.conflict({
          errors: [{ field: 'email', rule: 'unique', message: 'Ese mail ya tiene una cuenta' }],
        })
      }
      throw error
    }

    const token = await emitirToken(usuario.id)
    return response.created({ user: publico(usuario), token: tokenPublico(token) })
  }

  /**
   * `POST /api/v1/auth/login`.
   *
   * Un mail inexistente y una contraseña equivocada devuelven **exactamente** la
   * misma respuesta, sin `field`. Senalar el campo que fallo convierte este
   * formulario en un oraculo de quien tiene cuenta.
   */
  async login({ request, response }: HttpContext) {
    let datos: { email: string; password: string }
    try {
      datos = await loginValidator.validate(request.all())
    } catch (error) {
      return response.badRequest(errorDeValidacion(error))
    }

    const usuario = await verificarCredenciales(datos.email, datos.password)
    if (usuario === null) {
      return response.unauthorized({
        errors: [{ rule: 'invalid_credentials', message: 'Mail o contraseña incorrectos' }],
      })
    }

    const token = await emitirToken(usuario.id)
    return response.ok({ user: publico(usuario), token: tokenPublico(token) })
  }

  /**
   * `POST /api/v1/auth/logout` — revoca **el token con el que se llamo**, no
   * todos los del usuario: alguien con el telefono y la computadora abiertos no
   * tiene por que quedar afuera de los dos por salir en uno.
   *
   * Revocar de verdad importa: con 30 dias de expiracion, un logout que solo
   * contesta 200 deja la sesion viva un mes en manos de cualquiera que haya
   * visto el token.
   */
  async logout({ auth, response }: HttpContext) {
    const usuario = auth.user!
    await User.accessTokens.delete(usuario, usuario.currentAccessToken.identifier)
    return response.ok({ revoked: true })
  }

  /**
   * `GET /api/v1/me` — quien es la sesion.
   *
   * El frontend lo llama al arrancar para rehidratar el token guardado: si
   * responde 401, el token guardado ya no sirve y la pantalla va al login sin
   * parpadeo (FE-1).
   */
  async me({ auth }: HttpContext) {
    const usuario = auth.user!
    return {
      user: { id: usuario.id, email: usuario.email, display_name: usuario.displayName },
    }
  }
}

/**
 * Emite el token contra el modelo Lucid, que es el unico que sabe hacerlo.
 *
 * El `find` extra existe porque `DbAccessTokensProvider` necesita una instancia
 * del modelo, no un id. Armar la instancia a mano con `new User()` funciona
 * hasta que una version del provider lea otra propiedad, y el costo de leer una
 * fila por login es irrelevante al lado de los dos scrypt que acaban de correr.
 */
async function emitirToken(usuarioId: string): Promise<AccessToken> {
  const usuario = await User.findOrFail(usuarioId)
  return User.accessTokens.create(usuario)
}

/** Lo que viaja hacia el cliente. El hash no aparece por ningun camino. */
function publico(usuario: UsuarioPublico) {
  return { id: usuario.id, email: usuario.email, display_name: usuario.nombre }
}

/**
 * `release()` entrega el secreto en claro **una sola vez**, y esta es esa vez: la
 * base guarda su hash, asi que si el cliente lo pierde no hay de donde volver a
 * sacarlo.
 */
function tokenPublico(token: AccessToken) {
  return {
    type: 'bearer',
    value: token.value!.release(),
    expires_at: token.expiresAt?.toISOString() ?? null,
  }
}

/** Traduce el error de VineJS a la forma unica del proyecto, con status 400. */
function errorDeValidacion(error: unknown) {
  const mensajes = (error as { messages?: unknown }).messages
  if (Array.isArray(mensajes)) {
    return {
      errors: mensajes.map((m: { field?: string; rule?: string; message: string }) => ({
        field: m.field,
        rule: m.rule,
        message: m.message,
      })),
    }
  }
  throw error
}

/**
 * Reconoce la violacion del UNIQUE de mails y **solo** esa.
 *
 * `23505` es `unique_violation` en Postgres. Sin mirar tambien el nombre de la
 * restriccion, cualquier otro UNIQUE que se agregue a `users` en el futuro
 * saldria como "ese mail ya tiene una cuenta", que es una mentira prolija.
 */
function esMailRepetido(error: unknown): boolean {
  const e = error as { code?: string; constraint?: string }
  return e?.code === '23505' && e?.constraint === 'users_mail_unico'
}
