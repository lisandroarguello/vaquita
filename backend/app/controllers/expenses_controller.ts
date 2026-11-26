import type { HttpContext } from '@adonisjs/core/http'
import { Money } from '#domain/money'
import {
  porcentaje,
  repartirEnPartesIguales,
  repartirPorMontosExactos,
  repartirPorPorcentajes,
} from '#domain/reparto'
import type { Porcentaje } from '#domain/reparto'
import {
  actualizarGasto,
  anularGasto,
  crearGasto,
  gastoPorId,
  gastosDe,
} from '#repositories/gasto_repository'
import type { GastoConReparto, ParteDelGasto } from '#repositories/gasto_repository'
import { cargarGrupo, integrantesDe } from '#repositories/grupo_repository'
import type { IntegranteDetallado } from '#repositories/grupo_repository'
import {
  actualizarGastoValidator,
  crearGastoValidator,
  historialValidator,
} from '#validators/gasto_validator'
import { errorDe, errorDeRol, errorDeValidacion } from '#controllers/respuestas'

/**
 * API-4 — alta, edicion, anulacion e historial de gastos.
 *
 * **El reparto no se calcula aca.** Las tres funciones de
 * `app/domain/reparto.ts` son las unicas que reparten plata en todo el proyecto,
 * y este controlador las llama igual que lo hace el seeder. Si el reparto se
 * hiciera a mano en cualquiera de los dos lados, habria dos implementaciones de
 * la misma invariante y el dia que no coincidan las dos serian plausibles.
 *
 * Lo que si vive aca es la traduccion entre HTTP y el dominio, y los tres status
 * que la hacen util:
 *
 * - **400** la forma esta mal (lo dice el validador).
 * - **422** la forma esta bien y la cuenta no cierra (lo dice el dominio), con
 *   `field` apuntando al renglon que falla cuando se puede saber cual es.
 * - **409** el estado no lo permite: grupo cerrado, gasto ya anulado.
 *
 * Cuelga del grupo de rutas `/groups/:id`, asi que la sesion y la pertenencia ya
 * estan garantizadas (API-8) y `ctx.membresia` viene resuelta.
 */
export default class ExpensesController {
  /** `GET /api/v1/groups/:id/expenses` — el historial, paginado y con anulados. */
  async index({ params, request, response }: HttpContext) {
    let filtros: { page?: number; per_page?: number }
    try {
      filtros = await historialValidator.validate(request.qs())
    } catch (error) {
      return response.badRequest(errorDeValidacion(error))
    }

    const pagina = filtros.page ?? 1
    const porPagina = filtros.per_page ?? 50
    const { gastos, total } = await gastosDe(params.id, { pagina, porPagina })

    return {
      expenses: gastos.map(publico),
      page: pagina,
      per_page: porPagina,
      total,
    }
  }

  /** `POST /api/v1/groups/:id/expenses` — alta con su reparto. */
  async store({ params, request, response, membresia }: HttpContext) {
    const grupo = await cargarGrupo(params.id)
    if (grupo === null) return response.notFound(errorDe('El grupo no existe'))
    if (grupo.estado === 'closed') return response.conflict(grupoCerrado())

    let datos: Awaited<ReturnType<typeof crearGastoValidator.validate>>
    try {
      datos = await crearGastoValidator.validate(request.all())
    } catch (error) {
      return response.badRequest(errorDeValidacion(error))
    }

    const fecha = revisarFecha(datos.incurred_on)
    if (fecha !== null) return response.badRequest(fecha)

    const integrantes = await integrantesDe(params.id)
    const referencias = revisarReferencias(datos.paid_by, datos.shares, integrantes)
    if (referencias !== null) return response.unprocessableEntity(referencias)

    const forma = revisarCamposDelModo(datos.split_mode, datos.shares)
    if (forma !== null) return response.badRequest(forma)

    let armar: (gastoId: string) => ParteDelGasto[]
    try {
      armar = repartidor(datos.split_mode, datos.amount_cents, datos.shares)
    } catch (error) {
      return response.unprocessableEntity(error as object)
    }

    const gasto = await crearGasto(
      {
        grupoId: params.id,
        pagadoPor: datos.paid_by,
        cargadoPor: membresia.id,
        totalCents: datos.amount_cents,
        descripcion: datos.description,
        fecha: datos.incurred_on,
        modo: datos.split_mode,
      },
      armar
    )

    return response.created({ expense: publico(gasto) })
  }

