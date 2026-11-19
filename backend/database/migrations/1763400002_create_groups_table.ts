import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * DAT-1 — `groups`.
 *
 * `currency` es un codigo ISO 4217 de tres letras mayusculas, verificado en la
 * base. Por defecto `ARS`, que es la moneda del caso de uso que el proyecto
 * describe; el grupo puede elegir otra al crearse.
 */
export default class extends BaseSchema {
  protected tableName = 'groups'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.uuid('id').primary().defaultTo(this.raw('gen_random_uuid()'))
      table.text('name').notNullable()
      table.text('currency').notNullable().defaultTo('ARS')
      table.uuid('created_by').notNullable().references('id').inTable('users')
      table.text('status').notNullable().defaultTo('open')
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())

      table.check(`status in ('open', 'closed')`, undefined, 'groups_estado_conocido')
      table.check(`currency ~ '^[A-Z]{3}$'`, undefined, 'groups_moneda_iso')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
