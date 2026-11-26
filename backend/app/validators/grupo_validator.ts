import vine from '@vinejs/vine'

/**
 * Forma de los datos de API-2. El validador valida **forma**; que el grupo
 * exista, que seas administrador o que quede un administrador vivo no es forma y
 * se decide en el controlador.
 */

const nombreDeGrupo = vine.string().trim().minLength(1).maxLength(80)

/**
 * ISO 4217: tres letras mayusculas. El mismo CHECK esta en la base
 * (`groups_moneda_iso`), y esto no lo reemplaza: lo adelanta.
 *
 * Sin esta regla, `currency: 'pesos'` llega hasta Postgres y vuelve como un 500
 * con el nombre de la restriccion adentro. El cliente necesita un 400 que diga
 * `field: "currency"`, no el nombre de un CHECK.
 */
const moneda = vine
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/)

export const crearGrupoValidator = vine.compile(
  vine.object({
    name: nombreDeGrupo,
    // Por omision ARS, que es la moneda del caso de uso que el proyecto
    // describe. El grupo puede elegir otra al crearse y despues no se cambia:
    // los montos ya cargados estan en la moneda vieja.
    currency: moneda.optional(),
  })
)

/**
 * Renombrar o cerrar. Los dos campos son opcionales, pero **no los dos a la
 * vez**: un PATCH sin ningun campo que devuelve 200 le dice al cliente que algo
 * cambio, y no cambio nada.
 */
export const actualizarGrupoValidator = vine.compile(
  vine.object({
    name: nombreDeGrupo.optional(),
    status: vine.enum(['open', 'closed'] as const).optional(),
  })
)

export const agregarIntegranteValidator = vine.compile(
  vine.object({
    email: vine.string().trim().email().maxLength(254),
  })
)

/**
 * `payout_alias` acepta `null` a proposito: es el unico campo que alguien puede
 * querer **borrar**, y sin poder mandar `null` el alias cargado por error no se
 * saca nunca.
 */
export const actualizarMembresiaValidator = vine.compile(
  vine.object({
    payout_alias: vine.string().trim().minLength(1).maxLength(120).nullable().optional(),
    role: vine.enum(['admin', 'member'] as const).optional(),
    active: vine.boolean().optional(),
  })
)
