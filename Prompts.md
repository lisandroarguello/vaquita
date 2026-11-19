# Prompts — Vaquita

Registro de los prompts usados para producir la documentacion tecnica de la
Entrega 1. El criterio del registro: no se transcribe cada mensaje, se registra
**cada prompt que cambio el resultado**, junto con que devolvio y que hubo que
corregir a mano.

---

## 0. Herramientas, modelos y contexto

### Herramientas y modelos

| Fase | Herramienta | Modelo | Para que |
|---|---|---|---|
| Analisis y diseño | Claude Code | Opus | Definir el problema, discutir alcance, revision adversarial |
| Documentacion | Claude Code | Opus | Redactar Readme y Prompts, diagramas Mermaid |
| Implementacion | Claude Code | Opus | Dominio y esquema, con tests antes que el codigo |
| Pruebas | Claude Code | Opus | Tests de propiedad, oraculos independientes y mutantes |
| Despliegue | — | — | Opcional segun las reglas del curso; sin decidir |
| Mantenimiento | — | — | Fuera del alcance del MVP |

La Entrega 1 es documentacion, asi que ese trabajo cae en analisis, diseño y
documentacion. La Entrega 2 agrega implementacion y pruebas, registradas en la
Parte II de este documento.

### Contexto avanzado

**`CLAUDE.md` global de usuario.** Hay un archivo de instrucciones permanentes
en `~/.claude/CLAUDE.md` que aplica a todos los proyectos y que moldeo como se
escribio esta documentacion mas que cualquier prompt individual. Las reglas que
dejaron marca visible en el resultado:

- *"Una decision sin un numero no es una decision: es un miedo."* Es la razon de
  que la seccion 3.1 compare el conteo de transferencias contra la cota `n-1` en
  vez de afirmar que el algoritmo "es eficiente", y de que la decision de no
  materializar saldos (5.2) quede condicionada a un perfilado que todavia no se
  hizo.
- *"Nunca inventar el motivo."* De ahi que los supuestos esten marcados como
  supuestos — el stack de la seccion 9 es el caso mas claro — en lugar de
  presentarse como decisiones cerradas.
- *"Un chequeo que acusa lo que estaba bien se apaga a la semana."* Es el origen
  de la distincion, en la seccion 7, entre invariante violada (`500` con detalle
  y sin plan) y ausencia de datos.

**Documento de traspaso entre sesiones.** El trabajo se hizo en varias sesiones.
El estado vive en un `HANDOFF.md` excluido del control de versiones via
`.git/info/exclude`, para que el contexto sobreviva al cierre de una sesion sin
ensuciar la rama de entrega.

**Sin `CLAUDE.md` de proyecto ni skills propias todavia.** No hay un `.claude/`
en el repositorio. La regla de que `app/domain/` no importe nada del framework
(seccion 5.4) sigue siendo exactamente el tipo de regla que conviene volver un
chequeo ejecutable y no una linea de documentacion que nadie corre: hoy se
sostiene sola porque el dominio se escribio antes que cualquier ruta HTTP, pero
nada la verifica.

**Skills, subagentes y MCP: lo que efectivamente se uso.** Este bloque quedo
pendiente en la Entrega 1 y se cerro revisando los transcripts de las cinco
sesiones de trabajo, no de memoria.

- **Skills: una, `built-in-browser`**, para leer la plataforma del curso —el feed
  y la Leccion 1— cuando se fijaron el alcance y las fechas de entrega. Es la
  unica que toco este proyecto. En el mismo directorio de sesiones aparece
  tambien `diseno-con-mockups`, pero pertenece al trabajo de FlowSync de
  septiembre y **no** a Vaquita; se aclara para no inflar el registro.
- **Subagentes: ninguno, en ninguna sesion.** El trabajo es de un solo hilo, y
  los tickets son chicos y secuenciales: delegar habria costado mas contexto del
  que ahorraba.
