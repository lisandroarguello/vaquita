import type { HttpContext } from '@adonisjs/core/http'
import { calcularSaldos } from '#domain/saldos'
import { LIMITE_EXACTO, minimizarExacto, minimizarGreedy } from '#domain/minimizador'
import type { Transferencia } from '#domain/minimizador'
import { verificarPlan } from '#domain/verificador_plan'
import {
  actualizarGrupo,
  cargarGrupo,
  crearGrupoConMembresia,
  gruposDe,
  integrantesDe,
} from '#repositories/grupo_repository'
import type { GrupoCargado } from '#repositories/grupo_repository'
import { actualizarGrupoValidator, crearGrupoValidator } from '#validators/grupo_validator'
import { errorDe, errorDeInvariante, errorDeRol, errorDeValidacion } from '#controllers/respuestas'

/**
 * Los grupos: alta, listado, detalle, renombrar y cerrar (API-2), mas las dos
 * respuestas que definen el producto, el saldo de cada integrante y el plan
 * minimo de transferencias que lo cierra (API-5 y API-6).
 *
 * El formato es el que fija la seccion 7 del Readme, incluido el sufijo
 * `_cents` en todos los montos. Viajan **siempre en centavos enteros** para que
 * ningun cliente los interprete como decimales por accidente.
 *
 * Las dos rutas cuelgan del grupo `/groups/:id`, protegido por
 * `middleware.auth()` + `middleware.miembro()` (API-8). Cuando el controlador
 * corre, ya es seguro que hay sesion y que quien pregunta es integrante activo:
 * `ctx.membresia` lo trae resuelto y no se vuelve a consultar.
 *
 * El `grupo === null` de abajo es, por eso, inalcanzable por HTTP —el middleware
 * ya respondio 404— y se queda igual: el mensaje tiene que ser **el mismo** que
 * el del middleware, porque un grupo ajeno y un grupo inexistente no pueden
 * diferir en una coma.
 */
export default class GroupsController {
  /**
   * `GET /api/v1/groups` — los grupos de la sesion, con el saldo propio en cada
   * uno.
   *
   * El saldo se calcula con `calcularSaldos` del dominio, una vez por grupo, y
   * **no** con una suma en SQL. Una consulta agregada seria una segunda
   * implementacion de los saldos: el dia que las dos no coincidan, el listado y
   * el detalle del mismo grupo van a mostrar numeros distintos y ninguno de los
   * dos va a estar claramente mal. El costo es lineal en la cantidad de grupos
   * **de una persona**, que en este producto es un numero de un digito; si
   * alguna vez deja de serlo, lo que corresponde es cachear el saldo, no
   * recalcularlo de otra manera.
   */
  async index({ auth, response }: HttpContext) {
    const grupos = await gruposDe(auth.user!.id)

    const salida = []
    for (const grupo of grupos) {
      const cargado = await cargarGrupo(grupo.id)
      // Entre `gruposDe` y esto el grupo pudo haber desaparecido. Saltearlo es
      // mejor que un 500 por un grupo que ya no es asunto de nadie.
      if (cargado === null) continue

      let saldoPropio = 0
      try {
        const saldos = calcularSaldos(
          cargado.integrantes.map((i) => i.id),
          cargado.gastos,
          cargado.pagos
        )
        saldoPropio = saldos.find((s) => s.integrante === grupo.membresiaId)?.monto.cents ?? 0
      } catch (error) {
        return response.internalServerError(errorDeInvariante(error))
      }

      salida.push({
        id: grupo.id,
        name: grupo.nombre,
        currency: grupo.moneda,
        status: grupo.estado,
        my_membership_id: grupo.membresiaId,
        my_role: grupo.rol,
        my_balance_cents: saldoPropio,
        member_count: grupo.integrantes,
      })
    }

    return { groups: salida }
  }

