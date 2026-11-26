/**
 * La forma unica de error de la seccion 7 del Readme, en un solo lugar.
 *
 * ```json
 * { "errors": [{ "field": "amount_cents", "rule": "positive", "message": "..." }] }
 * ```
 *
 * Estaba al pie de `groups_controller.ts` mientras ese era el unico controlador.
 * Con el segundo, copiarla era garantizar que a la tercera se desprolije: un
 * controlador devolviendo `{ error: "..." }` en singular no rompe ningun test y
 * obliga al cliente a manejar dos formas.
 *
 * `field` ausente significa que el error es del recurso o del formulario entero
 * y no de un campo, y el cliente usa esa distincion para decidir donde
 * mostrarlo.
 */

/** Un error del recurso entero: sin `field`. */
export function errorDe(message: string) {
  return { errors: [{ message }] }
}

/** Un error atribuible a un campo del formulario. */
export function errorDeCampo(field: string, rule: string, message: string) {
  return { errors: [{ field, rule, message }] }
}

/**
 * Falta de **rol**, que es 403 y no 404.
 *
 * La diferencia con API-8 es la que importa: quien recibe esto ya es integrante
 * del grupo, asi que ya sabe que el grupo existe. El 404 no protegeria nada y
 * solo mentiria.
 */
export function errorDeRol(message: string) {
  return { errors: [{ rule: 'forbidden_role', message }] }
}

/**
 * Una invariante rota del dominio se reporta con su mensaje, que ya dice cuanto
 * falta o sobra en pesos. Tragarse el detalle manda a alguien a buscar a ciegas.
 */
export function errorDeInvariante(error: unknown) {
  return {
    errors: [
      {
        rule: 'invariant_violated',
        message: error instanceof Error ? error.message : String(error),
      },
    ],
  }
}

/**
 * Traduce el error de VineJS a la forma unica, para responder **400**.
 *
 * El Readme fija 400 para validacion fallida y reserva 422 para otra cosa (la
 * salida del LLM que no valida), asi que el 422 que VineJS produce por omision
 * al dejar que la excepcion suba no sirve: hay que tomarla y traducirla.
 *
 * Si el error no es de validacion, se vuelve a lanzar. Tragarlo convertiria
 * cualquier excepcion en un 400, que es la forma mas rapida de que un bug se
 * presente como "el cliente mando algo mal".
 */
export function errorDeValidacion(error: unknown) {
  const mensajes = (error as { messages?: unknown }).messages
  if (Array.isArray(mensajes)) {
    return {
      errors: mensajes.map((m: { field?: string; rule?: string; message: string }) => ({
        field: m.field,
        rule: m.rule,
        message: m.message,
      })),
    }
  }
  throw error
}
