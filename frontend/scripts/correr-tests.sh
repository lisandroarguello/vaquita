#!/usr/bin/env bash
#
# Corre los tests del frontend y decide el veredicto **leyendo la salida**, con
# los tres resultados de siempre: pasa, falla y **no pude mirar**.
#
# Mismo criterio que `backend/scripts/correr-suite.sh`, por un motivo distinto.
# En el backend el envoltorio existe porque el codigo de salida de `node ace
# test` miente segun la plataforma (esta medido). Vitest, en cambio, devuelve un
# codigo que sirve: 0 en verde y 1 en rojo. Lo que **no** distingue es el tercer
# caso, y es el unico que importa para un paso de CI:
#
#   `vitest run` sin archivos que correr tambien puede terminar en 0.
#
# O sea que un paso de CI que no corre ni un test se informa verde. Es
# exactamente la forma de "chequeo que no chequea nada" que el proyecto no
# acepta: si no se pudo mirar, se dice, y termina en 2.
#
# Por eso se cuentan los tests ejecutados y no solo se busca "failed".

set -uo pipefail

cd "$(dirname "$0")/.."

# Los argumentos pasan tal cual (un filtro de archivo, por ejemplo): es lo que
# permite medir el propio envoltorio, corriendolo contra algo que no existe.
salida="$(npx vitest run --reporter=default "$@" 2>&1)"
codigo="$?"

echo "$salida"
echo "---"

# La linea del resumen: " Tests  20 passed (20)" o " Tests  2 failed | 18 passed (20)".
resumen="$(grep -E '^[[:space:]]*Tests[[:space:]]' <<<"$salida" | tail -1)"

if grep -qE 'failed' <<<"$resumen"; then
  echo "VEREDICTO: FALLAN los tests del frontend (codigo de salida: $codigo)"
  exit 1
fi

# `(0)` al final del resumen, o directamente ninguna linea de resumen: Vitest
# corrio y no ejecuto nada. Un filtro mal escrito, un `include` que no matchea,
# un archivo renombrado.
if [[ -z "$resumen" ]] || grep -qE '\(0\)[[:space:]]*$' <<<"$resumen"; then
  echo "VEREDICTO: NO-PUDE-MIRAR los tests del frontend."
  echo "No se ejecuto ningun test, asi que no hay nada que informar."
  echo "Esto no es 'todo bien': es que el runner no encontro que correr."
  exit 2
fi

if grep -qE 'passed' <<<"$resumen"; then
  echo "VEREDICTO: PASAN los tests del frontend ($resumen)"
  exit 0
fi

echo "VEREDICTO: NO-PUDE-MIRAR los tests del frontend."
echo "La salida no dice ni passed ni failed: el runner no llego a correr o cambio su formato."
exit 2
