import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { membresiaDe } from '#repositories/grupo_repository'
import type { Membresia } from '#repositories/grupo_repository'

/**
 * API-8 — exige ser integrante activo del grupo de la URL.
 *
 * **Responde 404, no 403.** Un 403 confirma que el grupo existe, y con eso
 * cualquiera con una cuenta recorre ids y arma un censo de grupos ajenos sin ver
 * un peso. El 404 vuelve indistinguibles "no existe", "no sos parte" y "te
 * sacaron": los tres salen por aca con el mismo status, el mismo cuerpo y los
 * mismos headers.
 *
 * El mensaje tiene que ser el mismo que usa el controlador para un grupo que no
 * existe. Decir "no sos integrante de este grupo" seria un 404 que filtra
 * exactamente lo que el 404 venia a tapar.
 *
 * Falta de **rol** es otra cosa: ahi 403 es legitimo, porque quien pregunta ya
 * sabe que el grupo existe y que es integrante. Eso no vive aca.
 *
 * Se aplica **al grupo de rutas** `/groups/:id/*` y no a cada accion, para que
 * una ruta nueva quede protegida por construccion: olvidarse el middleware en
 * una ruta nueva es un agujero silencioso, y un grupo de rutas no se olvida.
 */
export default class MiembroMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    // `middleware.auth()` corre antes y garantiza el usuario. Si alguien aplica
    // este middleware sin el, es mejor un 401 que un 500.
    const usuario = ctx.auth.user
    if (usuario === undefined) {
      return ctx.response.unauthorized({ errors: [{ message: 'Hace falta iniciar sesion' }] })
    }

    const membresia = await membresiaDe(ctx.params.id, usuario.id)
    if (membresia === null) {
      return ctx.response.notFound({ errors: [{ message: 'El grupo no existe' }] })
    }

    // Queda en el contexto para que el controlador sepa quien pregunta sin
    // repetir esta misma consulta.
    ctx.membresia = membresia

    return next()
  }
}

// La regla `no-shadow` ve una segunda declaracion de `HttpContext` y no es eso:
// es la interfaz importada, extendida con un campo nuevo.
/* eslint-disable @typescript-eslint/no-shadow */
declare module '@adonisjs/core/http' {
  interface HttpContext {
    /**
     * La membresia de quien pide, resuelta por `MiembroMiddleware`. Esta
     * definida en toda ruta que pase por ese middleware, y solo en esas.
     */
    membresia: Membresia
  }
}
