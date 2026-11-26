import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ErrorApi } from '../api/cliente'
import { CLAVE_GRUPOS, crearGrupo, listarGrupos } from '../api/grupos'
import type { GrupoListado } from '../api/grupos'
import { montoATexto, saldoEnPalabras } from '../dinero'

/**
 * FE-2 — la lista de grupos y el alta.
 *
 * Los tres estados del criterio de hecho —carga, error y vacio— son tres cosas
 * distintas que decirle a la persona, y la que no se puede confundir con
 * ninguna es la del medio: un listado que mostrara "no tenes grupos" cuando lo
 * que paso es que se cayo la red hace que alguien cree de nuevo un grupo que ya
 * tiene, y despues hay que explicarle a cuatro personas en cual cargar los
 * gastos.
 */
export function Grupos() {
  const consulta = useQuery({ queryKey: CLAVE_GRUPOS, queryFn: listarGrupos })

  return (
    <main>
      <h2>Tus grupos</h2>

      {consulta.isLoading && (
        <p role="status" aria-live="polite">
          Cargando tus grupos…
        </p>
      )}

      {consulta.isError && (
        <div role="alert">
          <p>No pudimos traer tus grupos.</p>
          <button type="button" onClick={() => consulta.refetch()}>
            Probar de nuevo
          </button>
        </div>
      )}

      {/* `data` y no `!isLoading`: entre el error y el exito hay un instante en
          el que no hay ninguno de los dos, y ahi no hay nada que listar. */}
      {consulta.data !== undefined &&
        (consulta.data.length === 0 ? (
          <p>Todavia no tenes grupos. Crea el primero y sumá a los demás por mail.</p>
        ) : (
          <ul>
            {consulta.data.map((grupo) => (
              <Fila key={grupo.id} grupo={grupo} />
            ))}
          </ul>
        ))}

      <AltaDeGrupo />
    </main>
  )
}

function Fila({ grupo }: { grupo: GrupoListado }) {
  const saldo = saldoEnPalabras(grupo.my_balance_cents)

  return (
    // El nombre accesible del item es el del grupo: es lo que lo identifica
    // cuando se lo lee de a uno, con un lector de pantalla o en un test.
    <li aria-label={grupo.name} data-tono={saldo.tono}>
      <Link to={`/grupos/${grupo.id}`}>{grupo.name}</Link>
      <p>{grupo.member_count} integrantes</p>
      <p>
        {/* El signo en palabras primero y el monto en absoluto despues: el color
            y el menos no son los que comunican el signo (FE-3). */}
        {saldo.texto}
        {saldo.tono !== 'saldado' && ` ${montoATexto(grupo.my_balance_cents, grupo.currency)}`}
      </p>
    </li>
  )
}

function AltaDeGrupo() {
  const clienteDeQuery = useQueryClient()
  const [nombre, setNombre] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [errorDeNombre, setErrorDeNombre] = useState<string | null>(null)

  const alta = useMutation({
    mutationFn: (name: string) => crearGrupo(name),
    onSuccess: () => {
      setNombre('')
      /**
       * Se vuelve a pedir el listado en vez de meter el grupo nuevo en una
       * lista local. El grupo recien creado trae su id y su rol, pero **no** su
       * `my_balance_cents` ni su `member_count`: inventar esos dos campos del
       * lado del cliente es escribir una segunda version de lo que el backend
       * calcula, y el dia que no coincidan la pantalla va a mostrar un numero
       * que no existe en ninguna parte.
       */
      return clienteDeQuery.invalidateQueries({ queryKey: CLAVE_GRUPOS })
    },
    onError: (e) => {
      // El campo que el backend señalo se muestra en el campo; lo que no trae
      // `field` no se pega a ninguno a la fuerza.
      const delCampo = e instanceof ErrorApi ? e.mensajeDe('name') : undefined
      if (delCampo !== undefined) setErrorDeNombre(delCampo)
      else setError('No pudimos crear el grupo. Probá de nuevo en un momento.')
    },
  })

  function enviar(evento: React.FormEvent) {
    evento.preventDefault()
    setError(null)
    setErrorDeNombre(null)

    const limpio = nombre.trim()
    if (limpio === '') {
      // No sale a la red: el backend contestaria 400 y el viaje no agrega
      // nada que no se sepa aca.
      setErrorDeNombre('Ponele un nombre al grupo.')
      return
    }

    alta.mutate(limpio)
  }

  return (
    <form onSubmit={enviar} noValidate>
      <h3>Crear un grupo</h3>

      <label htmlFor="nombre-grupo">Nombre del grupo</label>
      <input
        id="nombre-grupo"
        name="name"
        value={nombre}
        maxLength={80}
        aria-invalid={errorDeNombre !== null}
        aria-describedby={errorDeNombre !== null ? 'error-nombre-grupo' : undefined}
        onChange={(e) => setNombre(e.target.value)}
      />
      {errorDeNombre !== null && (
        <p id="error-nombre-grupo" role="alert">
          {errorDeNombre}
        </p>
      )}

      {error !== null && <p role="alert">{error}</p>}

      <button type="submit" disabled={alta.isPending}>
        {alta.isPending ? 'Creando…' : 'Crear grupo'}
      </button>
    </form>
  )
}