- **MCP: cuatro servidores**, todos para traer informacion de afuera y ninguno
  para escribir codigo — navegador (plataforma del curso), Notion (la pagina del
  proyecto), Gmail y Calendar (las fechas de entrega, que es lo que destrabo la
  planificacion). Se consulto tambien **Graphify**, que no tiene este repositorio
  indexado; eso se dijo en una linea y se siguio con lectura directa.
- **System prompts: el `CLAUDE.md` global de arriba.** No hay `CLAUDE.md` de
  proyecto ni skills propias todavia.

---

# Parte I — Entrega 1: documentacion

## Mapa: que prompt produjo que seccion

| Prompt | Seccion del Readme |
|---|---|
| 1. Eleccion del dominio | 0, 1 |
| 2. Afilar el problema | 1, 2 |
| 3. Algoritmo de minimizacion | 3.1 |
| 4. Aritmetica de dinero | 3.2 |
| 5. Historias de usuario | 4 |
| 6. Ingesta con LLM | 3.3, 5.1 |
| 7. Modelo de datos | 6 |
| 8. Revision adversarial | 7, 8 |

---

## 1. Eleccion del dominio y del problema

**Prompt**

> Necesito una idea de proyecto fintech para un MVP de tres semanas, de un solo
> desarrollador. Que tenga un nucleo tecnico genuinamente interesante — no un CRUD
> con formularios — pero que no requiera licencia financiera ni custodia de fondos.
> Proponeme tres y decime cual elegirias y por que.

**Que devolvio.** Tres candidatas: un comparador de costos de credito, un simulador
de inversiones, y la division de gastos grupales con cierre optimizado.

**Que cambio.** La tercera fue la elegida por una razon concreta: es la unica donde
el nucleo tecnico no es una integracion con un tercero sino un problema propio
— minimizar transferencias — que se puede implementar, testear y defender sin
depender de ninguna API externa. Las otras dos, sin la integracion, son maquetas.

**Correccion manual.** La propuesta original incluia billetera interna con saldo.
Lo saque: tener custodia de fondos convierte el proyecto en un producto regulado
y no agrega nada al problema interesante. Quedo documentado como decision explicita
en la seccion 8 del README.

---

## 2. Afilar el problema antes de escribir una linea de solucion

**Prompt**

> Antes de diseñar nada: describime el problema real de dividir gastos en un grupo
> de 6 personas en un viaje de 5 dias. Que es lo que hace que la planilla quede a
> medias? Quiero el motivo de friccion concreto, no la descripcion generica.

**Que devolvio.** Tres puntos de friccion: la carga manual, las divisiones
desparejas, y la cantidad de transferencias al cerrar.

**Que cambio.** El tercero resulto ser el que define el producto. Un grupo de 6 con
saldos cruzados puede necesitar hasta 15 transferencias si se resuelve de a pares,
y el minimo real suele ser 3. Esa diferencia es el producto entero, y es lo que
despues se expuso como `naive_transfer_count` en la API para que sea visible.

**Correccion manual.** Ninguna. Este prompt definio el foco del resto del trabajo.

---

## 3. El algoritmo de minimizacion

**Prompt**

> Dado un vector de saldos netos que suma cero, quiero el conjunto minimo de
> transferencias que lleva a todos a cero. Decime cual es la complejidad real del
> problema, si tiene nombre conocido, y que algoritmo conviene para n <= 15.
> Si la solucion optima es intratable, decimelo en vez de inventar un greedy y
> presentarlo como optimo.

**Que devolvio.** Que es una variante de *cash flow minimization*, NP-dura en el
caso general por reduccion a particion de conjuntos, y que para n chico conviene
buscar subconjuntos que suman cero y resolverlos por separado.

**Que cambio.** El diseño quedo en dos ramas: exacto para n <= 12, greedy con cota
n-1 para grupos mas grandes. Eso es DOM-5 y DOM-6 en los tickets.

**Correccion manual.** La primera version proponia solo el greedy y lo describia
como "optimo". No lo es — el greedy de mayor acreedor contra mayor deudor puede dar
mas transferencias que el minimo. El prompt pedia explicitamente que no pasara eso,
y pasó igual. Lo corregi y de ahi salio la invariante verificable: el sistema
comprueba que aplicar el plan deje todo en cero, y si no, no muestra plan.