  /**
   * `PATCH /api/v1/groups/:id/expenses/:eid` — edicion; recalcula el reparto.
   *
   * Puede editar **quien lo cargo o un administrador**. No cualquier integrante:
   * un gasto es la version de los hechos de quien lo cargo. Y no solo el
   * administrador: el que se equivoco tiene que poder arreglarlo sin pedir
   * permiso, que es el caso comun.
   */
  async update({ params, request, response, membresia }: HttpContext) {
    const grupo = await cargarGrupo(params.id)
    if (grupo === null) return response.notFound(errorDe('El grupo no existe'))
    if (grupo.estado === 'closed') return response.conflict(grupoCerrado())

    const actual = await gastoPorId(params.id, params.eid)
    // El `:eid` lo escribe el cliente. Si no es de **este** grupo, para esta
    // ruta no existe.
    if (actual === null) return response.notFound(errorDe('Ese gasto no existe'))
    if (actual.estado === 'voided') {
      return response.conflict({
        errors: [{ rule: 'already_voided', message: 'Un gasto anulado no se edita' }],
      })
    }
    if (!puedeTocar(actual, membresia)) {
      return response.forbidden(errorDeRol('Solo quien lo cargo o un administrador puede editarlo'))
    }

    let datos: Awaited<ReturnType<typeof actualizarGastoValidator.validate>>
    try {
      datos = await actualizarGastoValidator.validate(request.all())
    } catch (error) {
      return response.badRequest(errorDeValidacion(error))
    }

    const nada =
      datos.paid_by === undefined &&
      datos.amount_cents === undefined &&
      datos.description === undefined &&
      datos.incurred_on === undefined &&
      datos.split_mode === undefined &&
      datos.shares === undefined
    if (nada) {
      return response.badRequest({
        errors: [{ rule: 'empty_patch', message: 'Hay que mandar al menos un campo para cambiar' }],
      })
    }

    /**
     * El monto, el modo y el reparto van juntos o no van.
     *
     * Recalcular con las partes viejas es imposible en modo `exact` —los montos
     * ya no suman el total nuevo— y en `percentage` habria que adivinar los
     * porcentajes a partir de los centavos. Pedirlo explicito es la unica
     * respuesta que no inventa un reparto.
     */
    const tocaElReparto =
      datos.amount_cents !== undefined ||
      datos.split_mode !== undefined ||
      datos.shares !== undefined
    const repartoCompleto =
      datos.amount_cents !== undefined &&
      datos.split_mode !== undefined &&
      datos.shares !== undefined
    if (tocaElReparto && !repartoCompleto) {
      return response.badRequest({
        errors: [
          {
            rule: 'reparto_incompleto',
            message:
              'Para cambiar el reparto hacen falta los tres: amount_cents, split_mode y shares',
          },
        ],
      })
    }

    if (datos.incurred_on !== undefined) {
      const fecha = revisarFecha(datos.incurred_on)
      if (fecha !== null) return response.badRequest(fecha)
    }

    const integrantes = await integrantesDe(params.id)
    let armar: ((gastoId: string) => ParteDelGasto[]) | undefined

    if (repartoCompleto) {
      const referencias = revisarReferencias(datos.paid_by, datos.shares!, integrantes)
      if (referencias !== null) return response.unprocessableEntity(referencias)

      const forma = revisarCamposDelModo(datos.split_mode!, datos.shares!)
      if (forma !== null) return response.badRequest(forma)

      try {
        armar = repartidor(datos.split_mode!, datos.amount_cents!, datos.shares!)
      } catch (error) {
        return response.unprocessableEntity(error as object)
      }
    } else if (datos.paid_by !== undefined) {
      const referencias = revisarReferencias(datos.paid_by, [], integrantes)
      if (referencias !== null) return response.unprocessableEntity(referencias)
    }

    const gasto = await actualizarGasto(
      params.id,
      params.eid,
      {
        pagadoPor: datos.paid_by,
        totalCents: datos.amount_cents,
        descripcion: datos.description,
        fecha: datos.incurred_on,
        modo: datos.split_mode,
      },
      armar
    )
    if (gasto === null) return response.notFound(errorDe('Ese gasto no existe'))

    return { expense: publico(gasto) }
  }

