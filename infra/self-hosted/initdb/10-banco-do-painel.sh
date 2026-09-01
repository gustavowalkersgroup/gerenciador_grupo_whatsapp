#!/bin/sh
# Cria o banco do painel ao lado do banco da Evolution, na mesma instância.
#
# Só roda na PRIMEIRA inicialização do volume. Se o volume já existe (você já
# rodava a Evolution antes), crie à mão — o README tem o comando.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-EOSQL
  CREATE ROLE gerenciador LOGIN PASSWORD '${APP_DB_PASSWORD}';
  CREATE DATABASE gerenciador OWNER gerenciador;
EOSQL

echo "Banco 'gerenciador' criado."
