import { Money } from '#domain/money'
import type { IntegranteId, Saldo } from '#domain/saldos'

/**
 * DOM-5 — Minimizador exacto de transferencias, para grupos de hasta 12
 * integrantes con saldo distinto de cero.
 *
 * El problema: dado el saldo neto de cada uno, encontrar el conjunto **mas
 * chico** de transferencias que deja a todos en cero. Es una variante de *cash
 * flow minimization* y el caso general es NP-duro — se reduce a particion de
 * conjuntos. Pero el tamaño real es chico, asi que se resuelve exacto en vez de
 * aproximar.
 *
 * La idea, en una linea: **cada subconjunto de personas cuyos saldos suman cero
 * se puede cerrar por separado**, con una transferencia menos que su cantidad
 * de integrantes. Entonces, si los n saldos no nulos se parten en g grupos que
 * suman cero cada uno, el plan tiene n - g transferencias. Minimizar las
 * transferencias es exactamente maximizar g.
 *
 * Por que n - g es optimo y no solo bueno: dentro de un grupo que suma cero y
 * no contiene ningun subgrupo propio que tambien sume cero, hacen falta al
 * menos k-1 transferencias, porque cada transferencia deja en cero a lo sumo a
 * una persona y la ultima queda en cero sola. Y un plan nunca puede unir
 * personas de grupos distintos sin desbalancear alguno. Asi que el optimo es la
 * particion con mas partes, que es lo que calcula `maximoDeGruposEnCero`.
 *
 * Con g = 1 el resultado es n-1, que es la cota que el Readme pide no superar
 * nunca: el peor caso del metodo exacto ya es el mejor caso garantizado.
 */

/**
 * Hasta cuantos saldos no nulos resuelve el metodo exacto.
 *
 * El costo es 3^n al recorrer todos los submascaras de cada mascara: con 12 son
 * ~531 mil pasos, instantaneo. Con 20 serian 3.400 millones. El limite no es
 * arbitrario ni "por las dudas" — es donde el algoritmo deja de terminar en un
 * tiempo razonable, y por eso existe DOM-6 con un greedy para los grupos mas
 * grandes.
 */
export const LIMITE_EXACTO = 12

/**
 * Una transferencia propuesta: quien le transfiere a quien y cuanto.
 *
 * Tiene los mismos tres campos que un `Pago` de DOM-4 y aun asi es un tipo
 * aparte, porque son cosas distintas: un pago es un hecho que ya ocurrio, una
 * transferencia es una propuesta que todavia no. Conviene tener presente que el
 * nombre distinto documenta la intencion pero no la protege: TypeScript es
 * estructural y los dos tipos son intercambiables para el compilador.
 */
export interface Transferencia {
  de: IntegranteId
  para: IntegranteId
  monto: Money
}

/**
 * Calcula el plan de cierre minimo.
 *
 * Devuelve las transferencias ordenadas de forma estable: por el grupo al que
 * pertenecen —en el orden en que aparece su primer integrante— y dentro de cada
 * grupo emparejando al que mas debe con al que mas le deben. Que sea estable
 * importa: un plan que cambia de orden entre dos lecturas de la misma pantalla
 * parece un plan distinto.
 */
export function minimizarExacto(saldos: Saldo[]): Transferencia[] {
  const activos = saldosActivos(saldos)
  if (activos.length === 0) return []

  if (activos.length > LIMITE_EXACTO) {
    throw new RangeError(
      `El metodo exacto resuelve hasta ${LIMITE_EXACTO} saldos distintos de cero y recibi ` +
        `${activos.length}; para grupos mas grandes va el minimizador greedy de DOM-6, que ` +
        `da un plan aproximado de a lo sumo n-1 transferencias`
    )
  }

  const montos = activos.map((s) => s.monto.cents)
  const grupos = particionEnGruposQueSumanCero(montos)

  return grupos.flatMap((grupo) => emparejarMayores(grupo.map((i) => activos[i])))
}

