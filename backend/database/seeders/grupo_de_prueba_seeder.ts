import { BaseSeeder } from '@adonisjs/lucid/seeders'
import db from '@adonisjs/lucid/services/db'
import hash from '@adonisjs/core/services/hash'
import env from '#start/env'
import { Money } from '#domain/money'
import {
  porcentaje,
  repartirEnPartesIguales,
  repartirPorMontosExactos,
  repartirPorPorcentajes,
} from '#domain/reparto'

/**
 * Un grupo de prueba reproducible: seis personas, un viaje, y gastos repartidos
 * de las tres maneras que soporta el dominio.
 *
 * Todo esta fijo —ids, montos, fechas—, sin azar: correr la semilla dos veces
 * da exactamente el mismo grupo, y la URL del grupo se puede escribir en la
 * documentacion sin que cambie. Los datos son **generados, nunca reales**.
 *
 * El reparto de cada gasto se calcula con las funciones del dominio y no a
 * mano: si se escribieran los centavos a dedo, la semilla podria cargar un
 * gasto cuyas partes no suman el total, que es justo lo que el sistema promete
 * que no puede pasar.
 *
 *   node ace db:seed
 *   curl http://localhost:3333/api/v1/groups/11111111-1111-4111-8111-111111111111/settlement
 */
export default class extends BaseSeeder {
  static environment = ['development', 'test']