> **Nota.** Este es el punto donde el modelo fue menos confiable y mas convincente
> a la vez. Un algoritmo descripto con seguridad y etiquetado como optimo, que no
> lo era. Haber pedido la complejidad de forma explicita fue lo que lo expuso.

---

## 4. Aritmetica de dinero

**Prompt**

> Como se reparte $100 entre 3 personas sin que se pierda ni se invente un centavo?
> Quiero la regla exacta de asignacion del resto y la invariante que tengo que
> verificar en los tests.

**Que devolvio.** Enteros en centavos, division entera, y el resto distribuido a
los primeros `resto` participantes en un orden estable.

**Que cambio.** Quedo como requisito de modelo de datos (`BIGINT` en vez de
`DECIMAL` o `FLOAT`) y como criterio de aceptacion literal de HU-2: $100 entre 3
da 3334/3333/3333.

**Correccion manual.** Agregue "ordenados por su id" a la regla. Sin un orden
estable, el mismo gasto repartido dos veces puede dar resultados distintos, y
entonces editar un gasto cambia saldos sin que nadie haya tocado el monto.

---

## 5. Historias de usuario y criterios de aceptacion

**Prompt**

> Convertí el alcance del MVP en historias de usuario con formato Como/Quiero/Para,
> reglas de negocio y criterios de aceptacion en Dado/Cuando/Entonces. Cada criterio
> tiene que ser verificable por alguien que no escribio el codigo. Nada de
> "el sistema funciona correctamente".

**Que devolvio.** Las cinco historias con su estructura completa.

**Que cambio.** Es el grueso de la seccion 4 del README.

**Correccion manual.** Varios criterios volvieron con formulaciones del estilo
"el sistema maneja el error apropiadamente". Los reescribi uno por uno con el
resultado observable concreto. Tambien agregue los casos de borde que no habian
salido solos: el gasto anulado que sigue en el historial, el destinatario sin alias
cargado, y el grupo que llego al limite de 15 integrantes.

---

## 6. Diseño de la ingesta con LLM

**Prompt**

> El sistema extrae gastos de texto pegado y de fotos de tickets usando un LLM.
> Diseñá esa parte asumiendo que el modelo se equivoca, que a veces no responde,
> y que los datos que recibe son sensibles. Quiero que el resto del sistema no
> dependa de que el LLM ande.

**Que devolvio.** El patron de borrador, los niveles de confianza por campo, el
timeout con degradacion a carga manual, y la validacion contra esquema.

**Que cambio.** Es la seccion 3.3 y los tickets ING-1 a ING-7.

**Correccion manual.** Agregue ING-7, el filtro de datos sensibles. El diseño
original mandaba el contenido del ticket completo al proveedor del modelo. Un
ticket puede traer los ultimos digitos de una tarjeta, y un mensaje bancario
pegado puede traer un CBU entero. Eso no sale del sistema.

---

## 7. Modelo de datos

**Prompt**

> Diseñá el esquema relacional. Antes de darme las tablas, decime que NO conviene
> modelar como entidad y por que.

**Que devolvio.** La observacion de que las deudas no son una entidad sino una
consecuencia de gastos y pagos, y que modelarlas obliga a mantenerlas
sincronizadas con su propia fuente de verdad.

**Que cambio.** No hay tabla de deudas ni de saldos. Los saldos se calculan en cada
lectura. Esta justificado en 5.2 con la condicion de cuando habria que revisarlo:
despues de medir, no antes.

**Correccion manual.** Agregue el trigger de DAT-2. El modelo confiaba en que el
codigo de aplicacion mantuviera la suma de `expense_shares` igual al monto del
gasto. Esa invariante es demasiado importante para vivir solo en una capa.

---

## 8. Revision adversarial del documento

**Prompt**

> Leé el README como si fueras el evaluador. Tu trabajo es encontrar donde el
> documento promete algo que no esta especificado, o afirma algo que no se sostiene.
> No me digas que esta bien. Decime los tres puntos mas debiles.

