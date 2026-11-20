/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import router from '@adonisjs/core/services/router'

const GroupsController = () => import('#controllers/groups_controller')

router.get('/', async () => {
  return { name: 'vaquita', status: 'ok' }
})

/**
 * Todo bajo `/api/v1`, como fija la seccion 7 del Readme. Los montos viajan
 * siempre en centavos enteros, con el sufijo `_cents` en el nombre del campo.
 */
router
  .group(() => {
    router.get('/groups/:id/balances', [GroupsController, 'balances'])
    router.get('/groups/:id/settlement', [GroupsController, 'settlement'])
  })
  .prefix('/api/v1')
