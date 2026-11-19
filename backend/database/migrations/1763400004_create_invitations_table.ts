import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * DAT-1 — `invitations`.
 *
 * `used_count <= max_uses` esta en la base y no solo en el codigo que canjea:
 * es la invariante de la que depende el limite de usos de API-3, y si se rompe
 * nadie se da cuenta mirando la fila.
 */
export default class extends BaseSchema {
  protected tableName = 'invitations'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.uuid('id').primary().defaultTo(this.raw('gen_random_uuid()'))
      table.uuid('group_id').notNullable().references('id').inTable('groups')
      table.text('token').notNullable()
      table.timestamp('expires_at', { useTz: true }).notNullable()
      table.integer('max_uses').notNullable().defaultTo(1)
      table.integer('used_count').notNullable().defaultTo(0)
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())

      table.unique(['token'], { indexName: 'invitations_token_unico' })
      table.check(`max_uses > 0`, undefined, 'invitations_usos_positivos')
      table.check(`used_count >= 0`, undefined, 'invitations_usos_no_negativos')
      table.check(`used_count <= max_uses`, undefined, 'invitations_usos_no_pasados')

      table.index(['group_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
