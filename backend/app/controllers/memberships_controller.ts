import type { HttpContext } from '@adonisjs/core/http'
import {
  actualizarMembresia,
  agregarIntegrante,
  membresiaPorId,
  otrosAdminsActivos,
} from '#repositories/grupo_repository'
import { buscarPorMail } from '#repositories/usuario_repository'
import {
  actualizarMembresiaValidator,
  agregarIntegranteValidator,
} from '#validators/grupo_validator'
import { errorDe, errorDeCampo, errorDeRol, errorDeValidacion } from '#controllers/respuestas'

/**
 * Las membresias de un grupo (API-2): quien esta adentro, con que rol y a que
 * alias cobra.
 *
 * Cuelga del grupo de rutas `/groups/:id`, asi que cuando algo de aca corre ya
 * esta garantizado que hay sesion y que quien pide es integrante **activo**
 * (API-8), con su membresia en `ctx.membresia`. Lo que se decide en este archivo
 * es la capa de arriba: que puede hacer un integrante y que solo un
 * administrador.
 *
 * **Todas las negativas de este archivo son 403, no 404.** Quien llega hasta
 * aca ya sabe que el grupo existe, porque es parte. El 404 esta reservado para
 * lo que no se puede confirmar sin filtrar algo: el grupo en si (API-8) y un
 * `:mid` que no pertenece a este grupo.
 */
export default class MembershipsController {
  /**
   * `POST /api/v1/groups/:id/members` — suma a alguien por mail. **Solo
   * administrador.**
   *
   * Hasta que exista API-3 (invitaciones por token), agregar exige que la
   * persona ya tenga cuenta, y por eso un mail sin cuenta devuelve 404.
   *
   * **Eso filtra si un mail tiene cuenta, y es deliberado.** No es el oraculo
   * que el login evita: aca hace falta una sesion valida *y* ser administrador
   * de un grupo, asi que no es "cualquiera enumera la base" sino "un
   * administrador consulta un mail por vez". La alternativa —contestar 201 sin
   * agregar a nadie— le mentiria al administrador sobre quien esta en el grupo,
   * que es peor. API-3 lo resuelve de verdad: con una invitacion por token no
   * hace falta saber nada del otro lado.
   */
  async store({ params, request, response, membresia }: HttpContext) {
    if (membresia.rol !== 'admin') {
      return response.forbidden(errorDeRol('Solo un administrador puede agregar integrantes'))
    }

    let datos: { email: string }
    try {
      datos = await agregarIntegranteValidator.validate(request.all())
    } catch (error) {
      return response.badRequest(errorDeValidacion(error))
    }

    const usuario = await buscarPorMail(datos.email)
    if (usuario === null) {
      return response.notFound(
        errorDeCampo('email', 'not_found', 'No hay ninguna cuenta con ese mail')
      )
    }

    const resultado = await agregarIntegrante({ grupoId: params.id, usuarioId: usuario.id })
    if (resultado === 'ya_estaba') {
      return response.conflict(
        errorDeCampo('email', 'already_member', 'Esa persona ya esta en el grupo')
      )
    }

    const cuerpo = { member: publica(resultado.membresia) }
    // Reactivar no es un alta: el `membership_id` es el de antes y el historial
    // de esa persona sigue colgado de el. Un 201 diria que se creo algo nuevo.
    return resultado.reactivado ? response.ok(cuerpo) : response.created(cuerpo)
  }

  /**
   * `PATCH /api/v1/groups/:id/members/:mid` — alias de cobro, rol, activo.
   *
   * **El alias propio no necesita ser administrador.** Es donde a esa persona le
   * entra la plata: obligarla a pedirselo a un administrador termina en un plan
   * de cierre con `payout_alias: null`, que es una instruccion de pago que no se
   * puede ejecutar. Rol y estado, en cambio, son administracion del grupo.
   */
  async update({ params, request, response, membresia }: HttpContext) {
    const objetivo = await membresiaPorId(params.id, params.mid)
    // El `:mid` lo escribe el cliente. Si no es de **este** grupo, para esta
    // ruta no existe: devolver 403 confirmaria que existe en otro lado.
    if (objetivo === null) return response.notFound(errorDe('Esa membresia no existe'))

    let datos: { payout_alias?: string | null; role?: 'admin' | 'member'; active?: boolean }
    try {
      datos = await actualizarMembresiaValidator.validate(request.all())
    } catch (error) {
      return response.badRequest(errorDeValidacion(error))
    }

    const cambiaAliasNadaMas =
      datos.role === undefined && datos.active === undefined && datos.payout_alias !== undefined
    const esSuPropiaMembresia = objetivo.id === membresia.id

    if (
      datos.payout_alias === undefined &&
      datos.role === undefined &&
      datos.active === undefined
    ) {
      return response.badRequest({
        errors: [{ rule: 'empty_patch', message: 'Hay que mandar al menos un campo para cambiar' }],
      })
    }

    const puede = membresia.rol === 'admin' || (cambiaAliasNadaMas && esSuPropiaMembresia)
    if (!puede) {
      return response.forbidden(
        errorDeRol('Solo un administrador puede cambiar eso de otra persona')
      )
    }

    /**
     * Un grupo sin administrador activo no se puede administrar nunca mas: nadie
     * agrega, nadie desactiva, nadie cierra. Se cuenta antes de escribir, porque
     * despues ya no hay quien lo arregle.
     */
    const dejaDeAdministrar = datos.role === 'member' || datos.active === false
    if (objetivo.rol === 'admin' && objetivo.activo && dejaDeAdministrar) {
      if ((await otrosAdminsActivos(params.id, objetivo.id)) === 0) {
        return response.conflict({
          errors: [
            {
              rule: 'last_admin',
              message: 'El grupo se quedaria sin administrador: nombra a otro primero',
            },
          ],
        })
      }
    }

    const actualizada = await actualizarMembresia(params.id, params.mid, {
      alias: datos.payout_alias,
      rol: datos.role,
      activo: datos.active,
    })
    if (actualizada === null) return response.notFound(errorDe('Esa membresia no existe'))

    return { member: publica(actualizada) }
  }
}

function publica(membresia: {
  id: string
  nombre: string
  rol: string
  alias: string | null
  activo: boolean
}) {
  return {
    id: membresia.id,
    display_name: membresia.nombre,
    role: membresia.rol,
    payout_alias: membresia.alias,
    active: membresia.activo,
  }
}
