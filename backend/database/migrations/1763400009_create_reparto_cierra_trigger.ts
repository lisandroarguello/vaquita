import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * DAT-2 — las partes de un gasto suman su total, exigido por la base.
 *
 * Es la invariante de la que depende todo lo demas: si un reparto pierde o gana
 * un centavo, los saldos del grupo dejan de sumar cero y el plan de cierre no se
 * puede verificar. `app/domain/reparto.ts` ya la garantiza para lo que entra por
 * ahi; esto la sostiene para lo que entra por otro lado.
 *
 * ## Diferido, y no es opcional
 *
 * Un gasto es una fila y su reparto son N: la fila del gasto existe antes que
 * sus partes, por fuerza. Con un trigger inmediato, el primer `INSERT` de un
 * reparto de seis personas ya viola la condicion y **no hay forma de cargar un
 * gasto**. `DEFERRABLE INITIALLY DEFERRED` corre la verificacion al `COMMIT`,
 * que es el unico momento en que la pregunta tiene sentido.
 *
 * El corolario manda sobre el resto del proyecto: **toda escritura de gastos va
 * en una transaccion.** Sin transaccion cada `INSERT` es su propia transaccion,
 * el diferido no difiere nada y el gasto solo no cierra.
 *
 * ## Y hace falta pedir la verificacion a mano
 *
 * Medido: **Lucid se come el error del `COMMIT`.** Cuando la violacion se
 * levanta al commitear, ni `db.transaction(callback)` ni `trx.commit()` la
 * propagan — la promesa resuelve como si todo hubiera salido bien. Los datos
 * **si** se revierten, asi que la base nunca queda inconsistente, pero la
 * aplicacion no se entera y devolveria un `201` por un gasto que no existe. Eso
 * es peor que no tener la restriccion.
 *
 * Por eso toda escritura de gastos termina con `SET CONSTRAINTS ALL IMMEDIATE`
 * adentro de la transaccion: fuerza la verificacion ahi, donde el error es el de
 * una sentencia comun y si llega con su `code` (`23514`) y su `constraint`. Esta
 * fijado en `tests/database/reparto_cierra.spec.ts`.
 *
 * ## Por que tambien sobre `expenses`
 *
 * Un trigger solo sobre `expense_shares` deja dos agujeros, y los dos son el
 * error facil de cometer y dificil de ver:
 *
 * - **Un gasto sin ninguna parte.** No hay fila en `expense_shares`, asi que no
 *   hay trigger que se dispare. Ese gasto le acredita la plata al pagador y no
 *   le debita a nadie.
 * - **Cambiarle el monto a un gasto y olvidarse del reparto.** Tampoco toca
 *   `expense_shares`.
 *
 * El `UPDATE` sin `OF amount_cents` es a proposito: anular un gasto es un
 * `UPDATE` de `status` y tiene que seguir pasando —el reparto no se toca y
 * sigue cerrando—, asi que no cuesta nada verificar en todos los casos y evita
 * que una columna nueva quede fuera de la lista.
 */
export default class extends BaseSchema {
  async up() {
    /**
     * Una sola funcion para los dos triggers: el gasto a verificar sale de
     * `NEW`/`OLD` segun de que tabla venga.
     *
     * `RETURN NULL` porque en un trigger `AFTER` el valor devuelto se ignora, y
     * `USING CONSTRAINT` es lo que hace que `pg` devuelva el nombre en el campo
     * `constraint` del error: sin eso, quien lo atrapa tiene que adivinar la
     * causa leyendo el texto del mensaje.
     */
    this.schema.raw(`
      CREATE OR REPLACE FUNCTION reparto_cierra_con_el_total() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE
        gasto uuid;
        total bigint;
        suma bigint;
      BEGIN
        IF TG_TABLE_NAME = 'expense_shares' THEN
          gasto := COALESCE(NEW.expense_id, OLD.expense_id);
        ELSE
          gasto := COALESCE(NEW.id, OLD.id);
        END IF;

        SELECT amount_cents INTO total FROM expenses WHERE id = gasto;

        -- El gasto pudo haberse borrado en esta misma transaccion: el reparto se
        -- va en cascada y el trigger se dispara por cada parte. Sin esta salida,
        -- un borrado perfectamente valido queda bloqueado para siempre.
        IF NOT FOUND THEN
          RETURN NULL;
        END IF;

        SELECT COALESCE(sum(share_cents), 0) INTO suma
          FROM expense_shares WHERE expense_id = gasto;

        IF suma <> total THEN
          RAISE EXCEPTION
            'El reparto del gasto % suma % y el gasto es de %', gasto, suma, total
            USING ERRCODE = '23514', CONSTRAINT = 'expense_shares_suman_el_total';
        END IF;

        RETURN NULL;
      END;
      $$;
    `)

    this.schema.raw(`
      CREATE CONSTRAINT TRIGGER expense_shares_suman_el_total
        AFTER INSERT OR UPDATE OR DELETE ON expense_shares
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION reparto_cierra_con_el_total();
    `)

    this.schema.raw(`
      CREATE CONSTRAINT TRIGGER expenses_cierran_con_su_reparto
        AFTER INSERT OR UPDATE ON expenses
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION reparto_cierra_con_el_total();
    `)
  }

  async down() {
    this.schema.raw(`DROP TRIGGER IF EXISTS expenses_cierran_con_su_reparto ON expenses;`)
    this.schema.raw(`DROP TRIGGER IF EXISTS expense_shares_suman_el_total ON expense_shares;`)
    this.schema.raw(`DROP FUNCTION IF EXISTS reparto_cierra_con_el_total();`)
  }
}
