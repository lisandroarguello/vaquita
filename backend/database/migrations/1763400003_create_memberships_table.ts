import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * DAT-1 — `memberships`.
 *
 * El `UNIQUE (id, group_id)` parece redundante contra la clave primaria y no lo
 * es: es el blanco de las claves foraneas compuestas de `expenses`,
 * `expense_shares` y `payments`, que son las que impiden que una fila de un
 * grupo apunte a un integrante de otro. Una foranea simple a `id` no alcanza,
 * porque una membresia de otro grupo tambien es una membresia que existe.
 *
 * Nadie se borra: para sacar a alguien del grupo esta `active = false`. Un
 * integrante que ya pago un gasto es parte del historial.
 */
export default class extends BaseSchema {
  protected tableName = 'memberships'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.uuid('id').primary().defaultTo(this.raw('gen_random_uuid()'))
      table.uuid('group_id').notNullable().references('id').inTable('groups')
      table.uuid('user_id').notNullable().references('id').inTable('users')
      table.text('role').notNullable().defaultTo('member')
      table.text('payout_alias').nullable()
      table.boolean('active').notNullable().defaultTo(true)
      table.timestamp('joined_at', { useTz: true }).notNullable().defaultTo(this.now())

      table.unique(['group_id', 'user_id'], { indexName: 'memberships_uno_por_grupo' })
      table.unique(['id', 'group_id'], { indexName: 'memberships_id_por_grupo' })
      table.check(`role in ('admin', 'member')`, undefined, 'memberships_rol_conocido')

      // `group_id` ya queda indexado por el UNIQUE de arriba, que lo lleva
      // adelante. El que falta es el otro lado: "en que grupos esta esta
      // persona", que es la primera consulta de la sesion.
      table.index(['user_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
