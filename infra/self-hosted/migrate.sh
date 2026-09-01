#!/bin/sh
# Aplica as migrações do painel uma única vez cada.
#
# O SQL gerado pelo drizzle usa CREATE TABLE puro, sem IF NOT EXISTS: rodar
# duas vezes quebra. Este script registra o que já aplicou numa tabela de
# controle, então subir o compose de novo é seguro.
set -eu

# Sem os avisos de "já existe": o que interessa na saída é o que foi aplicado.
export PGOPTIONS="-c client_min_messages=warning"

echo "Aguardando o Postgres..."
until pg_isready -q; do sleep 1; done

psql -v ON_ERROR_STOP=1 -q -c \
  "create table if not exists _migracoes (
     arquivo text primary key,
     aplicada_em timestamptz not null default now()
   )"

# Banco que já tem o schema (veio de um `db:push`, por exemplo) mas nenhum
# registro: adota o estado atual em vez de tentar recriar tudo e falhar.
nenhum_registro=$(psql -tAc "select count(*) = 0 from _migracoes")
schema_existe=$(psql -tAc "select to_regclass('public.users') is not null")
if [ "$nenhum_registro" = "t" ] && [ "$schema_existe" = "t" ]; then
  echo "Schema já existia; marcando as migrações como aplicadas."
  for f in /migracoes/*.sql; do
    psql -v ON_ERROR_STOP=1 -q -c \
      "insert into _migracoes (arquivo) values ('$(basename "$f")')
       on conflict do nothing"
  done
  echo "Pronto."
  exit 0
fi

for f in /migracoes/*.sql; do
  nome=$(basename "$f")
  if [ -n "$(psql -tAc "select 1 from _migracoes where arquivo = '$nome'")" ]; then
    echo "· $nome (já aplicada)"
    continue
  fi
  echo "→ aplicando $nome"
  # -1 roda o arquivo inteiro numa transação: ou entra tudo, ou nada.
  psql -v ON_ERROR_STOP=1 -q -1 -f "$f"
  psql -v ON_ERROR_STOP=1 -q -c "insert into _migracoes (arquivo) values ('$nome')"
done

echo "Migrações em dia."
