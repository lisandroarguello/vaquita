import { Money } from '#domain/money'
import type { IntegranteId, Saldo } from '#domain/saldos'
import type { Transferencia } from '#domain/minimizador'

/**
 * DOM-7 — Verificador de invariantes del plan de cierre.
 *
 * Dado un plan y los saldos de los que salio, dice si el plan **cierra**: si
 * aplicarlo deja todos los saldos exactamente en cero, si no propone mas de n-1
 * transferencias, y si cada transferencia es de monto positivo entre dos
 * personas distintas del grupo.
 *
 * Sirve para cualquier plan, venga de `minimizarExacto` o de `minimizarGreedy`,
 * porque las cuatro invariantes son las que los dos prometen. Lo que el
 * verificador **no** mira es la optimalidad: el minimo lo garantiza el exacto y
 * nada mas, y el greedy es subobtimo a proposito. Un verificador que exigiera
 * el minimo rechazaria la mitad de los planes legitimos del sistema.
 *
 * ## Por que devuelve un veredicto y no lanza
 *
 * Las puertas de entrada de `minimizador.ts` (`saldosActivos`) lanzan, y esta
 * bien que lo hagan: su trabajo es negarse a armar un plan sobre datos que no
 * cierran. El de aca es el contrario — mirar un plan ya armado y **decir** como
 * salio— asi que no se reuso esa funcion: compartir el codigo obligaria a
 * pasarle un flag diciendole si fallar lanzando o devolviendo, que es peor que
 * dos chequeos chicos escritos aparte. El unico caso donde este modulo lanza es
 * el que no puede evaluar (ver abajo).
 *
 * ## "Esta mal" y "no pude mirar" no se mezclan
 *
 * Con un id repetido en los saldos no se sabe cual de los dos saldos mueve una
 * transferencia, asi que no hay veredicto posible: eso lanza. Devolver
 * `cierra: false` lo haria indistinguible de un plan roto —y mandaria a
 * arreglar el minimizador cuando el problema esta en los saldos—, y
 * `cierra: true` seria directamente mentir.
 *
 * Los saldos que no suman cero **si** tienen veredicto: no hay ningun plan que
 * los deje en cero, asi que el plan no cierra, y se puede decir asi. Lo que el
 * mensaje aclara es que el problema es de los saldos, no del plan.
 *
 * ## Por que los specs de DOM-5 y DOM-6 no usan esto
 *
 * Siguen con su propio helper `aplicar`, a proposito. Si los tests del
 * minimizador verificaran sus planes con este modulo, dejarian de ser
 * independientes de lo que verifican: un error compartido —la convencion de
 * signo de una transferencia, por ejemplo— quedaria invisible en los dos lados
 * a la vez y los tests se confirmarian solos. Es el mismo motivo por el que
 * DOM-5 tiene un oraculo aparte para la optimalidad. La independencia cuesta
 * doce lineas duplicadas; recuperarla despues de perderla cuesta mucho mas.
 *
 * El verificador se prueba al reves, en `verificador_plan.spec.ts`: con planes
 * armados a mano, rotos de a una invariante por vez, contra el veredicto
 * esperado escrito al lado. Ahi el oraculo es la expectativa escrita, que es
 * independiente por construccion.
 */

/**
 * El veredicto. `cierra` es verdadero solo si no hay ningun problema, y
 * `problemas` dice cuales son, todos y en pesos — un "no cierra" pelado manda a
 * quien lee a recalcular a mano lo que el verificador ya sabe.
 */
export interface ResultadoVerificacion {
  cierra: boolean
  problemas: string[]
}

/**
 * Verifica las cuatro invariantes del plan sobre los saldos de los que salio.
 *
 * No modifica ni los saldos ni el plan. Lanza `RangeError` solo si los saldos
 * tienen ids repetidos, que es el caso que no se puede evaluar.
 */
