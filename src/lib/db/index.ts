import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * Em serverless cada invocação pode abrir uma conexão nova. `max: 1` mantém
 * uma por instância de função e `prepare: false` é obrigatório quando o
 * Postgres está atrás de um pooler em modo transaction (PgBouncer, Neon, Supabase).
 */
const globalForDb = globalThis as unknown as {
  __sql?: ReturnType<typeof postgres>;
};

function client() {
  if (!globalForDb.__sql) {
    globalForDb.__sql = postgres(env().DATABASE_URL, {
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
  }
  return globalForDb.__sql;
}

export const db = drizzle(client(), { schema });
export { schema };
