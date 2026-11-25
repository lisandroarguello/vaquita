import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Los tokens de sesion.
 *
 * **Escrita a mano y no con el stub de `@adonisjs/auth`**, que crea
 * `table.increments('id')` y un `tokenable_id` entero. Acá todas las claves son
 * `uuid` generadas por la base; un `tokenable_id` entero no podria apuntar a
 * `users.id` y la FK ni siquiera se podria declarar.
 *
 * En la tabla no se guarda el token: se guarda su **hash**. Si alguien se lleva
 * una copia de esta tabla, no se lleva ninguna sesion. Por eso el indice va
 * sobre `hash`, que es por donde el provider busca en cada peticion.
 *
 * `ON DELETE CASCADE` en `tokenable_id`: borrar un usuario tiene que llevarse
 * sus tokens. Un token huerfano que siga validando es una sesion de alguien que
 * ya no existe.
 */
export default class extends BaseSchema {
  protected tableName = 'auth_access_tokens'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.uuid('id').primary().defaultTo(this.db.rawQuery('gen_random_uuid()').knexQuery)

      table.uuid('tokenable_id').notNullable().references('id').inTable('users').onDelete('CASCADE')

      table.string('type').notNullable()
      table.string('name').nullable()
      table.string('hash').notNullable()
      table.text('abilities').notNullable()

      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()
      table.timestamp('last_used_at', { useTz: true }).nullable()
      table.timestamp('expires_at', { useTz: true }).nullable()

      // El provider busca por hash en cada peticion autenticada, y lista por
      // usuario al cerrar sesion en todos lados.
      table.index(['hash'], 'auth_access_tokens_por_hash')
      table.index(['tokenable_id'], 'auth_access_tokens_por_usuario')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
