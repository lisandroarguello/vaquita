#!/usr/bin/env bash
#
# Corre una suite de tests y decide el veredicto **leyendo la salida**.
#
# Por que existe este envoltorio y no un `node ace test <suite>` pelado: el
# codigo de salida de `node ace test` **depende de la plataforma**, y eso esta
# medido de los dos lados.
#
# En Windows, que es donde se desarrolla esto: `node ace test unit` devuelve
# **1 con las 160 pruebas en verde**, cinco veces de cinco, mientras `node ace
# test database` devuelve 0 con las suyas tambien en verde. Lo mismo con
# `--groups` y con `--files`. En el runner de Linux del CI, en cambio, las tres
# suites devolvieron 0.
#
# O sea que un CI que confiara en ese numero funcionaria —hoy, en Linux— y
# cualquiera que corriera lo mismo en su maquina lo veria rojo con todo
# pasando. Un numero que significa cosas distintas segun donde corre no es un
# veredicto: es una coincidencia.
#
# La regla del proyecto es la misma de los mutantes, y por el mismo motivo: el
# veredicto se lee de la salida (`PASSED` / `FAILED`), nunca del codigo de
# salida.
#
# Y el tercer caso es el que hace que esto sirva: si la salida **no dice
# ninguna de las dos cosas** —el runner se cayo al arrancar, no encontro la
# base, cambio el formato— esto termina en 2 y lo dice. Un chequeo que no pudo
# mirar no puede informar "todo bien": seria la unica forma de que algo roto
# pase a produccion con el visto verde.

set -uo pipefail

suite="${1:?falta el nombre de la suite: unit, database o functional}"

salida="$(node ace test "$suite" 2>&1)"
codigo_que_no_sirve=$?

echo "$salida"
echo "---"

if grep -qE '^ FAILED' <<<"$salida"; then
  echo "VEREDICTO: FALLA la suite '$suite' (codigo de salida, que no se usa: $codigo_que_no_sirve)"
  exit 1
fi

if grep -qE '^ PASSED' <<<"$salida"; then
  echo "VEREDICTO: PASA la suite '$suite' (codigo de salida, que no se usa: $codigo_que_no_sirve)"
  exit 0
fi

echo "VEREDICTO: NO-PUDE-MIRAR la suite '$suite'."
echo "La salida no dice ni PASSED ni FAILED, asi que no hay nada que informar."
echo "Esto no es 'todo bien': es que el runner no llego a correr o cambio su formato."
exit 2
