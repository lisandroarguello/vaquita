import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ErrorApi } from '../api/cliente'
import {
  cargarBalances,
  cargarGrupo,
  claveDeBalances,
  claveDeGrupo,
} from '../api/grupos'
import type { Balances, DetalleDeGrupo, Integrante, Saldo } from '../api/grupos'
import { montoATexto, saldoEnPalabras } from '../dinero'

/**
 * FE-3 — la vista de un grupo: integrantes, totales y el saldo de cada uno.
 *
 * El signo del saldo se comunica con **palabras**, y la flecha es decorativa
 * (`aria-hidden`). Es el criterio de hecho del ticket, y el motivo es que el
 * color no sobrevive a tres cosas que pasan todo el tiempo: quien no distingue
 * rojo de verde, una captura en escala de grises y un lector de pantalla.
 */
export function Grupo() {
  const { id = '' } = useParams()

  const detalle = useQuery({
    queryKey: claveDeGrupo(id),
    queryFn: () => cargarGrupo(id),
  })
  const balances = useQuery({
    queryKey: claveDeBalances(id),
    queryFn: () => cargarBalances(id),
  })

  if (detalle.isLoading || balances.isLoading) {
    return (
      <main>
        <p role="status" aria-live="polite">
          Cargando el grupo…
        </p>
      </main>
    )
  }

  /**
   * Los dos errores no son el mismo, y esta es la unica rama de la pantalla que
   * depende de eso.
   *
   * Un grupo ajeno, uno inexistente y uno del que te desactivaron devuelven los
   * tres **404**, a proposito: un 403 confirmaria que el grupo existe. Asi que
   * el 404 no es una falla del sistema y no puede decir "algo salio mal" ni
   * ofrecer reintentar, porque reintentar un 404 da 404.
   */
  const error = detalle.error ?? balances.error
  if (error !== null) {
    if (error instanceof ErrorApi && error.esNoDisponible) {
      return (
        <main>
          <p>Este grupo no está disponible.</p>
          <Link to="/">Volver a tus grupos</Link>
        </main>
      )
    }
    return (
      <main>
        <div role="alert">
          <p>No pudimos traer el grupo.</p>
          <button
            type="button"
            onClick={() => {
              void detalle.refetch()
              void balances.refetch()
            }}
          >
            Probar de nuevo
          </button>
        </div>
        <Link to="/">Volver a tus grupos</Link>
      </main>
    )
  }

  if (detalle.data === undefined || balances.data === undefined) return null

  return <Vista detalle={detalle.data} balances={balances.data} />
}

function Vista({ detalle, balances }: { detalle: DetalleDeGrupo; balances: Balances }) {
  const { group, members, totals } = detalle

  return (
    <main>
      <Link to="/">Volver a tus grupos</Link>
      <h2>{group.name}</h2>
      {group.status === 'closed' && <p>Este grupo está cerrado.</p>}

      <section role="group" aria-label="Totales del grupo">
        <p>{totals.expense_count} gastos</p>
        <p>{montoATexto(totals.expense_total_cents, group.currency)} gastados</p>
        <p>{totals.payment_count} pagos registrados</p>
      </section>

      <h3>Saldos</h3>
      {balances.sums_to_zero ? (
        <ul>
          {balances.balances.map((saldo) => (
            <FilaDeSaldo
              key={saldo.membership_id}
              saldo={saldo}
              moneda={balances.currency}
              esPropio={saldo.membership_id === balances.my_membership_id}
            />
          ))}
        </ul>
      ) : (
        /**
         * `sums_to_zero: false` es la invariante de DOM-4 rota: en el grupo
         * falta o sobra plata. No se muestra **ningun** saldo, ni con la
         * advertencia al lado: un numero en pantalla se copia igual a una
         * transferencia de verdad, y el aviso que lo acompaña no viaja con el.
         */
        <div role="alert">
          <p>
            Los saldos de este grupo no cierran: no suman cero. No los mostramos para que nadie
            transfiera un monto equivocado.
          </p>
          <p>Revisá los gastos del grupo, porque falta o sobra plata en alguno.</p>
        </div>
      )}

      <section role="group" aria-label="Integrantes">
        <h3>Integrantes</h3>
        {members.map((integrante) => (
          <FilaDeIntegrante key={integrante.id} integrante={integrante} />
        ))}
      </section>
    </main>
  )
}

function FilaDeSaldo({
  saldo,
  moneda,
  esPropio,
}: {
  saldo: Saldo
  moneda: string
  esPropio: boolean
}) {
  const signo = saldoEnPalabras(saldo.balance_cents)
  const flecha = signo.tono === 'acreedor' ? '↑' : signo.tono === 'deudor' ? '↓' : '=';

  return (
    <li aria-label={saldo.display_name} data-tono={signo.tono}>
      <span>
        {saldo.display_name}
        {esPropio && ' (vos)'}
      </span>
      {/* Decorativa: ayuda a leer de un vistazo y no es la fuente del signo.
          Un lector de pantalla que anunciara "flecha arriba doce mil" no diria
          si le deben o debe. */}
      <span data-flecha aria-hidden="true">
        {flecha}
      </span>
      <span>
        {signo.texto}
        {signo.tono !== 'saldado' && ` ${montoATexto(saldo.balance_cents, moneda)}`}
      </span>
    </li>
  )
}

function FilaDeIntegrante({ integrante }: { integrante: Integrante }) {
  return (
    <p>
      {integrante.display_name} — {integrante.role === 'admin' ? 'administra' : 'integrante'}
      {/* El alias es a donde se transfiere: es el dato operativo del cierre, y
          sin el una instruccion de pago no se puede ejecutar. */}
      {integrante.payout_alias !== null && ` — cobra en ${integrante.payout_alias}`}
      {!integrante.active && ' — ya no participa'}
    </p>
  )
}
