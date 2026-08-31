#!/bin/sh
# Empurra a fila de disparos e verifica a saúde dos números.
#
# Por que isto existe: o cron da Vercel no plano Hobby tem frequência mínima
# diária, o que não serve para disparo agendado nem para detectar número caído.
# Como o VPS já está de pé, ele chama os endpoints — de graça, com a mesma
# proteção por segredo, e funcionando em qualquer plano.
#
# O endpoint de disparo reserva os alvos de forma atômica, então rodar em
# paralelo com o cron da Vercel é seguro: a segunda execução pula o que a
# primeira já pegou, em vez de enviar duas vezes.
#
# Instale com `crontab -e`:
#   * * * * *  APP_URL=... CRON_SECRET=... /opt/gerenciador/cron-dispatch.sh >> /var/log/gg.log 2>&1
#   */5 * * * * APP_URL=... CRON_SECRET=... /opt/gerenciador/cron-dispatch.sh saude >> /var/log/gg.log 2>&1
set -eu

APP_URL="${APP_URL:?defina APP_URL, ex: https://seu-painel.vercel.app}"
CRON_SECRET="${CRON_SECRET:?defina CRON_SECRET com o mesmo valor da Vercel}"

ROTA="${1:-dispatch}"

curl -sS --max-time 90 \
  -H "x-cron-secret: ${CRON_SECRET}" \
  "${APP_URL}/api/cron/${ROTA}" \
  | head -c 2000
echo