/**
 * DOM-6 — Calcula un plan de cierre **aproximado**, sin limite de tamaño.
 *
 * Emparejar iterativamente al que mas debe con al que mas le deben, hasta que
 * no quede nadie con saldo. Es exactamente lo que `minimizarExacto` hace
 * adentro de cada grupo de su particion; la diferencia —toda la diferencia—
 * es que aca no hay particion: el emparejamiento se aplica al grupo entero.
 *
 * Que garantiza:
 *
 *   1. **Nunca mas de n-1 transferencias**, con n los saldos no nulos. Cada
 *      transferencia mueve el minimo entre lo que uno debe y lo que al otro le
 *      deben, asi que deja en cero al menos a uno de los dos; la ultima deja a
 *      dos. Con n personas eso son a lo sumo n-1 pasos.
 *   2. **Aplicar el plan deja todos los saldos en cero**, porque el bucle no
 *      corta hasta que no queda ni un acreedor ni un deudor, y con la suma en
 *      cero esas dos condiciones se cumplen juntas.
 *
 * Que **no** garantiza: el optimo. El exacto parte el grupo en subconjuntos
 * que suman cero y los cierra aparte; el greedy puede emparejar a dos personas
 * de subconjuntos distintos y partir los dos al medio, gastando una
 * transferencia de mas. Hay un test que fija un caso asi a proposito
 * (`{+50, -50}` junto a `{+60, -30, -30}`: 3 contra 4), porque una
 * aproximacion que no esta documentada como aproximacion se lee como exacta.
 *
 * Por que no es "el exacto pero peor": para n > 12 el exacto no existe como
 * opcion —3^20 son 3.400 millones de pasos— asi que la comparacion real no es
 * contra el plan minimo sino contra no tener plan.
 */
export function minimizarGreedy(saldos: Saldo[]): Transferencia[] {
  return emparejarMayores(saldosActivos(saldos))
}

/**
 * Las dos puertas que comparten los dos minimizadores, y los saldos que
 * efectivamente participan.
 *
 * Un plan se arma sobre un grupo, no sobre una lista cualquiera: ids repetidos
 * harian que una misma persona figure dos veces con saldos distintos, y una
 * suma que no da cero no tiene ningun plan interno posible.
 */
function saldosActivos(saldos: Saldo[]): Saldo[] {
  const vistos = new Set<IntegranteId>()
  for (const saldo of saldos) {
    if (vistos.has(saldo.integrante)) {
      throw new RangeError(
        `El integrante "${saldo.integrante}" aparece repetido en los saldos; no se puede armar ` +
          `un plan sobre un grupo con ids duplicados`
      )
    }
    vistos.add(saldo.integrante)
  }

  // La suma tiene que ser cero exacto. El Readme hablaba de "tolerancia de
  // redondeo", pero eso era antes de que los montos fueran centavos enteros:
  // con enteros no hay redondeo que tolerar, y una tolerancia solo serviria
  // para tapar un bug de saldos. Si la suma no da cero, no existe ningun plan
  // interno que deje a todos en cero, y devolver uno igual seria mentir.
  const total = saldos.reduce((acc, s) => acc.plus(s.monto), Money.zero())
  if (!total.isZero()) {
    throw new RangeError(
      `Los saldos no suman cero: ${total.isNegative() ? 'faltan' : 'sobran'} ` +
        `$${(total.isNegative() ? total.negated() : total).toString()}. ` +
        `No hay plan de cierre posible sobre saldos que no cierran`
    )
  }

  // Quien ya esta en cero no participa: no debe ni le deben.
  return saldos.filter((s) => !s.monto.isZero())
}

/**
 * Parte los saldos en la **mayor cantidad posible** de grupos que suman cero.
 *
 * Programacion dinamica sobre mascaras de bits: `mejor[mascara]` es en cuantos
 * grupos que suman cero se puede partir ese subconjunto. Para cada mascara se
 * prueban todos sus submascaras que contengan al integrante de menor indice —
 * fijarlo evita contar la misma particion una vez por cada orden de sus partes.
 *
 * Siempre hay solucion para la mascara completa, porque el conjunto entero suma
 * cero: en el peor caso la particion es una sola parte y el plan sale de n-1.
 */
