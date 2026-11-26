import vine from '@vinejs/vine'

/**
 * Forma de los datos de API-4.
 *
 * La division del trabajo es la que fija el Readme y conviene no mezclar: **el
 * validador valida forma (400) y el dominio valida sentido (422)**. Que
 * `amount_cents` sea un entero positivo es forma; que los montos exactos sumen
 * el total es sentido, y eso lo dice `app/domain/reparto.ts`, que es el unico
 * lugar donde esa cuenta se hace.
 */

/**
 * Todo lo que sigue son **fabricas**, no constantes compartidas.
 *
 * Los nodos de esquema de VineJS son mutables: reusar el mismo nodo en dos
 * esquemas —uno pidiendo el campo y otro con `.optional()`— le cambia la forma
 * al primero, y es la clase de bug que no se ve porque los dos esquemas siguen
 * compilando. Una funcion por campo cuesta nada y cierra el tema.
 */

/**
 * El monto, en centavos enteros.
 *
 * `strict` es lo importante: sin el, VineJS acepta `"30000"` y lo convierte. Un
 * string donde va un entero casi siempre es un cliente mandando lo que escribio
 * la persona sin pasarlo por su propia conversion, y entonces `"300,50"` entra
 * como otra cosa. Mejor rechazarlo y que el cliente arregle su lado.
 *
 * `withoutDecimals` ataja el error que mas cuesta: mandar **pesos** donde van
 * centavos. `300.5` no es un monto invalido a la vista, es un monto cien veces
 * mas chico que el que alguien quiso escribir.
 *
 * Y `min(1)` y no `positive()`: medido, `positive()` deja pasar el cero, y un
 * gasto de cero no es un gasto. El CHECK `expenses_monto_positivo` lo
 * rechazaria igual, pero como un 500 con el nombre de la restriccion adentro.
 */
const montoEnCentavos = () => vine.number({ strict: true }).withoutDecimals().min(1)

/**
 * La fecha, como texto `YYYY-MM-DD`.
 *
 * Se valida la forma con una expresion y **el calendario aparte**, en el
 * controlador: `2026-02-30` tiene la forma correcta y no existe. Se guarda el
 * texto original y no un `Date`: convertir a `Date` y volver a texto pasa por el
 * uso horario, y un gasto del 1 de noviembre a la medianoche se guarda el 31 de
 * octubre sin que nadie lo note.
 */
const fecha = () =>
  vine
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)

const descripcion = () => vine.string().trim().minLength(1).maxLength(200)
const modo = () => vine.enum(['equal', 'exact', 'percentage'] as const)
const membresia = () => vine.string().trim().uuid()

/**
 * Una parte del reparto.
 *
 * Los tres modos comparten la forma y usan campos distintos: `equal` solo
 * necesita quien participa, `exact` el monto de cada uno y `percentage` su
 * porcentaje. Cual hace falta segun el modo se verifica en el controlador, donde
 * el modo ya se conoce.
 *
 * El porcentaje viaja como **texto** a proposito: `app/domain/reparto.ts` lo
 * parsea con sus propias reglas —dos decimales como maximo, coma o punto— y un
 * `number` ya habria perdido la diferencia entre "33.33" y
 * "33.330000000000004".
 */
const parte = () =>
  vine.object({
    membership_id: membresia(),
    amount_cents: montoEnCentavos().optional(),
    percentage: vine.string().trim().optional(),
  })

export const crearGastoValidator = vine.compile(
  vine.object({
    paid_by: membresia(),
    amount_cents: montoEnCentavos(),
    description: descripcion(),
    incurred_on: fecha(),
    split_mode: modo(),
    shares: vine.array(parte()).minLength(1),
  })
)

/**
 * La edicion. Todo opcional, pero el monto, el modo y el reparto van **juntos**:
 * eso se verifica en el controlador, porque es una regla entre campos.
 *
 * El motivo de que vayan juntos: cambiar el total y recalcular con las partes
 * viejas es imposible en modo `exact` —los montos de cada uno ya no suman el
 * total nuevo— y en `percentage` habria que adivinar los porcentajes a partir de
 * los centavos, que es justo el camino por el que se pierde un centavo. Mejor
 * pedir el reparto explicito que inventarlo.
 */
export const actualizarGastoValidator = vine.compile(
  vine.object({
    paid_by: membresia().optional(),
    amount_cents: montoEnCentavos().optional(),
    description: descripcion().optional(),
    incurred_on: fecha().optional(),
    split_mode: modo().optional(),
    shares: vine.array(parte()).minLength(1).optional(),
  })
)

export const historialValidator = vine.compile(
  vine.object({
    page: vine.number({ strict: false }).withoutDecimals().positive().optional(),
    // Un tope, y no por capricho: cada gasto trae su reparto, asi que una pagina
    // de mil gastos son miles de filas y un JSON que nadie va a leer.
    per_page: vine.number({ strict: false }).withoutDecimals().range([1, 100]).optional(),
  })
)
