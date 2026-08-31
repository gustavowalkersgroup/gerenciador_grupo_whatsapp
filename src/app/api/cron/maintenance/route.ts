import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAuthorizedCron } from "@/lib/cron/auth";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Retenção: metadado de mensagem some em 90 dias, log de webhook em 7. */
const MESSAGE_RETENTION_DAYS = 90;
const WEBHOOK_RETENTION_DAYS = 7;

async function handle(req: Request) {
  if (!isAuthorizedCron(req)) return new NextResponse(null, { status: 401 });

  const purgedMessages = await purgeInBatches("message_events", MESSAGE_RETENTION_DAYS);
  const purgedWebhooks = await purgeInBatches("webhook_events", WEBHOOK_RETENTION_DAYS);

  // Consolida membros ativos do dia para os relatórios do painel.
  const tz = env().TZ_DEFAULT;
  await db.execute(sql`
    insert into daily_group_stats (group_id, day, active_members)
    select group_id, (created_at at time zone ${tz})::date as dia, count(distinct contact_id)
      from message_events
     where created_at >= now() - interval '2 days'
     group by group_id, dia
    on conflict (group_id, day)
    do update set active_members = excluded.active_members
  `);

  return NextResponse.json({ ok: true, purgedMessages, purgedWebhooks });
}

/**
 * Apaga em lotes e conta pelo rowCount.
 *
 * A versão anterior fazia `delete ... returning id` sobre 90 dias de
 * histórico só para ler o `.length` — trazendo todas as linhas para a
 * memória de uma função de 60 segundos. Numa base com meio milhão de
 * registros isso estoura antes de terminar, e a retenção nunca roda.
 */
async function purgeInBatches(table: "message_events" | "webhook_events", days: number) {
  const alvo = sql.raw(table);
  const BATCH = 5_000;
  const MAX_LOTES = 40; // teto de segurança: o resto fica para amanhã
  let total = 0;

  for (let i = 0; i < MAX_LOTES; i++) {
    const r = await db.execute(sql`
      delete from ${alvo}
       where ctid in (
         select ctid from ${alvo}
          where created_at < now() - (${days} * interval '1 day')
          limit ${BATCH}
       )
    `);
    const n = rowCount(r);
    total += n;
    if (n < BATCH) break;
  }

  return total;
}

/** postgres.js devolve o count de formas diferentes conforme a query. */
function rowCount(result: unknown): number {
  const r = result as { count?: number; rowCount?: number; length?: number };
  return r?.count ?? r?.rowCount ?? r?.length ?? 0;
}

export const GET = handle;
export const POST = handle;
