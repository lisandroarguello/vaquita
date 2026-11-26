/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import router from '@adonisjs/core/services/router'
import app from '@adonisjs/core/services/app'
import { existsSync } from 'node:fs'
import { middleware } from '#start/kernel'

const GroupsController = () => import('#controllers/groups_controller')
const AuthController = () => import('#controllers/auth_controller')
const MembershipsController = () => import('#controllers/memberships_controller')
const ExpensesController = () => import('#controllers/expenses_controller')
const PaymentsController = () => import('#controllers/payments_controller')

/**
 * Todo bajo `/api/v1`, como fija la seccion 7 del Readme. Los montos viajan
 * siempre en centavos enteros, con el sufijo `_cents` en el nombre del campo.
 */
router
  .group(() => {
    // El estado del servicio vive bajo `/api` y no en `/`, porque `/` ahora
    // devuelve la pagina del frontend.
    router.get('/health', async () => ({ name: 'vaquita', status: 'ok' }))

    // Las dos unicas rutas abiertas que tocan datos: son las que crean la sesion.
    router.post('/auth/signup', [AuthController, 'signup'])
    router.post('/auth/login', [AuthController, 'login'])

    router.post('/auth/logout', [AuthController, 'logout']).use(middleware.auth())
    router.get('/me', [AuthController, 'me']).use(middleware.auth())

    /**
     * Grupos sin `:id`: todavia no hay grupo del que ser integrante, asi que
     * llevan `auth` y nada mas. No pueden entrar en el grupo de abajo.
     */
    router.get('/groups', [GroupsController, 'index']).use(middleware.auth())
    router.post('/groups', [GroupsController, 'store']).use(middleware.auth())

    /**
     * API-8 — todo lo que cuelga de `/groups/:id` exige sesion **y** ser
     * integrante activo del grupo.
     *
     * El middleware va en el **grupo de rutas**, no en cada accion, y eso es la
     * decision: una ruta nueva bajo `/groups/:id/` queda protegida sin que nadie
     * se acuerde de protegerla. Olvidarse un middleware en una ruta nueva no
     * rompe ningun test —la ruta funciona, solo que para cualquiera— y es
     * exactamente la clase de agujero que nadie encuentra leyendo.
     *
     * Las rutas de grupos que **no** llevan `:id` (listar los grupos propios,
     * crear uno) no entran acá: todavia no hay grupo del que ser integrante.
     * Van en API-2, con `middleware.auth()` solo.
     */
    router
      .group(() => {
        router.get('/', [GroupsController, 'show'])
        router.patch('/', [GroupsController, 'update'])
        router.post('/members', [MembershipsController, 'store'])
        router.patch('/members/:mid', [MembershipsController, 'update'])
        router.get('/expenses', [ExpensesController, 'index'])
        router.post('/expenses', [ExpensesController, 'store'])
        router.patch('/expenses/:eid', [ExpensesController, 'update'])
        router.delete('/expenses/:eid', [ExpensesController, 'destroy'])
        router.post('/payments', [PaymentsController, 'store'])
        router.get('/balances', [GroupsController, 'balances'])
        router.get('/settlement', [GroupsController, 'settlement'])
      })
      .prefix('/groups/:id')
      .use([middleware.auth(), middleware.miembro()])
  })
  .prefix('/api/v1')

/**
 * El comodin del frontend: un solo servicio para desplegar, cero CORS.
 *
 * Vite deja su build en `backend/public` (`frontend/vite.config.ts`), y
 * `@adonisjs/static` sirve de ahi los archivos que existen. Lo que no existe
 * como archivo —`/grupos/abc`, que es una ruta del router del navegador— cae
 * aca y recibe el `index.html`, para que React decida que dibujar. Sin esto,
 * recargar la pagina en cualquier pantalla que no sea la raiz da el 404 del
 * backend.
 *
 * Va **al final** y pregunta explicitamente por `/api`: el comodin de Adonis no
 * distingue prefijos, asi que sin esa pregunta un endpoint mal escrito
 * devolveria la pagina con estado 200 y el `fetch` del cliente fallaria
 * parseando HTML en lugar de recibir el 404 que le corresponde.
 */
router.get('*', async ({ request, response }) => {
  if (request.url().startsWith('/api')) {
    return response.notFound({
      errors: [{ rule: 'not_found', message: 'Ese endpoint no existe' }],
    })
  }

  const pagina = app.publicPath('index.html')
  if (!existsSync(pagina)) {
    // 503 y no 404: la ruta es correcta y lo que falta es el build del
    // frontend. Un 404 manda a buscar el error en el lugar equivocado.
    return response.serviceUnavailable({
      errors: [
        {
          rule: 'frontend_sin_build',
          message: 'El frontend no esta construido: corre `npm run build` en frontend/',
        },
      ],
    })
  }

  return response.download(pagina)
})
