import { describe, expect, test } from 'vitest'
import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../src/App'
import { CLAVE } from '../src/auth/token'
import { USUARIO, instalarBackend, montar, respuestaDemorada } from './ayudas'
import type { Manejador } from './ayudas'

/**
 * FE-3 — la vista de un grupo con saldos. Criterio de hecho: **signo legible
 * sin depender solo del color.**
 *
 * Y una regla que no sale del ticket sino del backend: el docstring de
 * `GET /balances` dice que `sums_to_zero` no es decorativo, que es la invariante
 * de DOM-4 expuesta, y que **si llega en `false` el cliente no muestra saldos,
 * muestra un error**. Saldos que no suman cero significan que falta o sobra
 * plata en el grupo: mostrarlos es invitar a cerrar la vaquita con numeros que
 * no cierran, y eso termina en una transferencia de verdad por un monto
 * equivocado.
 */

const ID = '22222222-2222-4222-8222-222222222222'
const MI_MEMBRESIA = 'aaaa1111-1111-4111-8111-111111111111'

const DETALLE = {
  group: {
    id: ID,
    name: 'Finde en la costa',
    currency: 'ARS',
    status: 'open',
    my_membership_id: MI_MEMBRESIA,
    my_role: 'admin',
  },
  members: [
    { id: MI_MEMBRESIA, display_name: 'Ana', role: 'admin', payout_alias: 'ana.mp', active: true },
    { id: 'bbbb2222-2222-4222-8222-222222222222', display_name: 'Bruno', role: 'member', payout_alias: null, active: true },
    { id: 'cccc3333-3333-4333-8333-333333333333', display_name: 'Caro', role: 'member', payout_alias: null, active: true },
  ],
  totals: { expense_count: 3, expense_total_cents: 4500000, payment_count: 1 },
}

const BALANCES = {
  currency: 'ARS',
  my_membership_id: MI_MEMBRESIA,
  balances: [
    { membership_id: MI_MEMBRESIA, display_name: 'Ana', balance_cents: 1234567 },
    { membership_id: 'bbbb2222-2222-4222-8222-222222222222', display_name: 'Bruno', balance_cents: -1234567 },
    { membership_id: 'cccc3333-3333-4333-8333-333333333333', display_name: 'Caro', balance_cents: 0 },
  ],
  sums_to_zero: true,
}

function conSesion(extra: Record<string, Manejador>) {
  window.localStorage.setItem(CLAVE, 'vaq_token_guardado')
  return instalarBackend({
    'GET /api/v1/me': { estado: 200, cuerpo: { user: USUARIO } },
    ...extra,
  })
}

/** El camino normal: detalle y saldos los dos en verde. */
function conGrupo(balances: Manejador = { estado: 200, cuerpo: BALANCES }) {
  return conSesion({
    [`GET /api/v1/groups/${ID}`]: { estado: 200, cuerpo: DETALLE },
    [`GET /api/v1/groups/${ID}/balances`]: balances,
  })
}

describe('grupo | la cabecera y los totales', () => {
  test('el nombre del grupo, cuantos gastos y cuanto se gasto', async () => {
    conGrupo()

    montar(<App />, { ruta: `/grupos/${ID}` })

    expect(await screen.findByRole('heading', { name: 'Finde en la costa' })).toBeInTheDocument()
    const totales = screen.getByRole('group', { name: /totales/i })
    expect(totales).toHaveTextContent('3 gastos')
    expect(totales).toHaveTextContent('45.000,00')
  })

  test('mientras carga lo dice', async () => {
    const { manejador } = respuestaDemorada()
    conSesion({
      [`GET /api/v1/groups/${ID}`]: manejador,
      [`GET /api/v1/groups/${ID}/balances`]: manejador,
    })

    montar(<App />, { ruta: `/grupos/${ID}` })

    expect(await screen.findByText(/cargando el grupo/i)).toBeInTheDocument()
  })

  test('hay vuelta a la lista de grupos', async () => {
    conGrupo()

    montar(<App />, { ruta: `/grupos/${ID}` })

    expect(await screen.findByRole('link', { name: /tus grupos|volver/i })).toHaveAttribute(
      'href',
      '/'
    )
  })
})

