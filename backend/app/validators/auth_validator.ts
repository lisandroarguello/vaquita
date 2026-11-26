import vine from '@vinejs/vine'

/**
 * Forma de los datos de entrada, con VineJS, como fija el Readme. El validador
 * valida **forma**; que el mail ya exista o que la contraseña sea la correcta no
 * es forma y no se decide aca.
 */

/**
 * Doce caracteres, no ocho.
 *
 * Una contraseña de esta aplicacion protege cuanta plata le debe cada uno a cada
 * uno, y el unico factor es esto. Largo le gana a reglas de composicion: exigir
 * un simbolo produce `Password1!` y no produce entropia.
 *
 * El maximo no es un capricho: `scrypt` hashea lo que le den, y una contraseña
 * de un megabyte es una denegacion de servicio gratis contra el login.
 */
const password = vine.string().minLength(12).maxLength(256)

export const registroValidator = vine.compile(
  vine.object({
    // `trim` antes de `email`: un espacio pegado al final no es un mail
    // invalido, es un dedo. El repositorio igual normaliza a minuscula.
    email: vine.string().trim().email().maxLength(254),
    password,
    display_name: vine.string().trim().minLength(1).maxLength(80),
  })
)

/**
 * El login **no** repite las reglas del registro.
 *
 * Si pidiera 12 caracteres, una contraseña vieja mas corta daria 400 con el
 * detalle "minLength" en vez de 401, y eso le dice a cualquiera que esa cuenta
 * existe y como es su clave. Aca solo se exige que los campos esten.
 */
export const loginValidator = vine.compile(
  vine.object({
    email: vine.string().trim().maxLength(254),
    password: vine.string().maxLength(256),
  })
)