  /**
   * `POST /api/v1/groups` — crea un grupo y mete adentro a quien lo creo, como
   * administrador.
   *
   * No hay forma de crear un grupo del que no seas parte: la membresia es la
   * unidad de autorizacion, asi que un grupo sin ella le da 404 a su propio
   * creador (API-8) y queda inalcanzable para siempre. Por eso las dos
   * escrituras van en una transaccion, en el repositorio.
   */
  async store({ request, response, auth }: HttpContext) {
    let datos: { name: string; currency?: string }
    try {
      datos = await crearGrupoValidator.validate(request.all())
    } catch (error) {
      return response.badRequest(errorDeValidacion(error))
    }

    const { grupo, membresia } = await crearGrupoConMembresia({
      nombre: datos.name,
      moneda: datos.currency ?? 'ARS',
      creadorId: auth.user!.id,
    })

    return response.created({
      group: {
        id: grupo.id,
        name: grupo.nombre,
        currency: grupo.moneda,
        status: grupo.estado,
        my_membership_id: membresia.id,
        my_role: membresia.rol,
      },
    })
  }

  /**
   * `GET /api/v1/groups/:id` — detalle: integrantes, estado y totales.
   *
   * Los integrantes vienen **todos**, activos e inactivos, con su bandera: para
   * leer el historial de gastos hace falta poder poner un nombre a cada
   * `membership_id`, y el de alguien que ya no esta tambien figura ahi.
   */
  async show({ params, response, membresia }: HttpContext) {
    const grupo = await cargarGrupo(params.id)
    if (grupo === null) return response.notFound(errorDe('El grupo no existe'))

    const integrantes = await integrantesDe(params.id)
    const gastosActivos = grupo.gastos.filter((g) => !g.anulado)

    return {
      group: {
        id: grupo.id,
        name: grupo.nombre,
        currency: grupo.moneda,
        status: grupo.estado,
        my_membership_id: membresia.id,
        my_role: membresia.rol,
      },
      members: integrantes.map((i) => ({
        id: i.id,
        display_name: i.nombre,
        role: i.rol,
        payout_alias: i.alias,
        active: i.activo,
      })),
      totals: {
        // Los anulados no suman: siguen en el historial y no mueven un centavo.
        expense_count: gastosActivos.length,
        expense_total_cents: gastosActivos.reduce((acc, g) => acc + g.total.cents, 0),
        payment_count: grupo.pagos.length,
      },
    }
  }

  /**
   * `PATCH /api/v1/groups/:id` — renombrar o cerrar. **Solo administrador.**
   *
   * Falta de rol es 403 y no 404: quien pide ya es integrante, asi que ya sabe
   * que el grupo existe y el 404 no protegeria nada.
   */
  async update({ params, request, response, membresia }: HttpContext) {
    if (membresia.rol !== 'admin') {
      return response.forbidden(errorDeRol('Solo un administrador puede cambiar el grupo'))
    }

    let datos: { name?: string; status?: 'open' | 'closed' }
    try {
      datos = await actualizarGrupoValidator.validate(request.all())
    } catch (error) {
      return response.badRequest(errorDeValidacion(error))
    }

    if (datos.name === undefined && datos.status === undefined) {
      return response.badRequest({
        errors: [{ rule: 'empty_patch', message: 'Hay que mandar al menos un campo para cambiar' }],
      })
    }

    const grupo = await actualizarGrupo(params.id, { nombre: datos.name, estado: datos.status })
    if (grupo === null) return response.notFound(errorDe('El grupo no existe'))

    return {
      group: {
        id: grupo.id,
        name: grupo.nombre,
        currency: grupo.moneda,
        status: grupo.estado,
        my_membership_id: membresia.id,
        my_role: membresia.rol,
      },
    }
  }