describe('grupo | los saldos, con el signo legible', () => {
  test('cada integrante con su signo en palabras y el monto en absoluto', async () => {
    conGrupo()

    montar(<App />, { ruta: `/grupos/${ID}` })
    await screen.findByRole('heading', { name: 'Finde en la costa' })

    const ana = screen.getByRole('listitem', { name: /ana/i })
    expect(ana).toHaveTextContent(/te deben/i)
    expect(ana).toHaveTextContent('12.345,67')

    const bruno = screen.getByRole('listitem', { name: /bruno/i })
    // `deb[eé]s` y no `debe`: la palabra lleva tilde y un patron sin ella no
    // matchea nada. Un test que buscara `/debe/i` falla con el texto correcto.
    expect(bruno).toHaveTextContent(/deb[eé]s/i)
    expect(bruno).toHaveTextContent('12.345,67')
    // El monto va en valor absoluto: el signo ya lo dijo la palabra.
    expect(bruno).not.toHaveTextContent('-12.345,67')

    const caro = screen.getByRole('listitem', { name: /caro/i })
    expect(caro).toHaveTextContent(/en cero|saldad/i)
  })

  /**
   * La flecha ayuda a leer de un vistazo, pero **no puede ser la unica fuente
   * del signo**: un lector de pantalla que anuncie "flecha arriba doce mil"
   * no dice si le deben o debe. Por eso la flecha es decorativa —
   * `aria-hidden`— y la palabra es la que viaja.
   */
  test('la flecha es decorativa y la palabra es la que se anuncia', async () => {
    conGrupo()

    montar(<App />, { ruta: `/grupos/${ID}` })
    const bruno = await screen.findByRole('listitem', { name: /bruno/i })

    const flecha = bruno.querySelector('[data-flecha]')
    expect(flecha).not.toBeNull()
    expect(flecha).toHaveAttribute('aria-hidden', 'true')
    // Y el nombre accesible del item no se queda sin el signo.
    expect(bruno).toHaveAccessibleName(/bruno/i)
  })

  test('el signo no vive solo en el color: hay texto distinto en cada caso', async () => {
    conGrupo()

    montar(<App />, { ruta: `/grupos/${ID}` })
    await screen.findByRole('heading', { name: 'Finde en la costa' })

    const textos = screen
      .getAllByRole('listitem')
      .map((li) => li.textContent?.replace(/\s+/g, ' ').trim() ?? '')
    // Tres saldos distintos, tres textos distintos. Si el signo estuviera solo
    // en una clase de CSS, los de Ana y Bruno serian el mismo texto.
    expect(new Set(textos).size).toBe(3)
  })

  test('la fila propia esta marcada', async () => {
    conGrupo()

    montar(<App />, { ruta: `/grupos/${ID}` })

    // `my_membership_id` viene en la respuesta justamente para esto: sin eso el
    // cliente tendria que cruzar `/me` contra la lista de integrantes, y dos
    // personas del mismo grupo pueden llamarse igual.
    const ana = await screen.findByRole('listitem', { name: /ana/i })
    expect(ana).toHaveTextContent(/vos/i)
    expect(screen.getByRole('listitem', { name: /bruno/i })).not.toHaveTextContent(/vos/i)
  })

  test('respeta la moneda del grupo', async () => {
    conGrupo({
      estado: 200,
      cuerpo: { ...BALANCES, currency: 'USD' },
    })

    montar(<App />, { ruta: `/grupos/${ID}` })
    const ana = await screen.findByRole('listitem', { name: /ana/i })
    expect(ana.textContent).toMatch(/US\$|USD/)
  })
})

describe('grupo | cuando los saldos no cierran', () => {
  /**
   * `sums_to_zero: false` significa que la suma de los saldos no da cero: en el
   * grupo falta o sobra plata. Es la invariante de DOM-4 expuesta por el
   * backend, y la respuesta correcta del cliente es **no mostrar saldos**.
   */
  test('no muestra ningun saldo y lo explica', async () => {
    conGrupo({ estado: 200, cuerpo: { ...BALANCES, sums_to_zero: false } })

    montar(<App />, { ruta: `/grupos/${ID}` })

    const aviso = await screen.findByRole('alert')
    expect(aviso).toHaveTextContent(/no cierran|no suman cero/i)
    // Ni uno. Un saldo mostrado con la advertencia al lado se copia igual a una
    // transferencia de verdad.
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.queryByText(/12\.345,67/)).not.toBeInTheDocument()
  })

  test('la cabecera del grupo se sigue viendo', async () => {
    conGrupo({ estado: 200, cuerpo: { ...BALANCES, sums_to_zero: false } })

    montar(<App />, { ruta: `/grupos/${ID}` })

    // Lo que esta en duda son los saldos, no el grupo: esconder todo deja a la
    // persona sin saber ni donde esta.
    expect(await screen.findByRole('heading', { name: 'Finde en la costa' })).toBeInTheDocument()
  })
})

