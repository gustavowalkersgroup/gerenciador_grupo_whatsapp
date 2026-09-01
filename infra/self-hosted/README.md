# Tudo em Docker, atrás de um Caddy que já existe

Sobe o sistema inteiro numa máquina só. Use este arquivo quando você já tem um
servidor com Caddy rodando e quer o painel ali dentro, em vez de na Vercel.

Para o outro desenho — painel na Vercel, Evolution num VPS — use
`infra/docker-compose.yml`. Os dois não devem rodar juntos na mesma máquina:
aquele sobe um Caddy próprio nas portas 80 e 443, e brigaria com o seu.

## O que sobe

| Container   | O que faz                                    | Porta publicada |
|-------------|----------------------------------------------|-----------------|
| `app`       | Painel, API, webhook                         | nenhuma* |
| `evolution` | Sessão do WhatsApp (Baileys)                 | nenhuma |
| `postgres`  | Dois bancos: `gerenciador` e `evolution`     | nenhuma |
| `redis`     | Cache da Evolution                           | nenhuma |
| `migracoes` | Aplica o schema e sai                        | nenhuma |
| `cron`      | Dispara a fila, checa saúde, faz a retenção  | nenhuma |

\* Nenhum container publica porta no host. O Caddy entra na rede do compose e
alcança o painel pelo nome. A exceção é quem tem o Caddy nativo na máquina, que
precisa de uma porta publicada — passo 4.

A Evolution não é exposta nem nesse caso. No desenho da Vercel ela precisava
ser alcançável de fora porque o painel era remoto; aqui os dois são vizinhos na
rede interna, então não há motivo para dar ao mundo mais superfície do que o
necessário.

## 1. Precisa de porta livre?

**Caddy em container: não.** O painel não publica porta nenhuma; o Caddy entra
na rede do compose. Pule para o passo 2.

**Caddy nativo:** aí sim, escolha uma porta livre:

```sh
ss -lntp                                   # o que já está escutando
for p in $(seq 3000 3100); do
  ss -lnt "sport = :$p" | grep -q LISTEN || { echo "livre: $p"; break; }
done
```

Anote: vai em `PORTA_PAINEL` no `.env`, junto com o override do passo 4.

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

### Caddy em container (recomendado)

O painel não publica porta nenhuma no host: o Caddy entra na rede do compose e
fala com o container direto. Nada fica exposto na rede local, e só o Caddy
alcança o painel.

No `docker-compose.yml` do **seu Caddy**:

```yaml
services:
  caddy:
    networks: [default, gerenciador]

networks:
  gerenciador:
    external: true
    name: gerenciador-grupos
```

No seu `Caddyfile`:

```caddyfile
painel.seudominio.com.br {
	encode gzip
	reverse_proxy painel-grupos:3000
}
```

`painel-grupos` é um alias de rede definido no compose. Usamos ele em vez de
`app` porque o Caddy costuma estar ligado a várias redes, e um serviço chamado
`app` em outra delas causaria ambiguidade.

Depois:

```sh
docker compose up -d          # no diretório do seu Caddy, para entrar na rede
docker exec <caddy> caddy reload --config /etc/caddy/Caddyfile
```

Se o Caddy subiu antes deste compose, a rede `gerenciador-grupos` ainda não
existia e o `external: true` falha. Suba este compose primeiro.

### Caddy nativo na máquina

Caddy nativo não enxerga a rede do Docker, então aí sim é preciso publicar uma
porta. Preencha `PORTA_PAINEL` no `.env` e suba com o override:

```sh
docker compose -f docker-compose.yml -f docker-compose.porta-publicada.yml up -d
```

```caddyfile
painel.seudominio.com.br {
	encode gzip
	reverse_proxy 127.0.0.1:3000   # a sua PORTA_PAINEL
}
```

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