  /**
   * `GET /api/v1/groups/:id/balances` — saldo neto por integrante.
   *
   * `sums_to_zero` no es decorativo: es la invariante de DOM-4 expuesta. Si
   * llegara en `false`, el cliente no muestra saldos, muestra un error.
   */
  async balances({ params, response, membresia }: HttpContext) {
    const grupo = await cargarGrupo(params.id)
    if (grupo === null) return response.notFound(errorDe('El grupo no existe'))

    let saldos
    try {
      saldos = calcularSaldos(
        grupo.integrantes.map((i) => i.id),
        grupo.gastos,
        grupo.pagos
      )
    } catch (error) {
      return response.internalServerError(errorDeInvariante(error))
    }

    const nombres = new Map(grupo.integrantes.map((i) => [i.id, i.nombre]))
    const total = saldos.reduce((acc, s) => acc + s.monto.cents, 0)

    return {
      currency: grupo.moneda,
      // Cual de estos saldos es el de quien pregunta. Sale de `ctx.membresia`,
      // que el middleware ya resolvio: sin esto el cliente tendria que cruzar
      // `/me` contra la lista de integrantes para saber cual es su propia fila.
      my_membership_id: membresia.id,
      balances: saldos.map((saldo) => ({
        membership_id: saldo.integrante,
        display_name: nombres.get(saldo.integrante) ?? saldo.integrante,
        balance_cents: saldo.monto.cents,
      })),
      sums_to_zero: total === 0,
    }
  }

  /**
   * `GET /api/v1/groups/:id/settlement` — el plan minimo de transferencias.
   *
   * Aca es donde `verificarPlan` deja de ser un modulo que nadie llama: el plan
   * se verifica **antes** de mostrarlo. Si una invariante no se cumple, la
   * respuesta es `500` con el detalle y **sin plan**, nunca un plan a medias —
   * son instrucciones para mover plata de verdad.
   */
  async settlement({ params, response }: HttpContext) {
    const grupo = await cargarGrupo(params.id)
    if (grupo === null) return response.notFound(errorDe('El grupo no existe'))

    let saldos
    let plan: Transferencia[]
    try {
      saldos = calcularSaldos(
        grupo.integrantes.map((i) => i.id),
        grupo.gastos,
        grupo.pagos
      )
      plan = minimizar(saldos)
    } catch (error) {
      return response.internalServerError(errorDeInvariante(error))
    }

    const verificacion = verificarPlan(saldos, plan)
    if (!verificacion.cierra) {
      return response.internalServerError({
        errors: verificacion.problemas.map((problema) => ({
          rule: 'invariant_violated',
          message: problema,
        })),
      })
    }

    const activos = saldos.filter((s) => !s.monto.isZero()).length

    return {
      currency: grupo.moneda,
      transfers: plan.map((t) => ({
        from: nombreDe(grupo, t.de),
        to: nombreDe(grupo, t.para),
        amount_cents: t.monto.cents,
        payout_alias: aliasDe(grupo, t.para),
      })),
      transfer_count: plan.length,
      // El plan ingenuo: cada integrante con saldo distinto de cero hace una
      // transferencia contra un unico intermediario. Es lo que sale de hacerlo
      // a mano, y es contra lo que se compara el minimo.
      naive_transfer_count: activos,
      verified: true,
    }
  }
}

/**
 * Elige el minimizador segun cuantos saldos no nulos hay.
 *
 * El criterio vive aca, en la capa que llama, y no adentro del dominio: el
 * exacto garantiza el minimo pero cuesta 3^n, y arriba de `LIMITE_EXACTO`
 * conviene un plan bueno en un tiempo razonable antes que el optimo en un
 * tiempo que nadie espera.
 */
function minimizar(saldos: Parameters<typeof minimizarExacto>[0]): Transferencia[] {
  const activos = saldos.filter((s) => !s.monto.isZero()).length
  return activos <= LIMITE_EXACTO ? minimizarExacto(saldos) : minimizarGreedy(saldos)
}

function nombreDe(grupo: GrupoCargado, integrante: string): string {
  return grupo.integrantes.find((i) => i.id === integrante)?.nombre ?? integrante
}

function aliasDe(grupo: GrupoCargado, integrante: string): string | null {
  return grupo.integrantes.find((i) => i.id === integrante)?.alias ?? null
}
