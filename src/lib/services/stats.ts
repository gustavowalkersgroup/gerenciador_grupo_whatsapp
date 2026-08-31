import { and, count, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { dailyGroupStats, messageEvents } from "@/lib/db/schema";

/**
 * Registra a mensagem. Devolve false quando é reentrega do mesmo evento —
 * assim o contador de flood não infla por retry da Evolution.
 */
export async function recordMessageEvent(input: {
  groupId: string;
  contactId: string;
  messageId: string | null;
  messageType: string;
  at: Date;
}): Promise<boolean> {
  const rows = await db
    .insert(messageEvents)
    .values({
      groupId: input.groupId,
      contactId: input.contactId,
      messageId: input.messageId,
      messageType: input.messageType,
      createdAt: input.at,
    })
    .onConflictDoNothing({ target: [messageEvents.groupId, messageEvents.messageId] })
    .returning({ id: messageEvents.id });
  return rows.length > 0;
}

/** Quantas mensagens esse membro mandou na janela — base do anti-flood. */
export async function countRecentMessages(
  groupId: string,
  contactId: string,
  windowSeconds: number,
): Promise<number> {
  const since = new Date(Date.now() - windowSeconds * 1000);
  const [row] = await db
    .select({ n: count() })
    .from(messageEvents)
    .where(
      and(
        eq(messageEvents.groupId, groupId),
        eq(messageEvents.contactId, contactId),
        gte(messageEvents.createdAt, since),
      ),
    );
  return row?.n ?? 0;
}

type StatField = "messages" | "joins" | "leaves" | "moderations" | "keywordHits";

/**
 * Incremento das métricas do dia. Um único INSERT ... ON CONFLICT DO UPDATE,
 * então duas invocações concorrentes da função não perdem contagem.
 */
export async function bumpDailyStat(
  groupId: string,
  field: StatField,
  by = 1,
  day = new Date(),
): Promise<void> {
  const iso = day.toISOString().slice(0, 10);
  const column = dailyGroupStats[field];

  await db
    .insert(dailyGroupStats)
    .values({ groupId, day: iso, [field]: by })
    .onConflictDoUpdate({
      target: [dailyGroupStats.groupId, dailyGroupStats.day],
      set: { [field]: sql`${column} + ${by}` },
    });
}

/** Recalcula membros ativos do dia a partir dos eventos de mensagem. */
export async function refreshActiveMembers(groupId: string, day = new Date()): Promise<void> {
  const iso = day.toISOString().slice(0, 10);
  await db.execute(sql`
    insert into daily_group_stats (group_id, day, active_members)
    select ${groupId}::uuid, ${iso}::date, count(distinct contact_id)
      from message_events
     where group_id = ${groupId}::uuid
       and created_at >= ${iso}::date
       and created_at < (${iso}::date + interval '1 day')
    on conflict (group_id, day)
    do update set active_members = excluded.active_members
  `);
}