describe('grupo | los dos errores, que no son el mismo', () => {
  /**
   * Un grupo ajeno, uno inexistente y uno del que te desactivaron devuelven los
   * tres **404**, a proposito: un 403 confirmaria que el grupo existe. Asi que
   * el 404 no es "error raro" y no puede mostrarse como "algo salio mal".
   */
  test('el 404 dice que el grupo no esta disponible, y no parece una falla', async () => {
    conSesion({
      [`GET /api/v1/groups/${ID}`]: {
        estado: 404,
        cuerpo: { errors: [{ message: 'El grupo no existe' }] },
      },
      [`GET /api/v1/groups/${ID}/balances`]: {
        estado: 404,
        cuerpo: { errors: [{ message: 'El grupo no existe' }] },
      },
    })

    montar(<App />, { ruta: `/grupos/${ID}` })

    expect(await screen.findByText(/no est[aá] disponible/i)).toBeInTheDocument()
    expect(screen.queryByText(/algo sali[oó] mal|no pudimos traer/i)).not.toBeInTheDocument()
    // No ofrece reintentar: reintentar un 404 da 404.
    expect(screen.queryByRole('button', { name: /probar de nuevo/i })).not.toBeInTheDocument()
  })

  test('un 500 si es una falla, y reintentar reintenta las dos consultas', async () => {
    // Las **dos** se caen y las dos se recuperan: si el boton reintentara solo
    // una, la pantalla quedaria esperando para siempre a la otra, que ya fallo.
    let detalles = 0
    let saldos = 0
    conSesion({
      [`GET /api/v1/groups/${ID}`]: () => {
        detalles += 1
        return detalles === 1
          ? { estado: 500, cuerpo: { errors: [{ message: 'Se rompio' }] } }
          : { estado: 200, cuerpo: DETALLE }
      },
      [`GET /api/v1/groups/${ID}/balances`]: () => {
        saldos += 1
        return saldos === 1
          ? { estado: 500, cuerpo: { errors: [{ message: 'Se rompio' }] } }
          : { estado: 200, cuerpo: BALANCES }
      },
    })

    montar(<App />, { ruta: `/grupos/${ID}` })

    expect(await screen.findByRole('alert')).toHaveTextContent(/no pudimos traer/i)
    await userEvent.setup().click(screen.getByRole('button', { name: /probar de nuevo/i }))

    expect(await screen.findByRole('heading', { name: 'Finde en la costa' })).toBeInTheDocument()
  })
})

describe('grupo | integrantes', () => {
  test('lista a los integrantes con su rol y su alias de cobro', async () => {
    conGrupo()

    montar(<App />, { ruta: `/grupos/${ID}` })
    await screen.findByRole('heading', { name: 'Finde en la costa' })

    const integrantes = screen.getByRole('group', { name: /integrantes/i })
    expect(integrantes).toHaveTextContent('Ana')
    expect(integrantes).toHaveTextContent(/administradora|admin/i)
    // El alias es a donde se transfiere: es el dato operativo del cierre.
    expect(integrantes).toHaveTextContent('ana.mp')
    expect(within(integrantes).getByText(/bruno/i)).toBeInTheDocument()
  })
})

/**
 * Estos seis salieron de mutantes que **sobrevivieron**: cada uno fija algo que
 * el codigo hacia bien y que ningun test miraba. Los mutantes que habia elegido
 * mirando mis propias aserciones murieron los siete, y no midieron nada.
 */
