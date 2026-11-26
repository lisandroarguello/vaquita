import vine from '@vinejs/vine'

/**
 * La **forma** del pago (API-7). Lo que no cierra por sentido —un pago contra
 * uno mismo, una membresia de otro grupo— no se valida aca: eso es 422 y lo
 * decide el controlador contra los integrantes reales del grupo.
 *
 * Los campos son **fabricas** y no constantes, igual que en `gasto_validator`:
 * los nodos de esquema de VineJS son mutables, asi que compartir un nodo entre
 * dos esquemas —uno pidiendolo y otro con `.optional()`— le cambia la forma al
 * primero sin que nada deje de compilar.
 */

/**
 * `min(1)` y no `positive()`: **`positive()` deja pasar el cero**. Un pago de
 * cero no mueve ningun saldo y la base lo rechaza con su `CHECK`, que llegaria
 * como un 500 por algo que es un error del pedido.
 */
const montoEnCentavos = () => vine.number({ strict: true }).withoutDecimals().min(1)

const membresia = () => vine.string().trim().uuid()

export const registrarPagoValidator = vine.compile(
  vine.object({
    from_membership_id: membresia(),
    to_membership_id: membresia(),
    amount_cents: montoEnCentavos(),
    /**
     * La salida explicita para el pago repetido a proposito.
     *
     * Sin esto, la guarda del `409` haria imposible registrar dos pagos
     * identicos, que son perfectamente normales: la misma persona le paga a la
     * misma otra el mismo monto por dos deudas distintas. Con esto, el cliente
     * confirma que ya sabe del primero y lo registra igual.
     */
    allow_duplicate: vine.boolean().optional(),
  })
)
