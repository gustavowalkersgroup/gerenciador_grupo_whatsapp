import { and, asc, count, eq, inArray, lt, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { broadcastTargets, broadcasts, groupTags, groups, instances } from "@/lib/db/schema";
import { renderTemplate } from "@/lib/domain/text";
import { evolution } from "@/lib/evolution/client";

export interface BroadcastPayload {
  type: "text" | "image" | "video" | "document";
  text?: string;
  mediaUrl?: string;
  fileName?: string;
  mimetype?: string;
}

/** Monta a lista de alvos a partir de ids de grupo e/ou etiquetas. */
export async function resolveTargetGroupIds(input: {
  instanceId: string;
  groupIds?: string[];
  tagIds?: string[];
}): Promise<string[]> {
  const ids = new Set<string>();

  if (input.groupIds?.length) {
    const rows = await db
      .select({ id: groups.id })
      .from(groups)
      .where(
        and(
          eq(groups.instanceId, input.instanceId),
          eq(groups.managed, true),
          inArray(groups.id, input.groupIds),
        ),
      );
    rows.forEach((r) => ids.add(r.id));
  }

  if (input.tagIds?.length) {
    const rows = await db
      .select({ id: groups.id })
      .from(groups)
      .innerJoin(groupTags, eq(groupTags.groupId, groups.id))
      .where(
        and(
          eq(groups.instanceId, input.instanceId),
          eq(groups.managed, true),
          inArray(groupTags.tagId, input.tagIds),
        ),
      );
    rows.forEach((r) => ids.add(r.id));
  }

  return [...ids];
}

export async function createBroadcast(input: {
  instanceId: string;
  name: string;
  payload: BroadcastPayload;
  groupIds?: string[];
  tagIds?: string[];
  scheduledAt: Date | null;
  minDelayMs?: number;
  maxDelayMs?: number;
  createdBy?: string | null;
}) {
  const targetIds = await resolveTargetGroupIds(input);
  if (targetIds.length === 0) {
    throw new Error("Nenhum grupo gerenciado corresponde à seleção.");
  }

  const [broadcast] = await db
    .insert(broadcasts)
    .values({
      instanceId: input.instanceId,
      name: input.name,
      payload: input.payload,
      status: input.scheduledAt ? "scheduled" : "running",
      scheduledAt: input.scheduledAt,
      startedAt: input.scheduledAt ? null : new Date(),
      minDelayMs: input.minDelayMs ?? 6000,
      maxDelayMs: input.maxDelayMs ?? 18000,
      createdBy: input.createdBy ?? null,
    })
    .returning();

  await db
    .insert(broadcastTargets)
    .values(targetIds.map((groupId) => ({ broadcastId: broadcast.id, groupId })))
    .onConflictDoNothing();

  return { broadcast, targetCount: targetIds.length };
}

/** Promove agendados cuja hora chegou. */
export async function promoteScheduled(now = new Date()): Promise<number> {
  const rows = await db
    .update(broadcasts)
    .set({ status: "running", startedAt: now })
    .where(and(eq(broadcasts.status, "scheduled"), lte(broadcasts.scheduledAt, now)))
    .returning({ id: broadcasts.id });
  return rows.length;
}

export interface DispatchReport {
  /** Alvos destravados de uma execução anterior que morreu no meio. */
  released: number;
  promoted: number;
  processed: number;
  sent: number;
  failed: number;
  finished: string[];
  ranOutOfTime: boolean;
}

/**
 * Envia em lotes e volta antes do timeout da função. O estado fica todo no
 * banco, então a próxima execução do cron continua exatamente de onde parou —
 * é isso que faz um disparo de 300 grupos funcionar em serverless.
 */
export async function dispatchDue(opts: { deadlineMs: number; now?: Date }): Promise<DispatchReport> {
  const now = opts.now ?? new Date();
  const released = await releaseStaleClaims();
  const report: DispatchReport = {
    released,
    promoted: await promoteScheduled(now),
    processed: 0,
    sent: 0,
    failed: 0,
    finished: [],
    ranOutOfTime: false,
  };

  const running = await db
    .select({ b: broadcasts, inst: instances })
    .from(broadcasts)
    .innerJoin(instances, eq(broadcasts.instanceId, instances.id))
    .where(eq(broadcasts.status, "running"))
    .orderBy(asc(broadcasts.scheduledAt), asc(broadcasts.createdAt));

  for (const { b, inst } of running) {
    if (Date.now() >= opts.deadlineMs) {
      report.ranOutOfTime = true;
      break;
    }

    /**
     * Reserva os alvos ANTES de enviar, num único UPDATE atômico.
     *
     * Sem isto, duas execuções simultâneas do cron (a da Vercel e a do VPS,
     * ou duas invocações que se sobrepõem) leem a mesma lista de pendentes e
     * mandam a mesma mensagem duas vezes para o mesmo grupo. `FOR UPDATE SKIP
     * LOCKED` faz a segunda execução simplesmente pular o que a primeira já
     * pegou, em vez de esperar ou duplicar.
     */
    const claimed = await db.execute<{
      id: string;
      group_id: string;
      attempts: number;
      jid: string;
      name: string;
    }>(sql`
      with alvo as (
        select bt.id
          from broadcast_targets bt
         where bt.broadcast_id = ${b.id}::uuid
           and bt.status = 'pending'
         order by bt.id
         limit ${b.batchSize}
         for update skip locked
      )
      update broadcast_targets bt
         set status = 'sending', claimed_at = now()
        from alvo, groups g
       where bt.id = alvo.id
         and g.id = bt.group_id
      returning bt.id, bt.group_id, bt.attempts, g.jid, g.name
    `);

    const targets = [...claimed];

    if (targets.length === 0) {
      // Só encerra quando não sobrou nem pendente nem reservado por outra
      // execução — senão a campanha fecharia no meio do trabalho alheio.
      const [restante] = await db
        .select({ n: count() })
        .from(broadcastTargets)
        .where(
          and(
            eq(broadcastTargets.broadcastId, b.id),
            inArray(broadcastTargets.status, ["pending", "sending"]),
          ),
        );

      if ((restante?.n ?? 0) === 0) {
        await db
          .update(broadcasts)
          .set({ status: "done", finishedAt: new Date() })
          .where(eq(broadcasts.id, b.id));
        report.finished.push(b.name);
      }
      continue;
    }

    const payload = b.payload as BroadcastPayload;

    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];

      // Checa ANTES de enviar: passar do prazo no meio de um envio deixaria a
      // função ser morta pelo runtime com o alvo ainda reservado.
      if (Date.now() >= opts.deadlineMs) {
        report.ranOutOfTime = true;
        await releaseTargets(targets.slice(i).map((x) => x.id));
        break;
      }

      report.processed++;
      try {
        await sendToGroup(inst.evolutionName, t.jid, t.name, payload);
        await db
          .update(broadcastTargets)
          .set({
            status: "sent",
            sentAt: new Date(),
            attempts: t.attempts + 1,
            claimedAt: null,
            error: null,
          })
          .where(eq(broadcastTargets.id, t.id));
        report.sent++;
      } catch (e) {
        const msg = (e as Error).message.slice(0, 500);
        const attempts = t.attempts + 1;
        await db
          .update(broadcastTargets)
          // 3 tentativas e desiste — insistir num grupo de onde o número foi
          // removido só empurra o resto da fila pra trás.
          .set({
            status: attempts >= 3 ? "failed" : "pending",
            attempts,
            claimedAt: null,
            error: msg,
          })
          .where(eq(broadcastTargets.id, t.id));
        report.failed++;
      }

      await humanPause(b.minDelayMs, b.maxDelayMs, opts.deadlineMs);
    }
  }

  return report;
}