describe('grupo | lo que encontraron los mutantes', () => {
  test('sigue esperando si el detalle llego y los saldos no', async () => {
    const detalle = respuestaDemorada()
    const saldos = respuestaDemorada()
    conSesion({
      [`GET /api/v1/groups/${ID}`]: detalle.manejador,
      [`GET /api/v1/groups/${ID}/balances`]: saldos.manejador,
    })

    montar(<App />, { ruta: `/grupos/${ID}` })
    expect(await screen.findByText(/cargando el grupo/i)).toBeInTheDocument()

    /**
     * El momento que importa es **despues** de que llego una sola de las dos.
     * La primera version de este test miraba el "Cargando" del primer render,
     * cuando las dos consultas estaban en vuelo, y ahi la pantalla espera con
     * mutante y sin el: el mutante sobrevivio y el test parecia cubrirlo.
     *
     * Con el detalle ya resuelto y los saldos todavia en vuelo, esperar a una
     * sola consulta deja la pantalla **en blanco**: ni carga, ni grupo, ni
     * error. Por eso hay que dejar pasar el tiempo de que React procese la
     * respuesta antes de preguntar.
     */
    await act(async () => {
      detalle.responder({ estado: 200, cuerpo: DETALLE })
      await new Promise((listo) => setTimeout(listo, 30))
    })

    expect(screen.getByText(/cargando el grupo/i)).toBeInTheDocument()

    await act(async () => {
      saldos.responder({ estado: 200, cuerpo: BALANCES })
      await new Promise((listo) => setTimeout(listo, 30))
    })
    expect(screen.getByRole('heading', { name: 'Finde en la costa' })).toBeInTheDocument()
  })

  test('un error de los saldos tambien es un error de la pantalla', async () => {
    conSesion({
      [`GET /api/v1/groups/${ID}`]: { estado: 200, cuerpo: DETALLE },
      [`GET /api/v1/groups/${ID}/balances`]: {
        estado: 500,
        cuerpo: { errors: [{ message: 'Se rompio' }] },
      },
    })

    montar(<App />, { ruta: `/grupos/${ID}` })

    // Mirar solo el error del detalle deja la pantalla en blanco cuando el que
    // falla es el otro pedido, que es justo el que trae los numeros.
    expect(await screen.findByRole('alert')).toHaveTextContent(/no pudimos traer/i)
  })

  test('la flecha apunta para el mismo lado que dice la palabra', async () => {
    conGrupo()

    montar(<App />, { ruta: `/grupos/${ID}` })
    await screen.findByRole('heading', { name: 'Finde en la costa' })

    // Una flecha al revés contradice al texto, y la contradiccion es peor que
    // no tener flecha: dos fuentes del mismo dato que no coinciden.
    const flechaDe = (nombre: RegExp) =>
      screen.getByRole('listitem', { name: nombre }).querySelector('[data-flecha]')?.textContent
    expect(flechaDe(/ana/i)).toBe('↑')
    expect(flechaDe(/bruno/i)).toBe('↓')
    expect(flechaDe(/caro/i)).toBe('=')
  })

  test('el saldo en cero no muestra ningun monto', async () => {
    conGrupo()

    montar(<App />, { ruta: `/grupos/${ID}` })
    const caro = await screen.findByRole('listitem', { name: /caro/i })

    // "estás en cero $ 0,00" es redundante y hace buscar un numero donde no hay
    // nada que mirar.
    expect(caro.textContent).not.toMatch(/0,00/)
  })

  test('el cartel de grupo cerrado aparece solo si el grupo esta cerrado', async () => {
    conGrupo()
    montar(<App />, { ruta: `/grupos/${ID}` })
    await screen.findByRole('heading', { name: 'Finde en la costa' })
    expect(screen.queryByText(/est[aá] cerrado/i)).not.toBeInTheDocument()
  })

  test('un grupo cerrado lo dice', async () => {
    conSesion({
      [`GET /api/v1/groups/${ID}`]: {
        estado: 200,
        cuerpo: { ...DETALLE, group: { ...DETALLE.group, status: 'closed' } },
      },
      [`GET /api/v1/groups/${ID}/balances`]: { estado: 200, cuerpo: BALANCES },
    })

    montar(<App />, { ruta: `/grupos/${ID}` })

    expect(await screen.findByText(/est[aá] cerrado/i)).toBeInTheDocument()
  })

  test('solo se marca como ida a la gente que ya no participa', async () => {
    const ida = {
      id: 'dddd4444-4444-4444-8444-444444444444',
      display_name: 'Dani',
      role: 'member' as const,
      payout_alias: null,
      active: false,
    }
    conSesion({
      [`GET /api/v1/groups/${ID}`]: {
        estado: 200,
        cuerpo: { ...DETALLE, members: [...DETALLE.members, ida] },
      },
      [`GET /api/v1/groups/${ID}/balances`]: { estado: 200, cuerpo: BALANCES },
    })

    montar(<App />, { ruta: `/grupos/${ID}` })
    await screen.findByRole('heading', { name: 'Finde en la costa' })

    const integrantes = screen.getByRole('group', { name: /integrantes/i })
    expect(within(integrantes).getByText(/dani/i)).toHaveTextContent(/ya no participa/i)
    // Y no al revés: decirle "ya no participa" a quien sí participa es una
    // mentira en pantalla, no un detalle de estilo.
    expect(within(integrantes).getByText(/ana/i)).not.toHaveTextContent(/ya no participa/i)
  })
})
