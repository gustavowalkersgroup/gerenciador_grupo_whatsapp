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

Substitua `10.0.0.254` pelo IP do servidor (ou pelo domínio, se houver).

### Ligar o Caddy à rede do compose

O painel não publica porta no host: o Caddy entra na rede do compose e fala com
o container direto. No `docker-compose.yml` do **seu Caddy**:

```yaml
services:
  caddy:
    networks: [default, gerenciador]

networks:
  gerenciador:
    external: true
    name: gerenciador-grupos
```

`painel-grupos` (usado abaixo) é um alias de rede definido no nosso compose.
Usamos ele em vez de `app` porque o Caddy costuma estar ligado a várias redes,
e um serviço chamado `app` em outra delas causaria ambiguidade.

A rede `gerenciador-grupos` só existe depois que este compose sobe. Suba ele
primeiro, senão o `external: true` do Caddy falha.

### Sem domínio, acessando por IP: escolha um dos dois

**Opção A — HTTPS com a CA interna do Caddy.** Continua sendo TLS de verdade,
sem domínio e sem Let's Encrypt.

```caddyfile
https://10.0.0.254 {
	tls internal
	encode gzip
	reverse_proxy painel-grupos:3000
}
```

O Caddy emite um certificado para o IP com uma autoridade própria. O navegador
vai avisar que não confia nela até você instalar a raiz nas máquinas que vão
usar o painel. Para exportá-la:

```sh
docker exec <caddy> cat /data/caddy/pki/authorities/local/root.crt > caddy-root.crt
```

Instale esse arquivo como autoridade confiável em cada máquina. Dá um trabalho
inicial e resolve de vez: cadeado válido, sem aviso, sem mexer no cookie.

**Opção B — HTTP puro.** Mais rápido de subir, com um custo real.

```caddyfile
http://10.0.0.254 {
	encode gzip
	reverse_proxy painel-grupos:3000
}
```

O `http://` na frente é obrigatório: sem ele o Caddy tenta emitir certificado e
redirecionar para HTTPS.

Nesse caso é **obrigatório** pôr no `.env`:

```
COOKIE_SECURE=false
```

Sem isso o login falha de um jeito traiçoeiro — a sessão é criada no banco, mas
o navegador descarta o cookie por ele vir marcado como `Secure` numa origem
HTTP, e você volta para a tela de entrada como se a senha estivesse errada.

O preço de desligar: **o cookie de sessão trafega em texto claro na rede
local.** Quem capturar o tráfego assume a sessão de quem estiver logado. Numa
rede cabeada de escritório, com máquinas conhecidas, é um risco que muita gente
aceita. Em Wi-Fi compartilhado, não aceite — use a opção A.

### Com domínio

```caddyfile
painel.seudominio.com.br {
	encode gzip
	reverse_proxy painel-grupos:3000
}
```

Nada a configurar: certificado automático e `COOKIE_SECURE` fica como está.

### Recarregar

```sh
docker compose up -d          # no diretório do seu Caddy, para entrar na rede
docker exec <caddy> caddy reload --config /etc/caddy/Caddyfile
```

### Caddy nativo, não em container

Caddy nativo não enxerga a rede do Docker. Preencha `PORTA_PAINEL` no `.env`,
suba com o override e aponte para o loopback:

```sh
docker compose -f docker-compose.yml -f docker-compose.porta-publicada.yml up -d
```

```caddyfile
http://10.0.0.254 {
	reverse_proxy 127.0.0.1:3000   # a sua PORTA_PAINEL
}
```

## 5. Primeiro acesso

Abra o endereço que você configurou e crie o usuário.

**A tela de criar o primeiro usuário fica aberta enquanto não existir nenhum.**
Quem chegar primeiro vira dono. Crie o seu no minuto seguinte a subir, antes de
divulgar o endereço — ainda mais em rede local, onde qualquer máquina do
escritório alcança o painel.

Se o login parecer não funcionar (você entra e volta para a tela de entrada),
é o cookie: reveja a seção anterior.

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
