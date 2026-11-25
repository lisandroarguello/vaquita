import db from '@adonisjs/lucid/services/db'
import hash from '@adonisjs/core/services/hash'

/**
 * Altas y verificacion de credenciales, con SQL crudo como el resto de los
 * repositorios.
 *
 * El login **no** pasa por el modelo Lucid. `app/models/user.ts` existe solo
 * para que `@adonisjs/auth` tenga de donde emitir tokens; resolver credenciales
 * adentro del modelo (que es lo que hace el mixin `withAuthFinder`) convertiria
 * a ese modelo en la puerta por la que despues entra todo el acceso a datos.
 */

/** Lo que viaja hacia arriba. **Nunca** incluye el hash. */
export interface UsuarioPublico {
  id: string
  email: string
  nombre: string
}

/**
 * Normaliza el mail a minuscula.
 *
 * La base tiene un CHECK `email = lower(email)` y un UNIQUE sobre la columna,
 * asi que esto no es una comodidad: sin normalizar, el INSERT es rechazado por
 * el CHECK y la busqueda no encuentra a alguien que se registro con mayusculas.
 */
function normalizar(email: string): string {
  return email.trim().toLowerCase()
}

export async function crearUsuario(datos: {
  email: string
  passwordPlano: string
  nombre: string
}): Promise<UsuarioPublico> {
  const email = normalizar(datos.email)
  const passwordHash = await hash.make(datos.passwordPlano)

  const { rows } = await db.rawQuery(
    `INSERT INTO users (email, password_hash, display_name)
     VALUES (?, ?, ?)
     RETURNING id, email, display_name`,
    [email, passwordHash, datos.nombre]
  )

  return { id: rows[0].id, email: rows[0].email, nombre: rows[0].display_name }
}

/** La fila completa, con el hash. Solo para quien tenga que verificarlo. */
interface FilaUsuario extends UsuarioPublico {
  passwordHash: string
}

export async function buscarPorMail(email: string): Promise<FilaUsuario | null> {
  const { rows } = await db.rawQuery(
    `SELECT id, email, display_name, password_hash FROM users WHERE email = ?`,
    [normalizar(email)]
  )
  if (rows.length === 0) return null

  return {
    id: rows[0].id,
    email: rows[0].email,
    nombre: rows[0].display_name,
    passwordHash: rows[0].password_hash,
  }
}

export async function buscarPorId(id: string): Promise<UsuarioPublico | null> {
  const { rows } = await db.rawQuery(`SELECT id, email, display_name FROM users WHERE id = ?`, [id])
  if (rows.length === 0) return null
  return { id: rows[0].id, email: rows[0].email, nombre: rows[0].display_name }
}

/**
 * Devuelve el usuario si la contraseña es la suya, y `null` en cualquier otro
 * caso.
 *
 * **Un mail inexistente y una contraseña equivocada devuelven exactamente lo
 * mismo**, a proposito: cualquier diferencia entre los dos casos —un motivo
 * distinto, un tipo de error distinto— alcanza para averiguar quien tiene
 * cuenta.
 *
 * Por eso tambien se hashea una clave descartable cuando el mail no existe: sin
 * eso, la respuesta vuelve al instante en un caso y despues de un scrypt en el
 * otro, y el tiempo responde la pregunta que el cuerpo se niega a responder.
 */
export async function verificarCredenciales(
  email: string,
  passwordPlano: string
): Promise<UsuarioPublico | null> {
  const fila = await buscarPorMail(email)

  if (fila === null) {
    await hash.make(passwordPlano)
    return null
  }

  const coincide = await hash.verify(fila.passwordHash, passwordPlano)
  if (!coincide) return null

  return { id: fila.id, email: fila.email, nombre: fila.nombre }
}