**Que devolvio.** Tres: (1) la especificacion de API no estaba, solo aparecia
mencionada en los tickets; (2) no se decia que pasa cuando la verificacion de
invariantes falla — solo que se verifica; (3) no habia nada sobre el manejo de la
moneda en un grupo donde alguien paga en otra divisa.

**Que cambio.** Agregue la seccion 7 completa con los endpoints y las dos
respuestas que importan. Agregue el comportamiento explicito ante invariante
violada: `500` con detalle y sin plan. Y la multi-moneda quedo listada
explicitamente como fuera de alcance, que es distinto de no haberla pensado.

---

## Lo que aprendi de este ciclo

**El prompt que mas valor produjo fue el adversarial.** Pedir "encontrá los tres
puntos mas debiles" devolvio dos huecos reales que ocho prompts constructivos no
habian encontrado. El modelo, preguntado en modo de construccion, tiende a
completar; preguntado en modo de critica, encuentra.

**El error mas peligroso fue el del punto 3**, y no porque fuera grande: porque
venia bien escrito. Un greedy presentado como optimo, con lenguaje seguro y sin
ninguna señal de duda. Lo que lo expuso no fue leer con atencion — fue haber
pedido de antemano la complejidad del problema, que es un dato verificable contra
literatura, y no una opinion.

**La correccion que mas cambio el diseño fue la mas chica**: agregar "ordenados por
su id" a la regla del centavo sobrante. Dos palabras que son la diferencia entre
un reparto determinista y uno que cambia los saldos cada vez que alguien edita un
gasto.

---

# Parte II — Entrega 2: implementacion

Mismo criterio de registro: no se transcribe cada mensaje, se registra cada
prompt que cambio el resultado, con que devolvio y que hubo que corregir.

## Como fueron los prompts de esta parte, y por que

Lo primero que se nota al ponerlos uno al lado del otro es que **se fueron
achicando**. El de DOM-4 tiene diez lineas; el de DAT-1 es *"arranca con
DAT-1"*. No es que el trabajo se volviera mas facil: el metodo se mudo al
`HANDOFF.md`, que cada sesion lee antes de tocar nada. El prompt dejo de llevar
las reglas y paso a llevar solo lo propio del ticket.

Lo que si crecio fue la **lista de cosas que ya salieron mal** — de cinco a
doce. Esa lista es el verdadero prompt de este proyecto: cada entrada es un
error que costo caro una vez y que vuelve a estar a mano la proxima.

El prompt de DOM-7, el mas largo de la Entrega 2, muestra la forma completa:

> Arranca con DOM-7, el verificador de invariantes del plan: dado un plan y los
> saldos de los que salio, decir si cierra. [...]
>
> **Esto NO se escribe de cero:** la verificacion ya existe repartida en tres
> lados. [...] Mira los tres y decidi que se extrae y que no mirando el codigo,
> no asumiendo.
>
> **El riesgo propio de este ticket:** si el verificador termina siendo el mismo
> codigo que los tests usan para chequear los planes, los tests dejan de ser
> independientes de lo que verifican y pasan a confirmarse solos. [...] Decidi
> si los specs pasan a usar el verificador o se quedan con su helper, y escribi
> por que.
>
> Sosten el metodo: tests antes que la implementacion, y despues mutantes sobre
> lo escrito.

Tiene las tres partes que dieron resultado cada vez: **que hacer**, **que mirar
antes de decidir** (y la orden explicita de mirar el codigo y no suponer), y
**cual es el riesgo propio de este ticket** — el que no se ve desde el enunciado.
Nombrar el riesgo de antemano es lo que convierte una decision de diseño en algo
que se defiende, en vez de algo que se descubre cuando ya esta escrito.

## El metodo: tests primero, y despues romper el codigo a proposito

Todos los tickets siguieron el mismo ciclo: escribir los tests, escribir la
implementacion, y despues **mutantes** — romper la implementacion a proposito y
verificar que los tests se den cuenta. No es ceremonia: **en los ocho tickets
encontro algo cada vez**.

