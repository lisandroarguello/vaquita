import type { HttpContext } from '@adonisjs/core/http'
import { pagoIdenticoDe, registrarPago } from '#repositories/pago_repository'
import type { Pago } from '#repositories/pago_repository'
import { cargarGrupo, integrantesDe } from '#repositories/grupo_repository'
import type { IntegranteDetallado } from '#repositories/grupo_repository'
import { registrarPagoValidator } from '#validators/pago_validator'
import {
  errorDe,
  errorDeCampo,
  errorDeRol,
  errorDeValidacion,
  grupoCerrado,
} from '#controllers/respuestas'

/**
 * API-7 — marcar una transferencia como hecha.
 *
 * **Vaquita no mueve plata.** Esta fila dice que la plata se movio afuera, por
 * transferencia bancaria o en mano, y lo unico que hace el endpoint es creerle a
 * quien lo afirma y recalcular los saldos con ese dato. De ahi sale todo lo
 * demas: si el registro no es confiable, los saldos tampoco, y el plan de cierre
 * deja de ser instrucciones y pasa a ser una sugerencia.
 *
 * Por eso **no cualquiera puede registrar un pago**: solo el pagador, el
 * cobrador o un administrador. Los dos primeros porque son los unicos que lo
 * vieron; el administrador porque alguien tiene que poder corregir el grupo
 * cuando uno de los dos no vuelve a abrir la aplicacion. Un cuarto integrante
 * registrando plata ajena mueve el saldo de dos personas que no le pidieron
 * nada, y eso es 403 —no 404— porque quien pide ya es integrante y ya sabe que
 * el grupo existe.
 *
 * Los status, igual que en API-4:
 *
 * - **400** la forma esta mal (lo dice el validador).
 * - **403** la forma esta bien y quien pide no es parte ni administrador.
 * - **409** el grupo esta cerrado.
 * - **422** la forma esta bien y el pago es imposible: contra uno mismo, o
 *   contra alguien que no es integrante activo de **este** grupo. El `field`
 *   dice cual de los dos extremos falla.
 *
 * Cuelga del grupo de rutas `/groups/:id`, asi que la sesion y la pertenencia ya
 * estan garantizadas (API-8) y `ctx.membresia` viene resuelta.
 */
export default class PaymentsController {
  /** `POST /api/v1/groups/:id/payments` */
  async store({ params, request, response, membresia }: HttpContext) {
    const grupo = await cargarGrupo(params.id)
    if (grupo === null) return response.notFound(errorDe('El grupo no existe'))
    if (grupo.estado === 'closed') return response.conflict(grupoCerrado())

    let datos: Awaited<ReturnType<typeof registrarPagoValidator.validate>>
    try {
      datos = await registrarPagoValidator.validate(request.all())
    } catch (error) {
      return response.badRequest(errorDeValidacion(error))
    }

    /**
     * El permiso se revisa **antes** de las referencias, y el orden esta medido:
     * invertirlo no rompia ningun test.
     *
     * Lo que cambia es que quien no tiene permiso recibiria 422 cuando ademas
     * manda un id invalido, y 403 cuando los manda bien. No es una fuga —
     * `GET /groups/:id` ya le da a cualquier integrante la lista completa de
     * membresias con sus ids, y una membresia de otro grupo contesta lo mismo
     * que un uuid inventado— pero si es una respuesta que depende de algo que no
     * deberia importar: a quien no puede hacer la operacion se le contesta eso,
     * y no se le corrige el formulario. De paso, un pedido sin permiso no gasta
     * una consulta. El test "a quien no puede, no se le corrige el cuerpo" fija
     * el orden, que sin el quedaba a merced del proximo que reordene.
     */
    if (!puedeRegistrar(datos, membresia)) {
      return response.forbidden(
        errorDeRol('Solo el pagador, el cobrador o un administrador pueden registrar el pago')
      )
    }

    if (datos.from_membership_id === datos.to_membership_id) {
      return response.unprocessableEntity(
        errorDeCampo(
          'to_membership_id',
          'same_membership',
          'Un pago de alguien a si mismo no cierra nada'
        )
      )
    }

    const integrantes = await integrantesDe(params.id)
    const referencias = revisarExtremos(datos, integrantes)
    if (referencias !== null) return response.unprocessableEntity(referencias)

    /**
     * El pago repetido, que es el riesgo real de este endpoint: un doble click
     * sobre "ya transferi" cobra dos veces y deja a alguien con saldo a favor
     * que nadie le debe. La seccion 7 del Readme ya promete `409` para "marcar
     * dos veces la misma transferencia".
     *
     * No va como `UNIQUE` en la base porque dos pagos identicos son legitimos:
     * la misma persona le paga a la misma otra el mismo monto por dos deudas
     * distintas. La diferencia no esta en los datos sino en si quien manda el
     * segundo pedido sabia del primero, y eso solo se puede preguntar aca. La
     * respuesta trae el id del pago que ya existe, para que el cliente pueda
     * mostrarlo antes de insistir con `allow_duplicate`.
     */
    if (datos.allow_duplicate !== true) {
      const repetido = await pagoIdenticoDe(
        params.id,
        datos.from_membership_id,
        datos.to_membership_id,
        datos.amount_cents
      )
      if (repetido !== null) {
        return response.conflict({
          errors: [
            {
              rule: 'duplicate_payment',
              message:
                'Ya hay un pago igual registrado. Si es otro pago distinto, repetilo con allow_duplicate',
            },
          ],
          existing_payment: publico(repetido),
        })
      }
    }

    const pago = await registrarPago({
      grupoId: params.id,
      deMembresia: datos.from_membership_id,
      paraMembresia: datos.to_membership_id,
      cents: datos.amount_cents,
      confirmadoPor: membresia.id,
    })

    return response.created({ payment: publico(pago) })
  }
}

interface Extremos {
  from_membership_id: string
  to_membership_id: string
}

/** El pagador, el cobrador, o un administrador del grupo. */
function puedeRegistrar(extremos: Extremos, membresia: { id: string; rol: string }): boolean {
  return (
    membresia.rol === 'admin' ||
    membresia.id === extremos.from_membership_id ||
    membresia.id === extremos.to_membership_id
  )
}

/**
 * Los dos extremos tienen que ser integrantes **activos de este grupo**.
 *
 * Sin esta revision la base lo rechaza igual —las FK compuestas
 * `(membresia, grupo)` de DAT-1 existen justamente para eso— pero llega como un
 * 500, que le dice al cliente "se rompio algo" cuando lo que paso es que mando
 * un id que no corresponde. La restriccion es la red; esto es la respuesta.
 *
 * Y el inactivo tambien queda afuera: quien ya no esta en el grupo conserva sus
 * gastos viejos, que son historia, pero no participa de movimientos nuevos.
 */
function revisarExtremos(extremos: Extremos, integrantes: IntegranteDetallado[]) {
  const activos = new Set(integrantes.filter((i) => i.activo).map((i) => i.id))

  for (const campo of ['from_membership_id', 'to_membership_id'] as const) {
    if (!activos.has(extremos[campo])) {
      return errorDeCampo(
        campo,
        'unknown_membership',
        'Ese integrante no es parte activa de este grupo'
      )
    }
  }

  return null
}

function publico(pago: Pago) {
  return {
    id: pago.id,
    from_membership_id: pago.deMembresia,
    to_membership_id: pago.paraMembresia,
    amount_cents: pago.cents,
    confirmed_at: pago.confirmadoEn,
    confirmed_by: pago.confirmadoPor,
  }
}