  async run() {
    const GRUPO = '11111111-1111-4111-8111-111111111111'

    const gente = [
      { id: '22222222-2222-4222-8222-000000000001', nombre: 'Ana', alias: 'ana.mp' },
      { id: '22222222-2222-4222-8222-000000000002', nombre: 'Javier', alias: 'javi.uala' },
      { id: '22222222-2222-4222-8222-000000000003', nombre: 'Sol', alias: 'sol.brubank' },
      { id: '22222222-2222-4222-8222-000000000004', nombre: 'Tomas', alias: null },
      { id: '22222222-2222-4222-8222-000000000005', nombre: 'Lucia', alias: 'lu.mp' },
      { id: '22222222-2222-4222-8222-000000000006', nombre: 'Nico', alias: 'nico.mp' },
    ]

    // Idempotente: borrar el grupo arrastra sus gastos y repartos, y las
    // personas se vuelven a crear con el mismo id.
    await db.rawQuery(`DELETE FROM payments WHERE group_id = ?`, [GRUPO])
    await db.rawQuery(`DELETE FROM expenses WHERE group_id = ?`, [GRUPO])
    await db.rawQuery(`DELETE FROM memberships WHERE group_id = ?`, [GRUPO])
    await db.rawQuery(`DELETE FROM groups WHERE id = ?`, [GRUPO])
    await db.rawQuery(`DELETE FROM users WHERE email LIKE '%@vaquita.example'`)

    // La misma contraseña para los seis, hasheada de verdad.
    //
    // Antes se insertaba el literal 'no-es-un-hash', y con eso ninguna de las
    // seis cuentas podia iniciar sesion: la semilla servia para leer saldos y
    // para nada mas. Estas son las credenciales que el README publica para que
    // el evaluador entre, asi que tienen que funcionar.
    //
    // No es un secreto —son datos generados en una base descartable— pero sale
    // de env igual, para que el valor real de una demo publicada no quede
    // escrito en el repositorio.
    const clave = env.get('SEED_PASSWORD', 'vaquita-demo')
    const claveHasheada = await hash.make(clave)

    const usuarios: string[] = []
    for (const persona of gente) {
      const { rows } = await db.rawQuery(
        `INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?)
         RETURNING id`,
        [`${persona.nombre.toLowerCase()}@vaquita.example`, claveHasheada, persona.nombre]
      )
      usuarios.push(rows[0].id)
    }

    await db.rawQuery(
      `INSERT INTO groups (id, name, currency, created_by, status)
       VALUES (?, 'Viaje a Bariloche', 'ARS', ?, 'open')`,
      [GRUPO, usuarios[0]]
    )

    for (const [indice, persona] of gente.entries()) {
      await db.rawQuery(
        `INSERT INTO memberships (id, group_id, user_id, role, payout_alias, joined_at)
         VALUES (?, ?, ?, ?, ?, now() + (? || ' seconds')::interval)`,
        [
          persona.id,
          GRUPO,
          usuarios[indice],
          indice === 0 ? 'admin' : 'member',
          persona.alias,
          indice,
        ]
      )
    }

    const todos = gente.map((p) => p.id)
    const pesos = (texto: string) => Money.fromDecimalString(texto)

    /** Carga un gasto con su reparto ya resuelto por el dominio. */
    const gasto = async (datos: {
      pagadoPor: string
      total: Money
      partes: { integrante: string; monto: Money }[]
      descripcion: string
      fecha: string
      modo: 'equal' | 'exact' | 'percentage'
      anulado?: boolean
    }) => {
      const { rows } = await db.rawQuery(
        `INSERT INTO expenses (group_id, paid_by, created_by, amount_cents, description,
                               incurred_on, split_mode, status, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual') RETURNING id`,
        [
          GRUPO,
          datos.pagadoPor,
          datos.pagadoPor,
          datos.total.cents,
          datos.descripcion,
          datos.fecha,
          datos.modo,
          datos.anulado === true ? 'voided' : 'active',
        ]
      )
      for (const parte of datos.partes) {
        await db.rawQuery(
          `INSERT INTO expense_shares (expense_id, membership_id, group_id, share_cents)
           VALUES (?, ?, ?, ?)`,
          [rows[0].id, parte.integrante, GRUPO, parte.monto.cents]
        )
      }
    }

    /** Reparto en partes iguales entre todos, rotando quien se come el resto. */
    const entreTodos = (total: Money, desde: number) =>
      repartirEnPartesIguales(total, todos.length, desde).map((monto, i) => ({
        integrante: todos[i],
        monto,
      }))

    // 1. La cabaña, en partes iguales entre los seis. No divide exacto: el
    //    centavo que sobra arranca en Javier y no siempre en Ana.
    const cabana = pesos('487000,00')
    await gasto({
      pagadoPor: gente[0].id,
      total: cabana,
      partes: entreTodos(cabana, 1),
      descripcion: 'Cabaña, 5 noches',
      fecha: '2026-11-02',
      modo: 'equal',
    })

    // 2. La nafta, por montos exactos: Tomas no viajo en ese auto.
    const nafta = pesos('96000,00')
    const montosNafta = [
      pesos('24000,00'),
      pesos('24000,00'),
      pesos('16000,00'),
      Money.zero(),
      pesos('16000,00'),
      pesos('16000,00'),
    ]
    await gasto({
      pagadoPor: gente[1].id,
      total: nafta,
      partes: repartirPorMontosExactos(nafta, montosNafta).map((monto, i) => ({
        integrante: todos[i],
        monto,
      })),
      descripcion: 'Nafta ida y vuelta',
      fecha: '2026-11-02',
      modo: 'exact',
    })

    // 3. El asado, por porcentajes: los que comieron carne ponen mas.
    const asado = pesos('73500,00')
    const porcentajes = ['25.00', '20.00', '15.00', '15.00', '15.00', '10.00'].map(porcentaje)
    await gasto({
      pagadoPor: gente[2].id,
      total: asado,
      partes: repartirPorPorcentajes(asado, porcentajes).map((monto, i) => ({
        integrante: todos[i],
        monto,
      })),
      descripcion: 'Asado del sabado',
      fecha: '2026-11-04',
      modo: 'percentage',
    })

    // 4. El supermercado, iguales otra vez, rotando el resto a Sol.
    const compras = pesos('128400,00')
    await gasto({
      pagadoPor: gente[3].id,
      total: compras,
      partes: entreTodos(compras, 2),
      descripcion: 'Supermercado',
      fecha: '2026-11-05',
      modo: 'equal',
    })

    // 5. Un gasto **anulado**: sigue en el historial y no mueve un centavo.
    //    Esta aca a proposito, para que la semilla ejercite ese camino.
    const cargado = pesos('50000,00')
    await gasto({
      pagadoPor: gente[4].id,
      total: cargado,
      partes: entreTodos(cargado, 0),
      descripcion: 'Cena que al final no fue (anulado)',
      fecha: '2026-11-06',
      modo: 'equal',
      anulado: true,
    })

    // Un pago ya confirmado: Nico le adelanto plata a Ana.
    await db.rawQuery(
      `INSERT INTO payments (group_id, from_membership, to_membership, amount_cents, confirmed_by)
       VALUES (?, ?, ?, ?, ?)`,
      [GRUPO, gente[5].id, gente[0].id, pesos('30000,00').cents, gente[5].id]
    )
  }
}
