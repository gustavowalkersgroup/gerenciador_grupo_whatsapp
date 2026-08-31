import { lt, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { messageEvents, webhookEvents } from "@/lib/db/schema";
import { isAuthorizedCron } from "@/lib/cron/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Retenção: metadado de mensagem some em 90 dias, log de webhook em 7. */
const MESSAGE_RETENTION_DAYS = 90;
const WEBHOOK_RETENTION_DAYS = 7;

async function handle(req: Request) {
  if (!isAuthorizedCron(req)) return new NextResponse(null, { status: 401 });

  const msgCutoff = daysAgo(MESSAGE_RETENTION_DAYS);
  const hookCutoff = daysAgo(WEBHOOK_RETENTION_DAYS);

  const purgedMessages = await db
    .delete(messageEvents)
    .where(lt(messageEvents.createdAt, msgCutoff))
    .returning({ id: messageEvents.id });

  const purgedWebhooks = await db
    .delete(webhookEvents)
    .where(lt(webhookEvents.createdAt, hookCutoff))
    .returning({ id: webhookEvents.id });

  // Consolida membros ativos do dia para os relatórios do painel.
  await db.execute(sql`
    insert into daily_group_stats (group_id, day, active_members)
    select group_id, created_at::date, count(distinct contact_id)
      from message_events
     where created_at >= current_date - interval '2 days'
     group by group_id, created_at::date
    on conflict (group_id, day)
    do update set active_members = excluded.active_members
  `);

  return NextResponse.json({
    ok: true,
    purgedMessages: purgedMessages.length,
    purgedWebhooks: purgedWebhooks.length,
  });
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

export const GET = handle;
export const POST = handle;
