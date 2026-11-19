import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * DAT-1 — `users`.
 *
 * El mail se guarda en minuscula y la base lo exige: sin eso, "Ana@x.com" y
 * "ana@x.com" son dos filas distintas para el UNIQUE y la misma persona se
 * registra dos veces sin querer.
 */
export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.uuid('id').primary().defaultTo(this.raw('gen_random_uuid()'))
      table.text('email').notNullable()
      table.text('password_hash').notNullable()
      table.text('display_name').notNullable()
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())

      table.unique(['email'], { indexName: 'users_mail_unico' })
      table.check(`email = lower(email)`, undefined, 'users_mail_en_minuscula')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
