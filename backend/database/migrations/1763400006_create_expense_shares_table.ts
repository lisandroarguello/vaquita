import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * DAT-1 — `expense_shares`.
 *
 * El reparto se materializa al cargar el gasto: es un hecho historico, no un
 * calculo diferido. Un gasto viejo no cambia porque despues se sume gente al
 * grupo.
 *
 * ## El `group_id` repetido
 *
 * La columna no esta en el modelo del Readme y se agrega a proposito: es lo que
 * permite las dos foraneas compuestas que atan el reparto **al mismo grupo** que
 * el gasto. Sin ella, `membership_id` puede apuntar a un integrante de otro
 * grupo —una membresia valida, pero ajena— y el saldo de ese tercero se mueve
 * por un gasto en el que no estuvo. Es el mismo agujero que DOM-4 cierra
 * lanzando, del lado de la base.
 *
 * El precio es un dato repetido que podria quedar desincronizado; las dos
 * foraneas son justamente lo que lo impide, porque ninguna de las dos acepta la
 * fila si el `group_id` no coincide con los dos lados a la vez.
 *
 * ## Lo que esta tabla **no** verifica todavia
 *
 * Que las partes de un gasto sumen su `amount_cents` es DAT-2, con un trigger.
 * Aca hay dos cosas que el trigger no veria: una parte negativa (la suma puede
 * dar igual) y la misma persona dos veces en el mismo gasto (la suma tambien
 * da igual, pero su saldo se mueve al doble).
 */
export default class extends BaseSchema {
  protected tableName = 'expense_shares'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.uuid('id').primary().defaultTo(this.raw('gen_random_uuid()'))
      table.uuid('expense_id').notNullable()
      table.uuid('membership_id').notNullable()
      table.uuid('group_id').notNullable()
      table.bigint('share_cents').notNullable()

      table
        .foreign(['expense_id', 'group_id'], 'expense_shares_gasto_del_grupo')
        .references(['id', 'group_id'])
        .inTable('expenses')
        .onDelete('CASCADE')
      table
        .foreign(['membership_id', 'group_id'], 'expense_shares_integrante_del_grupo')
        .references(['id', 'group_id'])
        .inTable('memberships')

      table.unique(['expense_id', 'membership_id'], { indexName: 'expense_shares_uno_por_gasto' })

      // Cero es legitimo: `repartirEnPartesIguales($0.01, 3)` da 1/0/0, y un
      // reparto por porcentajes admite 0%. Negativo no: seria el grupo
      // pagandole a alguien por un gasto.
      table.check(`share_cents >= 0`, undefined, 'expense_shares_parte_no_negativa')

      // `expense_id` ya queda indexado por el UNIQUE. El que falta es "en que
      // gastos participo", que es como se arma el saldo de una persona.
      table.index(['membership_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