/** Devolve à fila alvos reservados que não chegaram a ser enviados. */
async function releaseTargets(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(broadcastTargets)
    .set({ status: "pending", claimedAt: null })
    .where(inArray(broadcastTargets.id, ids));
}

/**
 * Destrava alvos reservados por uma execução que morreu antes de terminar
 * (timeout duro, deploy no meio). Sem isto, um alvo ficaria "enviando" para
 * sempre e a campanha nunca fecharia.
 */
export async function releaseStaleClaims(olderThanMs = 5 * 60 * 1000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const rows = await db
    .update(broadcastTargets)
    .set({ status: "pending", claimedAt: null })
    .where(and(eq(broadcastTargets.status, "sending"), lt(broadcastTargets.claimedAt, cutoff)))
    .returning({ id: broadcastTargets.id });
  return rows.length;
}

async function sendToGroup(
  evolutionName: string,
  groupJid: string,
  groupName: string,
  payload: BroadcastPayload,
) {
  const text = renderTemplate(payload.text ?? "", { grupo: groupName });

  if (payload.type === "text") {
    if (!text.trim()) throw new Error("Disparo de texto sem conteúdo.");
    await evolution.message.sendText(evolutionName, { to: groupJid, text, delayMs: 1200 });
    return;
  }

  if (!payload.mediaUrl) throw new Error("Disparo de mídia sem URL.");
  await evolution.message.sendMedia(evolutionName, {
    to: groupJid,
    mediatype: payload.type,
    media: payload.mediaUrl,
    caption: text || undefined,
    fileName: payload.fileName,
    mimetype: payload.mimetype,
    delayMs: 1200,
  });
}

/**
 * Intervalo aleatório entre envios. Cadência fixa é o padrão mais fácil de
 * detectar — variar é o que mantém o número vivo.
 */
async function humanPause(minMs: number, maxMs: number, deadlineMs: number) {
  const lo = Math.max(0, minMs);
  const hi = Math.max(lo, maxMs);
  const wanted = lo + Math.floor(Math.random() * (hi - lo + 1));
  const available = deadlineMs - Date.now();
  const wait = Math.max(0, Math.min(wanted, available));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
