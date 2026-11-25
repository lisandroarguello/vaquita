import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DbAccessTokensProvider } from '@adonisjs/auth/access_tokens'
import type { DateTime } from 'luxon'

/**
 * **El unico modelo Lucid del proyecto, y existe por una sola razon.**
 *
 * El resto del acceso a datos vive en `app/repositories/` con `db.rawQuery`, y
 * esa es la regla. La excepcion es esta: `DbAccessTokensProvider.forModel()`
 * esta acoplado a `BaseModel` —gestiona la tabla de tokens, el hash del secreto
 * y la expiracion contra un modelo—, y escribir un provider de tokens propio
 * para evitarlo es un dia de trabajo que no cambia nada de lo que el producto
 * hace.
 *
 * Por eso este modelo es deliberadamente anemico: sin relaciones, sin hooks, sin
 * scopes, sin metodos. **No se le agrega nada.** En cuanto empiece a crecer deja
 * de ser un adaptador de autenticacion y pasa a ser la puerta por la que entra
 * todo el acceso a datos, que es justo lo que `app/repositories/` evita.
 *
 * Tampoco usa el mixin `withAuthFinder`: espera una columna `password` que esta
 * tabla no tiene, y resuelve credenciales adentro del modelo. Eso lo hace
 * `verificarCredenciales` en `app/repositories/usuario_repository.ts`.
 */
export default class User extends BaseModel {
  @column({ isPrimary: true })
  declare id: string

  @column()
  declare email: string

  @column({ columnName: 'display_name' })
  declare displayName: string

  @column({ columnName: 'password_hash', serializeAs: null })
  declare passwordHash: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  /**
   * Treinta dias de vigencia.
   *
   * Es el equilibrio entre no obligar a volver a entrar todas las semanas y que
   * un token filtrado no sirva para siempre. El cierre de sesion revoca el token
   * en el momento, asi que la expiracion es la red para el caso en que nadie
   * cierre sesion.
   */
  static accessTokens = DbAccessTokensProvider.forModel(User, {
    expiresIn: '30 days',
    prefix: 'vaq_',
    table: 'auth_access_tokens',
    type: 'auth_token',
    tokenSecretLength: 40,
  })
}
