import db from '@adonisjs/lucid/services/db'
import { centsDe } from '#repositories/cents'

/**
 * Los pagos (API-7 / DAT-4).
 *
 * Un pago es **una fila y una sola tabla**: no hay nada que coordinar, asi que
 * no hay transaccion propia y tampoco hace falta `SET CONSTRAINTS ALL
 * IMMEDIATE` —el caveat de DAT-2 vale para las escrituras que dependen de una
 * restriccion diferida, y las de `payments` son todas inmediatas: los `CHECK` de
 * monto positivo y de extremos distintos, y las tres FK compuestas
 * `(membresia, grupo)`, se verifican en la sentencia.
 *
 * El `trx` opcional esta igual, por el patron de DAT-4: el dia que un pago se
 * registre junto con otra escritura —cerrar el grupo al saldar el ultimo
 * saldo, por ejemplo— tiene que poder entrar en la misma transaccion sin
 * reescribir esta funcion.
 */

type Ejecutor = Pick<typeof db, 'rawQuery'>

export interface Pago {
  id: string
  grupoId: string
  deMembresia: string
  paraMembresia: string
  cents: number
  confirmadoEn: string
  confirmadoPor: string
}

export interface DatosDePago {
  grupoId: string
  deMembresia: string
  paraMembresia: string
  cents: number
  /**
   * Quien dice que la plata se movio. Es la membresia de quien manda el pedido,
   * no uno de los dos extremos: el pagador, el cobrador y un administrador
   * pueden registrar el pago, y despues importa saber cual de los tres fue.
   */
  confirmadoPor: string
}

export async function registrarPago(datos: DatosDePago, trx?: Ejecutor): Promise<Pago> {
  const eje = trx ?? db

  const { rows } = await eje.rawQuery(
    `INSERT INTO payments (group_id, from_membership, to_membership, amount_cents, confirmed_by)
     VALUES (?, ?, ?, ?, ?)
     RETURNING id, group_id, from_membership, to_membership, amount_cents,
               confirmed_at, confirmed_by`,
    [datos.grupoId, datos.deMembresia, datos.paraMembresia, datos.cents, datos.confirmadoPor]
  )

  return armar(rows[0])
}

/**
 * Si ya hay un pago identico —mismo pagador, mismo cobrador, mismo monto— en
 * este grupo, lo devuelve.
 *
 * No es una restriccion `UNIQUE` en la base, y eso es a proposito: dos pagos
 * identicos son **legitimos** (la misma persona le paga a la misma otra el
 * mismo monto dos veces, por dos deudas distintas, en dos momentos). Lo que no
 * es legitimo es que el doble click de un formulario cobre dos veces. La
 * diferencia entre las dos cosas no esta en los datos: esta en si quien manda
 * el segundo pedido sabia del primero. Por eso lo decide la capa HTTP, que
 * puede preguntar.
 */
export async function pagoIdenticoDe(
  grupoId: string,
  deMembresia: string,
  paraMembresia: string,
  cents: number
): Promise<Pago | null> {
  const { rows } = await db.rawQuery(
    `SELECT id, group_id, from_membership, to_membership, amount_cents,
            confirmed_at, confirmed_by
       FROM payments
      WHERE group_id = ? AND from_membership = ? AND to_membership = ?
        AND amount_cents = ?
      ORDER BY confirmed_at DESC
      LIMIT 1`,
    [grupoId, deMembresia, paraMembresia, cents]
  )

  return rows.length === 0 ? null : armar(rows[0])
}

/** Los pagos del grupo, del mas nuevo al mas viejo. */
export async function pagosDe(grupoId: string): Promise<Pago[]> {
  const { rows } = await db.rawQuery(
    `SELECT id, group_id, from_membership, to_membership, amount_cents,
            confirmed_at, confirmed_by
       FROM payments
      WHERE group_id = ?
      ORDER BY confirmed_at DESC, id`,
    [grupoId]
  )

  return rows.map(armar)
}

function armar(fila: Record<string, unknown>): Pago {
  return {
    id: fila.id as string,
    grupoId: fila.group_id as string,
    deMembresia: fila.from_membership as string,
    paraMembresia: fila.to_membership as string,
    // `BIGINT` llega como string desde `pg`: `centsDe` y nunca `+valor`, que
    // convierte silenciosamente un numero que no entra en un `number`.
    cents: centsDe(fila.amount_cents, 'El monto de un pago'),
    confirmadoEn: (fila.confirmed_at as Date).toISOString(),
    confirmadoPor: fila.confirmed_by as string,
  }
}
