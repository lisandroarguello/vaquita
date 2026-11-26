import type { HttpContext } from '@adonisjs/core/http'
import { calcularSaldos } from '#domain/saldos'
import { LIMITE_EXACTO, minimizarExacto, minimizarGreedy } from '#domain/minimizador'
import type { Transferencia } from '#domain/minimizador'
import { verificarPlan } from '#domain/verificador_plan'
import { cargarGrupo } from '#repositories/grupo_repository'
import type { GrupoCargado } from '#repositories/grupo_repository'

/**
 * Las dos respuestas que definen el producto: el saldo de cada integrante y el
 * plan minimo de transferencias que lo cierra.
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

/** La forma unica de error de la seccion 7: `field` ausente es del recurso entero. */
function errorDe(message: string) {
  return { errors: [{ message }] }
}

/**
 * Una invariante rota del dominio se reporta con su mensaje, que ya dice cuanto
 * falta o sobra en pesos. Tragarse el detalle manda a alguien a buscar a ciegas.
 */
function errorDeInvariante(error: unknown) {
  return {
    errors: [
      {
        rule: 'invariant_violated',
        message: error instanceof Error ? error.message : String(error),
      },
    ],
  }
}