| Ticket | Que devolvio el primer intento | Que hubo que corregir |
|---|---|---|
| DOM-1 `Money` | Centavos enteros, sin via publica desde `float` | Una asercion no verificaba lo que parecia verificar |
| DOM-2 Reparto igual | Reparto con resto determinista | El verde no cubria montos negativos, donde `Math.floor` le cambia el signo al resto. Se agrego el parametro `desde`, que no pedia el ticket: sin el, el centavo que sobra cae siempre en la misma persona |
| DOM-3 Exactos y % | Las dos formas de reparto | Reusar el parser de montos para porcentajes heredo una regla ajena: rechazaba "33.333" por ambiguo. Parser propio |
| DOM-4 Saldos | Suma cero con test de propiedad | El arnes de mutantes estaba mintiendo (ver abajo) |
| DOM-5 Minimizador exacto | DP sobre mascaras de bits | El test de propiedad era **vacuo**: los subconjuntos que suman cero no aparecen por azar, asi que los 400 casos no ejercitaban nada. Hubo que plantar la estructura y contarla |
| DOM-6 Greedy | Emparejar mayor acreedor con mayor deudor | El desempate entre dos **deudores** iguales no lo verificaba nadie |
| DOM-7 Verificador | `{ cierra, problemas }` sobre cualquier plan | Dos huecos reales: la palabra `faltan`/`sobran` no la verificaba nadie, y la membresia se chequeaba solo del lado del que paga |
| DAT-1 Esquema | Siete tablas con claves, indices y `CHECK` | Un mutante sobrevivia **sin llegar a dispararse**: el test repetia el mismo monto, asi que una unicidad de mas rechazaba igual la fila |

## Lo que aprendi de este ciclo

**El arnes de mutantes mintio tres veces, y las tres se leian como buenas
noticias.** `node ace test --groups` sale con codigo 1 aunque todo pase, asi que
un arnes que lee el exit code marca todos los mutantes como muertos. `--files
minimizador.spec` corre cero tests e imprime `NO TESTS EXECUTED`, que un arnes
que solo busca `FAILED` cuenta como sobreviviente. Y una sustitucion de varias
lineas que no matcheaba dejaba el codigo **sin mutar**, y el verde se leia como
"el mutante sobrevive" — la conclusion exactamente contraria.

De ahi salio la regla que sostiene todo lo demas: **tres veredictos y no dos**.
Muere, sobrevive, y **no pude mirar**. Un chequeo que no distingue "esta mal" de
"no pude mirar" muestra lo segundo como "todo bien", y entonces no esta
chequeando nada.

**Un mutante que sobrevive no siempre es un hueco del test.** Paso dos veces, y
las dos la lectura facil era la equivocada. En DOM-6 un mutante que topeaba cada
transferencia a $5000 sobrevivia porque el generador nunca producia montos mas
altos: el tope **nunca llegaba a atar**. En DAT-1, una unicidad de mas rechazaba
igual la fila porque el test repetia el mismo monto. En los dos casos la regla
fue la misma: antes de arreglar un test, verificar que el mutante cambie el
comportamiento **sobre los datos que el test genera de verdad**.

**Comparar una implementacion contra si misma no prueba nada.** En DOM-5 el
optimo se verifica contra un oraculo escrito a proposito distinto —enumeracion
recursiva de particiones contra DP sobre mascaras—, y en DOM-7 los specs del
minimizador se **quedaron con su helper duplicado** en vez de usar el
verificador nuevo, para no perder esa independencia. Eso se decidio por escrito
y despues se **midio**: el mutante que da vuelta `faltan`/`sobran` muere en los
specs del minimizador y sobrevive en el del verificador, que es la prueba de que
los dos no comparten codigo. Una decision de diseño afirmada en un docstring y
una medida no son lo mismo.

**Lo que mas rindio de todo fue un archivo que no esta versionado.** El
`HANDOFF.md` arranco como una nota de traspaso entre sesiones y termino siendo
el que sostiene el metodo: el estado, los comandos, y sobre todo la lista de
doce cosas que ya salieron mal. Sin el, cada sesion nueva vuelve a tropezar con
el exit code de `--groups`.
