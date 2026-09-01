# Tudo em Docker, atrás de um Caddy que já existe

Sobe o sistema inteiro numa máquina só. Use este arquivo quando você já tem um
servidor com Caddy rodando e quer o painel ali dentro, em vez de na Vercel.

Para o outro desenho — painel na Vercel, Evolution num VPS — use
`infra/docker-compose.yml`. Os dois não devem rodar juntos na mesma máquina:
aquele sobe um Caddy próprio nas portas 80 e 443, e brigaria com o seu.

## O que sobe

| Container   | O que faz                                    | Porta publicada |
|-------------|----------------------------------------------|-----------------|
| `app`       | Painel, API, webhook                         | **uma só**, a sua escolha |
| `evolution` | Sessão do WhatsApp (Baileys)                 | nenhuma |
| `postgres`  | Dois bancos: `gerenciador` e `evolution`     | nenhuma |
| `redis`     | Cache da Evolution                           | nenhuma |
| `migracoes` | Aplica o schema e sai                        | nenhuma |
| `cron`      | Dispara a fila, checa saúde, faz a retenção  | nenhuma |

Só o painel publica porta. A Evolution fica exclusivamente na rede interna do
Docker — no desenho da Vercel ela precisava ser alcançável de fora porque o
painel era remoto; aqui os dois são vizinhos, então não há motivo para expor
ao WhatsApp-manager mais superfície do que o necessário.

## 1. Achar uma porta livre

```sh
# O que já está escutando na máquina
ss -lntp

# Primeira porta livre a partir da 3000
for p in $(seq 3000 3100); do
  ss -lnt "sport = :$p" | grep -q LISTEN || { echo "livre: $p"; break; }
done
```

E confirme o que o seu Caddy já serve, para escolher o nome do site sem
colidir:

```sh
# Caddy nativo
sudo caddy adapt --config /etc/caddy/Caddyfile --pretty | head -40
# Caddy em container
docker ps --filter publish=443
docker exec -it <container-do-caddy> cat /etc/caddy/Caddyfile
```

Anote a porta livre: ela vai em `PORTA_PAINEL` no `.env`.

## 2. Configurar

```sh
cd infra/self-hosted
cp .env.example .env
$EDITOR .env          # preencha os seis segredos e a PORTA_PAINEL
```

Gere cada segredo com `openssl rand -hex 24`. Hex não é frescura: as senhas
entram numa URI de conexão e num comando SQL, e caracteres como `@`, `/`, `:`
ou `'` quebrariam os dois.

## 3. Subir

```sh
docker compose up -d --build
docker compose logs -f app
```

O container `migracoes` roda antes do painel, aplica o schema e sai. Ele
registra o que já aplicou, então `up` de novo é seguro.

## 4. Apontar o seu Caddy

**Caddy nativo na máquina** — acrescente ao seu `Caddyfile`:

```caddyfile
painel.seudominio.com.br {
	encode gzip
	reverse_proxy 127.0.0.1:3000   # troque pela sua PORTA_PAINEL
}
```

**Caddy em container** — ele não enxerga o `127.0.0.1` do host. Em vez de abrir
a porta para a rede toda, ligue o Caddy à rede deste compose. No
`docker-compose.yml` do seu Caddy:

```yaml
services:
  caddy:
    networks: [default, gerenciador]
networks:
  gerenciador:
    external: true
    name: gerenciador-grupos_default
```

e no `Caddyfile` use o nome do container, sem porta publicada nenhuma:

```caddyfile
painel.seudominio.com.br {
	encode gzip
	reverse_proxy app:3000
}
```

Depois: `caddy reload --config /etc/caddy/Caddyfile` (ou
`docker exec <caddy> caddy reload --config /etc/caddy/Caddyfile`).

## 5. Primeiro acesso

Abra `https://painel.seudominio.com.br` e crie o usuário.

**Duas coisas que mordem aqui:**

1. **Tem que ser HTTPS.** O cookie de sessão sai com a flag `Secure` em
   produção. Se você abrir por `http://10.0.0.254:3000` direto, o login vai
   parecer que funcionou e te jogar de volta na tela de entrada, porque o
   navegador se recusa a guardar o cookie. Não é bug — é o cookie fazendo o
   trabalho dele. Acesse pelo domínio, via Caddy.
2. **A tela de criar o primeiro usuário fica aberta enquanto não existir
   nenhum.** Quem chegar primeiro vira dono. Crie o seu no minuto seguinte a
   subir, antes de divulgar o endereço.

Depois: cadastre o número em **Números**, leia o QR, e o painel configura o
webhook da instância sozinho.

## Volume de Postgres que já existia

O script que cria o banco do painel só roda na primeira inicialização do
volume. Se você já rodava a Evolution nesta máquina, crie à mão:

```sh
docker compose exec postgres psql -U evolution -d postgres \
  -c "CREATE ROLE gerenciador LOGIN PASSWORD 'a-mesma-do-APP_DB_PASSWORD';" \
  -c "CREATE DATABASE gerenciador OWNER gerenciador;"
docker compose up -d
```

## Operação

```sh
docker compose ps                       # estado
docker compose logs -f app cron         # painel e agendador
docker compose exec cron crontab -l     # o que está agendado

# Backup. O da Evolution guarda a sessão do WhatsApp: perder = ler o QR de novo.
docker compose exec -T postgres pg_dump -U evolution gerenciador  > painel.sql
docker compose exec -T postgres pg_dump -U evolution evolution    > evolution.sql

# Atualizar depois de um git pull
docker compose up -d --build
```

## Sobre o `vercel.json`

Ele continua no repositório e não atrapalha: só é lido pela Vercel. Neste
desenho quem agenda é o container `cron`, sem o teto de uma execução por dia
do plano Hobby — o disparo volta a rodar a cada minuto, que é o que ele
precisa.
