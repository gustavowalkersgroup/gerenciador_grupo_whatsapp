# Deploy do worker (VPS)

Este diretório sobe a parte que **não pode** rodar na Vercel: a Evolution API,
que mantém o websocket com o WhatsApp de pé 24 horas por dia.

## Por que um VPS

A Vercel executa funções serverless — elas sobem, respondem e morrem em
segundos. Um bot de WhatsApp precisa de um processo permanente que segura a
conexão e recebe mensagem a qualquer momento. Não é uma limitação de plano:
é o modelo de execução.

A alternativa oficial (WhatsApp Cloud API da Meta) não resolve, porque **ela
não expõe grupos** — não cria grupo, não lista participante, não adiciona nem
remove ninguém. Gerenciar grupos exige a via não-oficial, e é isso que a
Evolution API embrulha.

## Requisitos

- VPS com 2 GB de RAM (1 GB funciona, mas aperta quando o grupo é grande),
  Ubuntu 22.04+ com Docker e Docker Compose.
- Um subdomínio apontando (registro A) para o IP do VPS.
- Portas 80 e 443 abertas.

Custo típico em 2026: R$ 25–40/mês (Hetzner CX22, Contabo, Hostinger VPS).

## Passo a passo

```bash
# 1. Copie a pasta infra/ para o servidor
scp -r infra/ root@SEU_IP:/opt/gerenciador
ssh root@SEU_IP
cd /opt/gerenciador

# 2. Gere os segredos e preencha o .env
cp .env.example .env
echo "EVOLUTION_API_KEY=$(openssl rand -hex 32)"
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
nano .env   # cole os valores e ajuste EVOLUTION_DOMAIN / EVOLUTION_PUBLIC_URL

# 3. Suba
docker compose up -d
docker compose logs -f evolution   # aguarde "Server is running"

# 4. Confirme o TLS (o Caddy emite o certificado sozinho no primeiro acesso)
curl -sS https://evo.seudominio.com.br/ | head
```

## Ligando ao painel

No projeto da Vercel, defina:

| Variável | Valor |
|---|---|
| `EVOLUTION_API_URL` | `https://evo.seudominio.com.br` |
| `EVOLUTION_API_KEY` | o mesmo valor do `.env` daqui |
| `WEBHOOK_SECRET` | `openssl rand -hex 32` (só o painel conhece) |
| `APP_URL` | a URL pública do painel |

Depois, em **Números → cadastrar**, o painel cria a instância na Evolution já
apontando o webhook para `APP_URL/api/webhooks/evolution` com o
`WEBHOOK_SECRET` no header. Leia o QR pelo celular e pronto.

## Cron do disparo

No plano Hobby da Vercel o cron roda **uma vez por dia**, o que não serve para
disparo agendado. Como o VPS já está ligado, use o script daqui:

```bash
cp cron-dispatch.sh /opt/gerenciador/cron-dispatch.sh
chmod +x /opt/gerenciador/cron-dispatch.sh

crontab -e
# adicione, com as variáveis do seu ambiente:
* * * * * APP_URL=https://seu-painel.vercel.app CRON_SECRET=xxx /opt/gerenciador/cron-dispatch.sh >> /var/log/gg-dispatch.log 2>&1
```

No plano Pro da Vercel o `vercel.json` já cuida disso e o cron do VPS vira
redundância — pode manter os dois, o endpoint é idempotente.

## Backup (faça isto)

O volume `evolution_instances` e o banco `evolution` guardam a **sessão do
WhatsApp**. Perder os dois significa ler o QR de novo em todos os números.

```bash
# Diário, guardando 7 dias
docker compose exec -T postgres pg_dump -U evolution evolution \
  | gzip > /root/backup-evolution-$(date +%F).sql.gz
find /root -name 'backup-evolution-*.sql.gz' -mtime +7 -delete
```

## Manutenção

```bash
docker compose logs -f evolution      # acompanhar
docker compose restart evolution      # reiniciar sem perder sessão
docker compose pull && docker compose up -d   # atualizar
docker system prune -af --volumes=false       # liberar disco
```

## Segurança

- A porta da Evolution (8080) **não** é publicada: só o Caddy fala com ela.
- A `AUTHENTICATION_API_KEY` dá controle total sobre os números conectados.
  Trate como senha de banco: nunca no cliente, nunca no repositório.
- Considere restringir o acesso por IP ou colocar atrás do Cloudflare. Os IPs
  de saída da Vercel não são fixos no plano Hobby, então uma allowlist por IP
  só funciona no Pro (Secure Compute) ou usando um túnel.
