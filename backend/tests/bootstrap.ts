import { assert } from '@japa/assert'
import { apiClient } from '@japa/api-client'
import app from '@adonisjs/core/services/app'
import type { Config } from '@japa/runner/types'
import { pluginAdonisJS } from '@japa/plugin-adonisjs'
import testUtils from '@adonisjs/core/services/test_utils'

/**
 * This file is imported by the "bin/test.ts" entrypoint file
 */

/**
 * Configure Japa plugins in the plugins array.
 * Learn more - https://japa.dev/docs/runner-config#plugins-optional
 */
export const plugins: Config['plugins'] = [assert(), apiClient(), pluginAdonisJS(app)]

/**
 * Configure lifecycle function to run before and after all the
 * tests.
 *
 * The setup functions are executed before all the tests
 * The teardown functions are executed after all the tests
 */
export const runnerHooks: Required<Pick<Config, 'setup' | 'teardown'>> = {
  setup: [],
  teardown: [],
}

/**
 * Configure suites by tapping into the test suite instance.
 * Learn more - https://japa.dev/docs/test-suites#lifecycle-hooks
 */
export const configureSuite: Config['configureSuite'] = (suite) => {
  if (['browser', 'functional', 'e2e'].includes(suite.name)) {
    /**
     * La suite funcional necesita las dos cosas: el servidor HTTP y la base,
     * porque prueba el camino entero —ruta, repositorio, dominio— y no una
     * pieza sola. Es lo que el curso llama "al menos una funcionalidad de
     * extremo a extremo".
     */
    return suite.setup(async () => {
      const bajarBase = await testUtils.db().migrate()
      const bajarServidor = await testUtils.httpServer().start()
      return async () => {
        await bajarServidor()
        await bajarBase()
      }
    })
  }

  /**
   * La suite de base corre las migraciones antes de todo y las revierte al
   * final, contra el Postgres del `docker-compose.yml`. No levanta servidor
   * HTTP: lo que se esta probando es el esquema, no la aplicacion.
   */
  if (suite.name === 'database') {
    return suite.setup(() => testUtils.db().migrate())
  }
}
