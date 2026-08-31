import { and, count, desc, eq, gte, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { contactTags, contacts, keywordHits, keywordTriggers } from "@/lib/db/schema";
import { canSendDm, matchTriggers, type SuppressionReason, type Trigger } from "@/lib/domain/keywords";
import { excerpt, renderTemplate } from "@/lib/domain/text";
import { evolution } from "@/lib/evolution/client";
import { bumpDailyStat } from "./stats";
import type { ContactRow, GroupRow, InstanceRow } from "./entities";

type TriggerRow = typeof keywordTriggers.$inferSelect;

function toDomain(r: TriggerRow): Trigger {
  return {
    id: r.id,
    name: r.name,
    keywords: asStringArray(r.keywords),
    requiredAll: asStringArray(r.requiredAll),
    negativeKeywords: asStringArray(r.negativeKeywords),
    mode: r.mode,
    priority: r.priority,
    enabled: r.enabled,
    groupId: r.groupId,
  };
}

/** O jsonb vem como unknown; um array sujo não pode derrubar o webhook. */
function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

export interface KeywordOutcome {
  matched: boolean;
  triggerName?: string;
  matchedTerm?: string;
  sent?: boolean;
  reason?: SuppressionReason;
}

export interface KeywordInput {
  instance: InstanceRow;
  group: GroupRow;
  contact: ContactRow;
  rawText: string;
  messageId: string | null;
  senderIsAdmin: boolean;
}

/**
 * O recurso central: alguém escreve "quero sapato x 44" no grupo e o sistema
 * chama essa pessoa no privado com a mensagem certa — respeitando opt-out,
 * cooldown e teto diário, porque é isso que separa atendimento de spam.
 */
export async function runKeywordTriggers(input: KeywordInput): Promise<KeywordOutcome> {
  if (!input.rawText.trim()) return { matched: false };

  const rows = await db
    .select()
    .from(keywordTriggers)
    .where(
      and(
        eq(keywordTriggers.instanceId, input.instance.id),
        eq(keywordTriggers.enabled, true),
        or(eq(keywordTriggers.groupId, input.group.id), isNull(keywordTriggers.groupId)),
      ),
    );
  if (rows.length === 0) return { matched: false };

  const byId = new Map(rows.map((r) => [r.id, r]));
  const [best] = matchTriggers(rows.map(toDomain), input.rawText);
  if (!best) return { matched: false };

  const trigger = byId.get(best.trigger.id);
  if (!trigger) return { matched: false };

  const gate = await checkGate(input, trigger);
  const base = { matched: true, triggerName: trigger.name, matchedTerm: best.matchedTerm };

  if (!gate.allowed) {
    await logHit(input, trigger.id, best.matchedTerm, "suppressed", gate.reason);
    return { ...base, sent: false, reason: gate.reason };
  }

  const vars = {
    nome: input.contact.pushName ?? "tudo bem",
    grupo: input.group.name,
    mensagem: input.rawText,
    match: best.matchedTerm,
    termo: best.matchedTerm,
  };

  try {
    const dmText = renderTemplate(trigger.dmTemplate, vars);
    if (trigger.dmMediaUrl) {
      await evolution.message.sendMedia(input.instance.evolutionName, {
        to: input.contact.jid,
        mediatype: (trigger.dmMediaType as "image" | "video" | "document") ?? "image",
        media: trigger.dmMediaUrl,
        caption: dmText,
        delayMs: 1500,
      });
    } else {
      await evolution.message.sendText(input.instance.evolutionName, {
        to: input.contact.jid,
        text: dmText,
        delayMs: 1500,
      });
    }
  } catch (e) {
    console.error("[palavra-chave] falha ao enviar DM:", (e as Error).message);
    await logHit(input, trigger.id, best.matchedTerm, "failed", "send_error");
    return { ...base, sent: false, reason: "send_error" };
  }

  await db.update(contacts).set({ lastDmAt: new Date() }).where(eq(contacts.id, input.contact.id));

  if (trigger.replyInGroup && trigger.groupReplyTemplate?.trim()) {
    await ignoreFailure(() =>
      evolution.message.sendText(input.instance.evolutionName, {
        to: input.group.jid,
        text: renderTemplate(trigger.groupReplyTemplate ?? "", vars),
        mentions: [input.contact.jid],
        delayMs: 800,
      }),
    );
  }

  if (trigger.applyTagId) {
    await db
      .insert(contactTags)
      .values({
        contactId: input.contact.id,
        tagId: trigger.applyTagId,
        source: `gatilho:${trigger.name}`,
      })
      .onConflictDoNothing();
  }

  await logHit(input, trigger.id, best.matchedTerm, "sent", null);
  await bumpDailyStat(input.group.id, "keywordHits");

  return { ...base, sent: true };
}

async function checkGate(input: KeywordInput, trigger: TriggerRow) {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const [lastHit] = await db
    .select({ createdAt: keywordHits.createdAt })
    .from(keywordHits)
    .where(
      and(
        eq(keywordHits.triggerId, trigger.id),
        eq(keywordHits.contactId, input.contact.id),
        eq(keywordHits.status, "sent"),
      ),
    )
    .orderBy(desc(keywordHits.createdAt))
    .limit(1);

  const [triggerToday] = await db
    .select({ n: count() })
    .from(keywordHits)
    .where(
      and(
        eq(keywordHits.triggerId, trigger.id),
        eq(keywordHits.status, "sent"),
        gte(keywordHits.createdAt, startOfDay),
      ),
    );

  const [instanceToday] = await db
    .select({ n: count() })
    .from(keywordHits)
    .innerJoin(keywordTriggers, eq(keywordHits.triggerId, keywordTriggers.id))
    .where(
      and(
        eq(keywordTriggers.instanceId, input.instance.id),
        eq(keywordHits.status, "sent"),
        gte(keywordHits.createdAt, startOfDay),
      ),
    );

  return canSendDm({
    optOut: input.contact.optOut,
    minutesSinceLastHit: lastHit
      ? Math.floor((Date.now() - lastHit.createdAt.getTime()) / 60_000)
      : null,
    cooldownMinutes: trigger.cooldownMinutes,
    hitsTodayForTrigger: triggerToday?.n ?? 0,
    triggerDailyLimit: trigger.dailyLimit,
    dmsTodayForInstance: instanceToday?.n ?? 0,
    instanceDailyLimit: input.instance.dailyDmLimit,
  });
}

async function logHit(
  input: KeywordInput,
  triggerId: string,
  matchedTerm: string,
  status: "sent" | "failed" | "suppressed",
  reason: string | null,
) {
  await db.insert(keywordHits).values({
    triggerId,
    groupId: input.group.id,
    contactId: input.contact.id,
    messageId: input.messageId,
    matchedTerm,
    excerpt: excerpt(input.rawText, 140),
    status,
    reason,
  });
}

async function ignoreFailure<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    console.error("[palavra-chave] resposta no grupo falhou:", (e as Error).message);
    return null;
  }
}