  /**
   * `DELETE /api/v1/groups/:id/expenses/:eid` — **anula**, no borra.
   *
   * El gasto queda en el historial con su reparto intacto y deja de mover plata.
   * Borrar filas donde la gente discute dinero es una mala idea: la pregunta
   * "y el asado que cargamos?" tiene que tener respuesta.
   */
  async destroy({ params, response, membresia }: HttpContext) {
    const grupo = await cargarGrupo(params.id)
    if (grupo === null) return response.notFound(errorDe('El grupo no existe'))
    if (grupo.estado === 'closed') return response.conflict(grupoCerrado())

    const actual = await gastoPorId(params.id, params.eid)
    if (actual === null) return response.notFound(errorDe('Ese gasto no existe'))
    if (!puedeTocar(actual, membresia)) {
      return response.forbidden(errorDeRol('Solo quien lo cargo o un administrador puede anularlo'))
    }

    const resultado = await anularGasto(params.id, params.eid)
    if (resultado === null) return response.notFound(errorDe('Ese gasto no existe'))
    if (resultado === 'ya_anulado') {
      return response.conflict({
        errors: [{ rule: 'already_voided', message: 'Ese gasto ya estaba anulado' }],
      })
    }

    return { expense: publico(resultado) }
  }
}

/** Quien lo cargo, o un administrador. */
function puedeTocar(gasto: GastoConReparto, membresia: { id: string; rol: string }): boolean {
  return gasto.cargadoPor === membresia.id || membresia.rol === 'admin'
}

function grupoCerrado() {
  return {
    errors: [{ rule: 'group_closed', message: 'El grupo esta cerrado: no acepta cambios' }],
  }
}

/**
 * El calendario, que la expresion del validador no mira.
 *
 * `2026-02-30` tiene la forma correcta y no existe. Se compara contra el texto
 * que devuelve la fecha reconstruida: si no coinciden, el dia se desbordo al mes
 * siguiente, que es exactamente lo que `Date` hace en silencio.
 */
function revisarFecha(texto: string): { errors: unknown[] } | null {
  const [anio, mes, dia] = texto.split('-').map(Number)
  const reconstruida = new Date(Date.UTC(anio, mes - 1, dia))
  if (reconstruida.toISOString().slice(0, 10) === texto) return null

  return {
    errors: [
      { field: 'incurred_on', rule: 'calendario', message: `${texto} no es una fecha que exista` },
    ],
  }
}

type ParteDeEntrada = { membership_id: string; amount_cents?: number; percentage?: string }

/**
 * Que todo lo que la peticion referencia sea un integrante **activo de este
 * grupo**, y que nadie aparezca dos veces.
 *
 * Las dos cosas las atraparia la base, pero mal: la foranea compuesta devuelve
 * un 500 con el nombre de una restriccion adentro, y el UNIQUE lo mismo. Y hay
 * una que el trigger de DAT-2 **no veria**: la misma persona dos veces suma
 * igual que una vez, y lo unico que cambia es su saldo, al doble y en silencio.
 *
 * Es 422 y no 400: la forma del uuid esta bien, lo que no cierra es a quien
 * apunta.
 */
function revisarReferencias(
  pagadoPor: string | undefined,
  partes: ParteDeEntrada[],
  integrantes: IntegranteDetallado[]
): { errors: unknown[] } | null {
  const activos = new Set(integrantes.filter((i) => i.activo).map((i) => i.id))

  if (pagadoPor !== undefined && !activos.has(pagadoPor)) {
    return {
      errors: [
        {
          field: 'paid_by',
          rule: 'not_member',
          message: 'Quien pago tiene que ser integrante activo del grupo',
        },
      ],
    }
  }

  const vistos = new Set<string>()
  for (const [indice, parte] of partes.entries()) {
    if (!activos.has(parte.membership_id)) {
      return {
        errors: [
          {
            field: `shares[${indice}].membership_id`,
            rule: 'not_member',
            message: 'Esa persona no es integrante activo del grupo',
          },
        ],
      }
    }
    if (vistos.has(parte.membership_id)) {
      return {
        errors: [
          {
            field: `shares[${indice}].membership_id`,
            rule: 'duplicate',
            message: 'Esa persona ya aparece en el reparto',
          },
        ],
      }
    }
    vistos.add(parte.membership_id)
  }

  return null
}

