# Prompts — Vaquita

Registro de los prompts usados para producir la documentacion tecnica de la
Entrega 1. El criterio del registro: no se transcribe cada mensaje, se registra
**cada prompt que cambio el resultado**, junto con que devolvio y que hubo que
corregir a mano.

Herramienta: Claude Code (Opus) sobre el repositorio.

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
en la seccion 7 del README.

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

**Que cambio.** Agregue la seccion 6.bis completa con los endpoints y las dos
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
