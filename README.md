# Gerenciador de Grupos de WhatsApp

Painel para operar grupos de WhatsApp em escala: moderação automática, gestão
de membros, boas-vindas, disparo agendado e **captura por palavra-chave** —
alguém escreve “quero sapato x 44” no grupo e recebe automaticamente uma
mensagem no privado.

## Dá para fazer pela Vercel?

Metade. E a metade que não dá é a mais importante de entender antes de começar.

**O que roda na Vercel:** o painel, a API, o receptor de webhook, o banco e o
agendamento. Tudo isso é HTTP de request e response — o formato natural do
serverless.

**O que não roda:** a conexão com o WhatsApp. Ela é um websocket que precisa
ficar de pé o tempo todo, e função serverless sobe, responde e morre em
segundos. Não é limitação de plano; é o modelo de execução.

**E a API oficial da Meta?** Não resolve: a WhatsApp Cloud API **não tem
suporte a grupos**. Não cria grupo, não lista participante, não adiciona nem
remove ninguém. Qualquer sistema que gerencie grupos passa por biblioteca não
oficial — aqui, a [Evolution API](https://github.com/EvolutionAPI/evolution-api),
que embrulha o Baileys e expõe REST + webhooks.

Então a arquitetura é dividida:

```
   Vercel (serverless)                    VPS (~R$ 25-40/mês)
┌──────────────────────────┐          ┌──────────────────────────┐
│  Painel Next.js          │          │  Evolution API (Docker)  │
│  Server Actions          │  REST →  │  ↕ websocket             │
│  /api/webhooks/evolution │ ← webhook│  Postgres + Redis        │
│  /api/cron/dispatch      │          │  Caddy (TLS)             │
└───────────┬──────────────┘          └──────────┬───────────────┘
            │                                    │
     Postgres (Neon)                        WhatsApp
```

O que você ganha mantendo o painel na Vercel: deploy por git push, preview por
branch, TLS e CDN de graça, e zero servidor para administrar do lado da
aplicação. O VPS fica com uma responsabilidade só — segurar a conexão.

## Custo mensal

| Item | Onde | Custo |
|---|---|---|
| Painel | Vercel Hobby | R$ 0 |
| Banco | Neon / Supabase free | R$ 0 |
| Evolution API | VPS 2 GB (Hetzner, Contabo, Hostinger) | R$ 25–40 |
| **Total** | | **R$ 25–40** |

O plano Pro da Vercel (US$ 20) só é necessário se você quiser o cron nativo por
minuto. Dá para evitar: o VPS já está ligado e chama o endpoint de disparo de
graça — veja `infra/cron-dispatch.sh`.

## O que o sistema faz

**Moderação automática** — anti-link com lista de domínios liberados (ou só
bloqueando convite de outro grupo), anti-flood por janela de tempo, palavras
proibidas, bloqueio por tipo de mídia, e modo “só admin fala” com janela de
horário. Cada regra escolhe a ação: avisar, apagar, apagar e avisar, ou
remover. Strikes acumulam e removem no limite configurado. Regra de grupo
sobrescreve a global.

**Gestão de membros** — sincroniza grupos e participantes, promove e rebaixa
admin, remove membro, gera e revoga link de convite, fecha e abre o grupo.

**Boas-vindas** — mensagem por grupo com `{{nome}}`, `{{grupo}}` e `{{numero}}`,
com ou sem menção, no grupo ou no privado, e mensagem de despedida.

**Captura por palavra-chave** — o recurso central. Um gatilho define as
palavras que disparam, palavras que precisam aparecer junto (`sapato` + `44`),
palavras que cancelam o disparo (`não quero`), e a mensagem que vai no privado.
Tem cooldown por pessoa, teto diário por gatilho e por número, etiqueta
automática do contato, e um simulador no painel para testar a regra antes de
soltar num grupo com 500 pessoas.

**Disparo agendado** — seleciona grupos por etiqueta ou individualmente,
agenda, e envia em lotes com intervalo aleatório entre mensagens. O estado fica
no banco, então o cron continua exatamente de onde parou — é o que faz um
disparo para 300 grupos funcionar mesmo com função que dura 60 segundos.

**Relatórios** — mensagens por dia, membros ativos, entradas e saídas,
crescimento líquido, ranking de grupos e de participantes.

## Cuidados que o sistema já implementa

Automação por via não oficial tem risco real de banimento do número. O código
assume isso:

- Intervalo **aleatório** entre envios, não cadência fixa.
- Teto diário de mensagens no privado, por número e por gatilho.
- Cooldown por pessoa, para o mesmo contato não ser abordado repetidamente.
- **Opt-out permanente**: quem responde “sair”, “parar” ou “não quero mais” no
  privado nunca mais recebe DM automático. É verificado antes de qualquer envio.
- Idempotência no webhook: reenvio da Evolution não vira mensagem duplicada.
- Retenção de dados: metadado de mensagem é apagado em 90 dias, log de webhook
  em 7. Não guardamos o texto das mensagens do grupo.

Ainda assim: use um chip dedicado, aqueça o número antes, e não trate teto
diário alto como meta.

## Como subir

### 1. Banco

Crie um Postgres no [Neon](https://neon.tech) ou [Supabase](https://supabase.com)
(o free tier dá conta). Use a **connection string do pooler** — serverless abre
muita conexão e o Postgres direto derruba.

```bash
cp .env.example .env.local   # preencha DATABASE_URL
pnpm install
pnpm db:push                 # cria as tabelas
```

### 2. Evolution API no VPS

Siga [`infra/README.md`](infra/README.md). São quatro comandos.

### 3. Painel na Vercel

```bash
vercel                       # ou conecte o repositório pelo dashboard
```

Defina as variáveis de ambiente (as mesmas do `.env.example`). Gere os segredos
com `openssl rand -hex 32`.

### 4. Conecte o número

Abra o painel, crie o primeiro acesso, vá em **Números → cadastrar**, leia o QR
pelo celular, e depois em **Grupos → Sincronizar**.

Para o bot moderar, ele precisa ser **admin** do grupo — sem isso ele consegue
avisar, mas não apagar mensagem nem remover ninguém. O painel mostra essa
condição em cada grupo.

Opcionalmente, popule regras e um gatilho de exemplo:

```bash
DATABASE_URL=... pnpm seed nome-da-instancia
```

## Desenvolvimento

```bash
pnpm dev          # painel em http://localhost:3000
pnpm test         # testes do motor de regras
pnpm typecheck
pnpm db:generate  # gera migration a partir do schema
pnpm db:studio    # inspeciona o banco
```

Para testar o webhook local, exponha a porta com `ngrok http 3000` e aponte o
webhook da instância para a URL gerada.

## Estrutura

```
src/
  app/
    (painel)/            telas do painel
    api/
      webhooks/evolution/  recebe eventos do WhatsApp
      cron/dispatch/       processa a fila de disparo
      cron/maintenance/    retenção de dados e consolidação
  lib/
    db/schema.ts         modelo de dados
    domain/              regras puras (moderação, palavras-chave, texto, JID)
    evolution/           cliente da Evolution API
    services/            orquestração (executa as regras, sincroniza, dispara)
infra/                   docker-compose do VPS
tests/                   testes do motor de regras
```

A lógica de decisão fica em `src/lib/domain/` como função pura — sem banco e sem
rede. É o que permite testar “esta mensagem viola a regra?” e “este texto casa
com este gatilho?” sem subir nada.

## Aviso legal

Este projeto usa uma via não oficial de acesso ao WhatsApp, o que contraria os
Termos de Serviço da plataforma. O número pode ser bloqueado. Use por sua conta
e risco, com chip dedicado, e respeite a LGPD: só envie mensagem para quem
espera receber, honre o opt-out, e trate a base de contatos como dado pessoal.
