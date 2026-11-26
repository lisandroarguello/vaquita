/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

const GroupsController = () => import('#controllers/groups_controller')
const AuthController = () => import('#controllers/auth_controller')
const MembershipsController = () => import('#controllers/memberships_controller')
const ExpensesController = () => import('#controllers/expenses_controller')

router.get('/', async () => {
  return { name: 'vaquita', status: 'ok' }
})

/**
 * Todo bajo `/api/v1`, como fija la seccion 7 del Readme. Los montos viajan
 * siempre en centavos enteros, con el sufijo `_cents` en el nombre del campo.
 */
router
  .group(() => {
    // Las dos unicas rutas abiertas de la API: son las que crean la sesion.
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
        router.get('/balances', [GroupsController, 'balances'])
        router.get('/settlement', [GroupsController, 'settlement'])
      })
      .prefix('/groups/:id')
      .use([middleware.auth(), middleware.miembro()])
  })
  .prefix('/api/v1')
