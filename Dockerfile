# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# O build valida tipos e precisa que as variáveis existam, mas nada aqui
# conversa com serviço de verdade: todas as rotas são dinâmicas, então nenhum
# destes valores é assado na imagem. Os reais entram em runtime, pelo compose.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build \
    EVOLUTION_API_URL=http://localhost:9 \
    EVOLUTION_API_KEY=build \
    WEBHOOK_SECRET=placeholder-de-build-32-caracteres \
    CRON_SECRET=placeholder-de-build-32-caracteres \
    AUTH_SECRET=placeholder-de-build-32-caracteres
RUN pnpm build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=build /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/entrar >/dev/null 2>&1 || exit 1
CMD ["node", "server.js"]
