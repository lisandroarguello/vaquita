/**
 * Convierte un `BIGINT` de Postgres a centavos.
 *
 * El driver `pg` devuelve `int8` como **string**, no como number, porque un
 * bigint no entra siempre en un `Number`. Pasar eso directo a `Money.fromCents`
 * da un error raro y tardio; peor seria un `+valor` silencioso, que redondea sin
 * avisar arriba de 2^53.
 *
 * Vive en su propio modulo y no dentro de un repositorio a proposito: en cuanto
 * hubo un segundo repositorio, la alternativa era copiarlo, y una copia de esto
 * que se desincroniza pierde centavos sin que nadie se entere.
 */
export function centsDe(valor: unknown, de: string): number {
  const numero = typeof valor === 'string' ? Number(valor) : valor
  if (typeof numero !== 'number' || !Number.isSafeInteger(numero)) {
    throw new RangeError(
      `${de} no es un entero seguro de centavos: recibi ${JSON.stringify(valor)}. ` +
        `Un monto que no entra en un entero seguro no se puede sumar sin perder centavos`
    )
  }
  return numero
}
