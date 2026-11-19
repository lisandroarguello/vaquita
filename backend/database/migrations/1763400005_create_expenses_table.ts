import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * DAT-1 — `expenses`.
 *
 * `amount_cents` es `BIGINT`, nunca `FLOAT` ni `NUMERIC` con redondeo
 * implicito: la unidad del sistema es el centavo entero y un tipo con coma en
 * la base deshace en silencio todo lo que hace `Money`.
 *
 * `paid_by` y `created_by` apuntan a **membresias** del mismo grupo por clave
 * compuesta. Un pagador de otro grupo deja ese credito afuera de la suma y los
 * saldos dejan de dar cero; el dominio ya lanza por eso en DOM-4, y aca la base
 * lo sostiene para los caminos de escritura que todavia no existen.
 *
 * Un gasto no se borra: pasa a `status = 'voided'`. Es historial del grupo, y
 * borrar filas donde la gente discute plata es una mala idea.
 */
export default class extends BaseSchema {
  protected tableName = 'expenses'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.uuid('id').primary().defaultTo(this.raw('gen_random_uuid()'))
      table.uuid('group_id').notNullable().references('id').inTable('groups')
      table.uuid('paid_by').notNullable()
      table.uuid('created_by').notNullable()
      table.bigint('amount_cents').notNullable()
      table.text('description').notNullable()
      table.date('incurred_on').notNullable()
      table.text('split_mode').notNullable()
      table.text('status').notNullable().defaultTo('active')
      table.text('source').notNullable().defaultTo('manual')
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())

      table
        .foreign(['paid_by', 'group_id'], 'expenses_pagador_del_grupo')
        .references(['id', 'group_id'])
        .inTable('memberships')
      table
        .foreign(['created_by', 'group_id'], 'expenses_cargador_del_grupo')
        .references(['id', 'group_id'])
        .inTable('memberships')

      // Blanco de la foranea compuesta de `expense_shares`.
      table.unique(['id', 'group_id'], { indexName: 'expenses_id_por_grupo' })

      table.check(`amount_cents > 0`, undefined, 'expenses_monto_positivo')
      table.check(
        `split_mode in ('equal', 'exact', 'percentage')`,
        undefined,
        'expenses_modo_conocido'
      )
      table.check(`status in ('active', 'voided')`, undefined, 'expenses_estado_conocido')
      table.check(`source in ('manual', 'text', 'image')`, undefined, 'expenses_origen_conocido')

      // Los gastos de un grupo por fecha: es la pantalla principal.
      table.index(['group_id', 'incurred_on'])
      table.index(['paid_by'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
