import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * DAT-1 — `payments`.
 *
 * Un pago es una transferencia que alguien marco como hecha. Vaquita no mueve
 * dinero: esta fila registra que la plata se movio afuera, y por eso
 * `confirmed_at` y `confirmed_by` son obligatorios — una fila sin confirmar no
 * seria un pago, seria una intencion, y eso es el plan de cierre.
 *
 * Las tres personas que aparecen —quien paga, quien cobra y quien confirma—
 * tienen que ser del mismo grupo, por clave compuesta. Y `from <> to`: un pago
 * de alguien a si mismo no cierra nada y le daria un plan valido a un plan que
 * no lo es.
 */
export default class extends BaseSchema {
  protected tableName = 'payments'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.uuid('id').primary().defaultTo(this.raw('gen_random_uuid()'))
      table.uuid('group_id').notNullable().references('id').inTable('groups')
      table.uuid('from_membership').notNullable()
      table.uuid('to_membership').notNullable()
      table.bigint('amount_cents').notNullable()
      table.timestamp('confirmed_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.uuid('confirmed_by').notNullable()

      table
        .foreign(['from_membership', 'group_id'], 'payments_pagador_del_grupo')
        .references(['id', 'group_id'])
        .inTable('memberships')
      table
        .foreign(['to_membership', 'group_id'], 'payments_cobrador_del_grupo')
        .references(['id', 'group_id'])
        .inTable('memberships')
      table
        .foreign(['confirmed_by', 'group_id'], 'payments_confirmador_del_grupo')
        .references(['id', 'group_id'])
        .inTable('memberships')

      table.check(`amount_cents > 0`, undefined, 'payments_monto_positivo')
      table.check(`from_membership <> to_membership`, undefined, 'payments_entre_dos_distintos')

      table.index(['group_id'])
      table.index(['from_membership'])
      table.index(['to_membership'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
