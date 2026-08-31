#!/bin/sh
# Empurra a fila de disparos a cada minuto.
#
# Por que isto existe: no plano Hobby da Vercel o cron roda uma vez por dia,
# o que é inútil para um disparo agendado. Como o VPS já está de pé, ele
# chama o endpoint a cada minuto — de graça e com a mesma proteção por segredo.
#
# Instale com `crontab -e`:
#   * * * * * /opt/gerenciador/cron-dispatch.sh >> /var/log/gg-dispatch.log 2>&1
set -eu

APP_URL="${APP_URL:?defina APP_URL, ex: https://seu-painel.vercel.app}"
CRON_SECRET="${CRON_SECRET:?defina CRON_SECRET com o mesmo valor da Vercel}"

curl -sS --max-time 90 \
  -H "x-cron-secret: ${CRON_SECRET}" \
  "${APP_URL}/api/cron/dispatch" \
  | head -c 2000
echo