/**
 * Que cada modo traiga el campo que necesita. Es forma, asi que 400.
 *
 * `equal` no pide nada mas que quien participa; `exact` pide el monto de cada
 * uno y `percentage` su porcentaje.
 */
function revisarCamposDelModo(
  modo: 'equal' | 'exact' | 'percentage',
  partes: ParteDeEntrada[]
): { errors: unknown[] } | null {
  if (modo === 'equal') return null

  const campo = modo === 'exact' ? 'amount_cents' : 'percentage'
  for (const [indice, parte] of partes.entries()) {
    if (parte[campo as 'amount_cents' | 'percentage'] === undefined) {
      return {
        errors: [
          {
            field: `shares[${indice}].${campo}`,
            rule: 'required',
            message: `En modo ${modo} cada parte lleva su ${campo}`,
          },
        ],
      }
    }
  }
  return null
}

/**
 * Arma el reparto con el dominio, y devuelve una funcion porque el modo `equal`
 * necesita el id del gasto para rotar a quien le toca el centavo que sobra.
 *
 * Lanza un objeto con la forma de error del proyecto —no una excepcion
 * cualquiera— para que el controlador lo devuelva como 422 sin tener que
 * interpretar el mensaje del dominio. El `field` apunta al renglon cuando se
 * sabe cual es: al convertir un porcentaje se sabe; cuando la suma no cierra, el
 * problema es del conjunto y el campo es `shares`.
 */
function repartidor(
  modo: 'equal' | 'exact' | 'percentage',
  totalCents: number,
  partes: ParteDeEntrada[]
): (gastoId: string) => ParteDelGasto[] {
  const total = Money.fromCents(totalCents)

  if (modo === 'exact') {
    const montos = partes.map((p) => Money.fromCents(p.amount_cents!))
    const repartido = conDominio(() => repartirPorMontosExactos(total, montos), 'shares')
    return () => alinear(partes, repartido)
  }

  if (modo === 'percentage') {
    const porcentajes: Porcentaje[] = partes.map((p, indice) =>
      conDominio(() => porcentaje(p.percentage!), `shares[${indice}].percentage`)
    )
    const repartido = conDominio(() => repartirPorPorcentajes(total, porcentajes), 'shares')
    return () => alinear(partes, repartido)
  }

  // `equal`: el reparto depende del id, asi que se calcula recien cuando existe.
  return (gastoId: string) => {
    const repartido = repartirEnPartesIguales(
      total,
      partes.length,
      rotacion(gastoId, partes.length)
    )
    return alinear(partes, repartido)
  }
}

/** Corre algo del dominio y traduce su error a la forma de error del proyecto. */
function conDominio<T>(calcular: () => T, field: string): T {
  try {
    return calcular()
  } catch (error) {
    throw {
      errors: [
        {
          field,
          rule: 'reparto_invalido',
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    }
  }
}

function alinear(partes: ParteDeEntrada[], repartido: Money[]): ParteDelGasto[] {
  return partes.map((parte, indice) => ({
    membresiaId: parte.membership_id,
    cents: repartido[indice].cents,
  }))
}

/**
 * A quien le toca el centavo que sobra, derivado del id del gasto.
 *
 * Si cayera siempre en el primero de la lista, esa persona pagaria de mas en
 * todos los gastos del grupo (es el `desde` de DOM-2). El id sirve porque es
 * estable: el mismo gasto reparte igual siempre, y editarlo no le mueve el
 * centavo a otro.
 */
function rotacion(gastoId: string, cuantos: number): number {
  const hex = gastoId.replace(/-/g, '').slice(-8)
  return Number.parseInt(hex, 16) % cuantos
}

/** La forma que viaja al cliente. Los montos van siempre en centavos enteros. */
function publico(gasto: GastoConReparto) {
  return {
    id: gasto.id,
    paid_by: gasto.pagadoPor,
    created_by: gasto.cargadoPor,
    amount_cents: gasto.totalCents,
    description: gasto.descripcion,
    incurred_on: gasto.fecha,
    split_mode: gasto.modo,
    status: gasto.estado,
    source: gasto.origen,
    shares: gasto.partes.map((p) => ({
      membership_id: p.membresiaId,
      display_name: p.nombre,
      share_cents: p.cents,
    })),
  }
}
