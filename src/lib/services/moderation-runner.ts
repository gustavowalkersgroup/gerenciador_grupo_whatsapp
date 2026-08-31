import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { groupMembers, moderationEvents, moderationRules } from "@/lib/db/schema";
import { evaluate, type MessageContext, type Rule } from "@/lib/domain/moderation";
import { excerpt, renderTemplate } from "@/lib/domain/text";
import { evolution } from "@/lib/evolution/client";
import type { MessageKey } from "@/lib/evolution/types";
import { bumpDailyStat, countRecentMessages } from "./stats";
import type { ContactRow, GroupRow, InstanceRow, MemberRow } from "./entities";

/** Regras específicas do grupo somadas às globais da instância. */
export async function loadRules(instanceId: string, groupId: string): Promise<Rule[]> {
  const rows = await db
    .select()
    .from(moderationRules)
    .where(
      and(
        eq(moderationRules.instanceId, instanceId),
        eq(moderationRules.enabled, true),
        or(eq(moderationRules.groupId, groupId), isNull(moderationRules.groupId)),
      ),
    );

  // Regra do grupo sobrescreve a global do mesmo tipo.
  const byKind = new Map<string, Rule>();
  for (const r of rows) {
    const mapped: Rule = {
      id: r.id,
      kind: r.kind,
      action: r.action,
      removeAtStrikes: r.removeAtStrikes,
      config: (r.config ?? {}) as Rule["config"],
      warnTemplate: r.warnTemplate,
      exemptAdmins: r.exemptAdmins,
      enabled: r.enabled,
    };
    const existing = byKind.get(r.kind);
    if (!existing || r.groupId) byKind.set(r.kind, mapped);
  }
  return [...byKind.values()];
}

export interface ModerationInput {
  instance: InstanceRow;
  group: GroupRow;
  contact: ContactRow;
  member: MemberRow;
  key: MessageKey;
  rawText: string;
  messageType: string;
  hasMedia: boolean;
  senderIsAdmin: boolean;
  minutesOfDay: number;
}

export interface ModerationOutcome {
  applied: boolean;
  kind?: string;
  action?: string;
  removed?: boolean;
}

/**
 * Avalia e aplica. Só a violação mais severa vira ação — apagar a mensagem
 * duas vezes por duas regras diferentes só gera ruído no grupo.
 */
export async function runModeration(input: ModerationInput): Promise<ModerationOutcome> {
  const rules = await loadRules(input.instance.id, input.group.id);
  if (rules.length === 0) return { applied: false };

  const floodRule = rules.find((r) => r.kind === "anti_flood");
  const recentCount = floodRule
    ? await countRecentMessages(
        input.group.id,
        input.contact.id,
        floodRule.config.windowSeconds ?? 10,
      )
    : 0;

  const ctx: MessageContext = {
    rawText: input.rawText,
    messageType: input.messageType,
    hasMedia: input.hasMedia,
    senderIsAdmin: input.senderIsAdmin,
    senderIsBot: input.key.fromMe,
    recentCount,
    minutesOfDay: input.minutesOfDay,
  };

  const [violation] = evaluate(rules, ctx);
  if (!violation) return { applied: false };

  // Sem ser admin do grupo não dá pra apagar mensagem nem remover ninguém.
  if (!input.group.botIsAdmin && violation.action !== "warn") {
    await logEvent(input, violation.ruleId, violation.kind, "warn", 0);
    return { applied: false };
  }

  const wantsDelete = violation.action === "delete" || violation.action === "delete_and_warn";
  const wantsWarn = violation.action === "warn" || violation.action === "delete_and_warn";
  const wantsRemove = violation.action === "remove";

  let strikes = input.member.strikes;
  if (wantsWarn || wantsRemove) {
    const [updated] = await db
      .update(groupMembers)
      .set({ strikes: sql`${groupMembers.strikes} + 1` })
      .where(eq(groupMembers.id, input.member.id))
      .returning({ strikes: groupMembers.strikes });
    strikes = updated?.strikes ?? strikes + 1;
  }

  if (wantsDelete) {
    await safe(() =>
      evolution.message.deleteForEveryone(input.instance.evolutionName, {
        id: input.key.id,
        remoteJid: input.key.remoteJid,
        fromMe: false,
        participant: input.key.participant,
      }),
    );
  }

  const limit = violation.removeAtStrikes;
  const shouldRemove = wantsRemove || (limit > 0 && strikes >= limit);

  if (wantsWarn && !shouldRemove) {
    const text = renderTemplate(violation.warnTemplate ?? "", {
      nome: input.contact.pushName ?? "você",
      grupo: input.group.name,
      strikes: String(strikes),
      limite: String(limit || "∞"),
      motivo: violation.reason,
    });
    if (text.trim()) {
      await safe(() =>
        evolution.message.sendText(input.instance.evolutionName, {
          to: input.group.jid,
          text,
          mentions: [input.contact.jid],
        }),
      );
    }
  }

  if (shouldRemove) {
    await safe(() =>
      evolution.group.updateParticipants(
        input.instance.evolutionName,
        input.group.jid,
        "remove",
        [input.contact.jid],
      ),
    );
  }

  await logEvent(
    input,
    violation.ruleId,
    violation.kind,
    shouldRemove ? "remove" : violation.action,
    strikes,
  );
  await bumpDailyStat(input.group.id, "moderations");

  return {
    applied: true,
    kind: violation.kind,
    action: shouldRemove ? "remove" : violation.action,
    removed: shouldRemove,
  };
}

async function logEvent(
  input: ModerationInput,
  ruleId: string,
  kind: Rule["kind"],
  action: string,
  strikes: number,
) {
  await db.insert(moderationEvents).values({
    groupId: input.group.id,
    contactId: input.contact.id,
    ruleId,
    kind,
    action: action as never,
    messageId: input.key.id,
    excerpt: excerpt(input.rawText, 120),
    strikesAfter: strikes,
  });
}

/**
 * Uma chamada que falha na Evolution (número saiu do grupo, perdeu admin)
 * não pode derrubar o webhook inteiro — o resto do processamento continua.
 */
async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    console.error("[moderacao] falha ao aplicar acao:", (e as Error).message);
    return null;
  }
}
