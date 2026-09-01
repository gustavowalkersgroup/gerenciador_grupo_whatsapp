#!/bin/sh
# Agendador dos jobs do painel.
#
# Na Vercel isto eram os crons do vercel.json, limitados a uma vez por dia no
# plano Hobby. Rodando por conta própria não há esse teto, então o disparo
# volta para a frequência que ele realmente precisa.
#
# O segredo é escrito direto no crontab porque o crond do busybox não repassa
# o ambiente do processo pai para os jobs.
set -eu

: "${APP_URL:?defina APP_URL}"
: "${CRON_SECRET:?defina CRON_SECRET}"

chamar() {
  # -T 90 e --header são os flags que o wget do busybox entende; os do GNU
  # wget (--timeout=) não existem aqui e falhariam calados.
  echo "wget -q -O /dev/null -T 90 --header=\"x-cron-secret: ${CRON_SECRET}\" \"${APP_URL}/api/cron/$1\" 2>&1"
}

cat > /etc/crontabs/root <<CRONTAB
# Empurra a fila de disparos agendados.
* * * * * $(chamar dispatch)
# Confere no Evolution se cada número continua conectado de verdade.
*/5 * * * * $(chamar saude)
# Retenção: apaga metadados de mensagem e log de webhook vencidos.
20 4 * * * $(chamar maintenance)
CRONTAB

echo "Agendador de pé:"
sed 's/x-cron-secret: [^"]*/x-cron-secret: ***/' /etc/crontabs/root
exec crond -f -l 8