export function verificarPlan(saldos: Saldo[], plan: Transferencia[]): ResultadoVerificacion {
  const pendientes = saldosPorIntegrante(saldos)
  const problemas: string[] = []

  // La suma de los saldos. Si no da cero no existe ningun plan interno que los
  // deje en cero, asi que el plan no cierra y el problema es de los saldos.
  const total = saldos.reduce((acc, s) => acc.plus(s.monto), Money.zero())
  if (!total.isZero()) {
    problemas.push(
      `Los saldos no suman cero: ${total.isNegative() ? 'faltan' : 'sobran'} ` +
        `$${(total.isNegative() ? total.negated() : total).toString()}. ` +
        `Ningun plan puede cerrar saldos que no cierran`
    )
  }

  // La cota n-1 cuenta los saldos **distintos de cero**, igual que
  // `LIMITE_EXACTO`: quien ya esta en cero no participa del plan, y contarlo
  // aflojaria la cota dejando pasar transferencias de mas.
  const activos = saldos.filter((s) => !s.monto.isZero()).length
  const cota = Math.max(0, activos - 1)
  if (plan.length > cota) {
    problemas.push(
      `El plan propone ${plan.length} transferencias y la cota es n-1 = ${cota}, ` +
        `con ${activos} saldos distintos de cero`
    )
  }

  for (const [indice, transferencia] of plan.entries()) {
    const posicion = `la transferencia ${indice + 1}`

    if (!transferencia.monto.isPositive()) {
      problemas.push(
        `El monto de ${posicion} no es positivo: $${transferencia.monto.toString()}. ` +
          `Una transferencia de cero no mueve nada y una negativa es una instruccion al reves`
      )
    }

    if (transferencia.de === transferencia.para) {
      problemas.push(
        `En ${posicion} "${transferencia.de}" se transfiere a si mismo, que no cierra nada`
      )
    }

    for (const integrante of [transferencia.de, transferencia.para]) {
      if (!pendientes.has(integrante)) {
        problemas.push(
          `En ${posicion} aparece "${integrante}", que no es del grupo: el plan estaria ` +
            `moviendo plata hacia afuera o desde afuera en vez de cerrarlo por dentro`
        )
      }
    }
  }

  // Aplicar el plan. Quien paga sube su saldo hacia cero y quien cobra lo baja.
  // Los integrantes de afuera del grupo ya quedaron reportados arriba y su
  // pierna no se aplica: inventarles un saldo haria que el total deje de
  // reflejar al grupo.
  for (const transferencia of plan) {
    const de = pendientes.get(transferencia.de)
    const para = pendientes.get(transferencia.para)
    if (de === undefined || para === undefined) continue

    pendientes.set(transferencia.de, de + transferencia.monto.cents)
    pendientes.set(transferencia.para, para - transferencia.monto.cents)
  }

  // Un solo problema con todos los que quedaron colgados, y no uno por cabeza:
  // un plan que no cierra suele dejar a varios, y la lista corta se lee de una.
  const sinCerrar = [...pendientes.entries()].filter(([, cents]) => cents !== 0)
  if (sinCerrar.length > 0) {
    const detalle = sinCerrar
      .map(
        ([integrante, cents]) => `"${integrante}" queda en $${Money.fromCents(cents).toString()}`
      )
      .join(', ')
    problemas.push(`Aplicar el plan no deja todos los saldos en cero: ${detalle}`)
  }

  return { cierra: problemas.length === 0, problemas }
}

/**
 * Los saldos indexados por integrante, en centavos, listos para aplicarles el
 * plan sin tocar la lista original.
 *
 * Aca esta el unico caso que no tiene veredicto: con un id repetido, una
 * transferencia a ese id es ambigua y cualquier respuesta seria inventada.
 */
function saldosPorIntegrante(saldos: Saldo[]): Map<IntegranteId, number> {
  const pendientes = new Map<IntegranteId, number>()
  for (const saldo of saldos) {
    if (pendientes.has(saldo.integrante)) {
      throw new RangeError(
        `El integrante "${saldo.integrante}" aparece repetido en los saldos; no se puede ` +
          `verificar un plan sobre un grupo con ids duplicados, porque no se sabe a cual de ` +
          `los dos saldos apunta cada transferencia`
      )
    }
    pendientes.set(saldo.integrante, saldo.monto.cents)
  }
  return pendientes
}
