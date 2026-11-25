# Vaquita

Gastos compartidos. El núcleo es calcular el conjunto mínimo de transferencias
que deja en cero los saldos de un grupo. **No mueve dinero: emite instrucciones
de pago.**

Proyecto final del máster LIDR AI4Devs. El estado entre sesiones vive en
`HANDOFF.md` (no versionado): **leerlo antes que nada.**

## Las cuatro reglas que no se negocian

**1. El dinero son centavos enteros.** `Money` (`backend/app/domain/money.ts`)
se construye desde centavos o desde texto, nunca desde un float. No hay camino
público desde un `number` decimal, y no se agrega uno. Los montos viajan por HTTP
con sufijo `_cents` para que ningún cliente los lea como decimales.

**2. `backend/app/domain/` no importa nada del framework.** Ni controladores, ni
Lucid, ni `@adonisjs/*`. Es código puro: por eso 139 tests de dominio corren sin
levantar base ni servidor. Si algo del dominio necesita la base, está mal
ubicado.

**3. El acceso a datos va por `backend/app/repositories/` con `db.rawQuery`.**
No hay modelos Lucid, con **una sola excepción**: `app/models/user.ts`, que
existe únicamente porque `@adonisjs/auth` necesita un `BaseModel` del que
agarrarse. Esa excepción no se extiende. Los `BIGINT` que `pg` devuelve como
string se convierten con `centsDe()` de `app/repositories/cents.ts`, nunca con
`+valor`.

**4. Las invariantes de dinero viven en la base.** `CHECK`, `UNIQUE` y FK
compuestas `(id, group_id)` para que nada cruce de un grupo a otro. Una
restricción que se puede expresar en el esquema no se delega a la aplicación.

## El método

Por cada ticket, en este orden:

1. **Tests primero.** El test es la especificación.
2. Implementación.
3. **Mutantes**: romper el código a propósito y verificar que algún test lo
   acusa. Tres veredictos, nunca dos: **MUERE / SOBREVIVE / NO-PUDE-MIRAR**.

Dos cosas que ya costaron caro y no hace falta volver a aprender:

- El veredicto se lee de la salida (`PASSED` / `FAILED` / `NO TESTS EXECUTED`),
  **nunca del exit code**: `node ace test --groups` devuelve 1 aunque pase todo.
- Cada mutante se verifica como aplicado releyendo el archivo del disco. Un
  patrón puede haber pegado en un comentario en vez de en el código.

**Un mutante que sobrevive se mide antes de arreglar nada.** Si el mutante nunca
se dispara con los datos del test, no es un hueco de cobertura: es un mutante
muerto de nacimiento.

**El oráculo nunca es el código bajo prueba.** Si un test verifica un plan con la
misma función que lo construyó, un error compartido queda invisible de los dos
lados.

## Convenciones

- Código, comentarios, commits y documentación **en español**. Sin tildes en
  identificadores.
- Los comentarios explican **por qué**, no qué. Lo que el código ya dice es
  ruido.
- Validación de entrada HTTP con **VineJS** (forma de los datos). La salida del
  LLM se valida aparte con **Zod** (`app/ingesta/`), porque ahí lo que se parsea
  es JSON hostil y hace falta un `safeParse` inspeccionable, no una excepción.
- Forma única de error: `{ errors: [{ rule?, field?, message }] }`.
- Un no integrante de un grupo recibe **404, no 403**: un 403 confirmaría que el
  grupo existe. Falta de **rol**, en cambio, sí es 403.

## Comandos

```
docker compose up -d           # Postgres 17, puerto 5433 (no 5432, a propósito)
node ace serve --hmr           # desarrollo. NO `node bin/server.js`, que es el build
node ace test unit             # dominio, sin infraestructura
node ace test database         # esquema, contra Postgres
node ace test functional       # extremo a extremo, levanta servidor
node ace db:seed               # grupo de prueba reproducible, ids fijos
npm run lint && npm run typecheck
```

`node ace configure <paquete>` **auto-responde "no" sin tty** y no escribe nada.
Hay que pasarle `--install=false`, que pese al nombre instala y escribe todo. El
mismo problema tiene `migration:run` en producción, que sin `--force` se cancela
solo.

## Cuidado con esto

- La cuenta de `gh` se cambia sola entre `lisandroarguello` (la del máster) y
  `lisandromartin-newsoft` (trabajo). Verificar con `gh auth status` antes de
  cualquier operación sobre el repo.
- `backend/.env` tiene una `APP_KEY` generada localmente y está en `.gitignore`.
  No se commitea.
- Las semillas usan datos **generados, nunca reales**.