function particionEnGruposQueSumanCero(montos: number[]): number[][] {
  const n = montos.length
  const combinaciones = 1 << n

  const suma = new Array<number>(combinaciones).fill(0)
  for (let mascara = 1; mascara < combinaciones; mascara++) {
    const menor = mascara & -mascara
    suma[mascara] = suma[mascara ^ menor] + montos[Math.log2(menor)]
  }

  // -1 marca "esta mascara no se puede partir en grupos que sumen cero".
  const mejor = new Array<number>(combinaciones).fill(-1)
  const elegido = new Array<number>(combinaciones).fill(0)
  mejor[0] = 0

  for (let mascara = 1; mascara < combinaciones; mascara++) {
    const menor = mascara & -mascara

    // Recorre los submascaras de mascara que contienen al bit menor.
    for (let sub = mascara; sub > 0; sub = (sub - 1) & mascara) {
      if ((sub & menor) === 0) continue
      if (suma[sub] !== 0) continue

      const resto = mejor[mascara ^ sub]
      if (resto === -1) continue

      if (resto + 1 > mejor[mascara]) {
        mejor[mascara] = resto + 1
        elegido[mascara] = sub
      }
    }
  }

  // Por el camino publico esto no puede pasar: `minimizarExacto` ya verifico
  // que la suma sea cero, y entonces la mascara completa siempre tiene al menos
  // la particion de una sola parte. La guarda esta igual porque el modo de
  // falla sin ella no es un resultado raro: `elegido` queda en 0, el bucle de
  // abajo no avanza nunca y el proceso se muere por memoria. Medido, sacando la
  // puerta de suma cero a proposito. Colgarse es peor que fallar.
  if (mejor[combinaciones - 1] === -1) {
    throw new RangeError(
      'Los saldos no se pueden partir en grupos que sumen cero; esto solo pasa si la suma total ' +
        'no es cero, que se verifica antes de llegar aca'
    )
  }

  const grupos: number[][] = []
  for (let mascara = combinaciones - 1; mascara > 0; mascara ^= elegido[mascara]) {
    const sub = elegido[mascara]
    const integrantes: number[] = []
    for (let i = 0; i < n; i++) if (sub & (1 << i)) integrantes.push(i)
    grupos.push(integrantes)
  }

  // Los grupos salen de deshacer la mascara completa, que arranca por el bit
  // mas chico: quedan ordenados por su primer integrante sin tener que ordenar.
  return grupos
}

/**
 * Cierra un conjunto de saldos que suman cero, emparejando iterativamente al
 * que mas debe con al que mas le deben.
 *
 * **Su unica precondicion es que los saldos sumen cero.** No supone que el
 * conjunto sea indivisible ni que venga de una particion: los dos llamadores
 * —el exacto, que le pasa una parte, y el greedy, que le pasa el grupo
 * entero— le dan listas de origen distinto y la funcion no distingue. Los
 * saldos en cero que se le cuelen quedan afuera solos, porque no son ni
 * acreedores ni deudores.
 *
 * De ahi salen las dos garantias de las que vive DOM-6. Cada vuelta transfiere
 * el minimo entre las dos puntas, asi que deja en cero al menos a una persona
 * — **a lo sumo k-1 transferencias** para k saldos no nulos, y la ultima cierra
 * a dos. Y el bucle no corta hasta que no queda acreedor o no queda deudor:
 * con la suma en cero, no quedar uno implica no quedar el otro, de modo que
 * **todos terminan en cero**.
 *
 * Elegir las puntas mas grandes no cambia esa cuenta: cualquier emparejamiento
 * la cumple. Lo que cambia es que los montos mas grandes salen primero, que es
 * lo que una persona leeria como "lo importante arriba". El orden de entrada
 * desempata, para que dos saldos iguales no dependan de como ordene el motor.
 */
function emparejarMayores(grupo: Saldo[]): Transferencia[] {
  const pendientes = grupo.map((saldo, orden) => ({
    integrante: saldo.integrante,
    cents: saldo.monto.cents,
    orden,
  }))

  const transferencias: Transferencia[] = []

  while (true) {
    // Mayor acreedor y mayor deudor; el orden de entrada desempata, para que
    // dos saldos iguales no dependan de como ordene el motor.
    const acreedor = pendientes
      .filter((p) => p.cents > 0)
      .sort((a, b) => b.cents - a.cents || a.orden - b.orden)[0]
    const deudor = pendientes
      .filter((p) => p.cents < 0)
      .sort((a, b) => a.cents - b.cents || a.orden - b.orden)[0]

    if (!acreedor || !deudor) break

    const monto = Math.min(acreedor.cents, -deudor.cents)
    transferencias.push({
      de: deudor.integrante,
      para: acreedor.integrante,
      monto: Money.fromCents(monto),
    })

    acreedor.cents -= monto
    deudor.cents += monto
  }

  return transferencias
}
