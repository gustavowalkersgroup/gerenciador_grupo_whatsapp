import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contacts, instances, webhookEvents } from "@/lib/db/schema";
import { isGroupJid, normalizeJid, senderJid } from "@/lib/domain/jid";
import { isOptOutMessage } from "@/lib/domain/keywords";
import { evolution } from "@/lib/evolution/client";
import { extractText, hasMedia, messageTimestampMs, messageType } from "@/lib/evolution/message";
import type {
  ConnectionUpdate,
  EvolutionGroup,
  GroupParticipantsUpdate,
  IncomingMessage,
  WebhookEnvelope,
} from "@/lib/evolution/types";
import { env } from "@/lib/env";
import {
  bumpMemberActivity,
  findGroup,
  findInstanceByName,
  markMemberLeft,
  upsertContact,
  upsertGroup,
  upsertMember,
  type GroupRow,
  type InstanceRow,
} from "@/lib/services/entities";
import { runKeywordTriggers } from "@/lib/services/keywords-runner";
import { runModeration } from "@/lib/services/moderation-runner";
import { sendFarewell, sendWelcome } from "@/lib/services/welcome-runner";
import { bumpDailyStat, recordMessageEvent } from "@/lib/services/stats";
import { dedupeKey, secretMatches } from "@/lib/webhook/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!secretMatches(req.headers.get("x-webhook-secret"), env().WEBHOOK_SECRET)) {
    // 401 sem corpo: não confirma pro atacante se a rota existe de verdade.
    return new NextResponse(null, { status: 401 });
  }

  let envelope: WebhookEnvelope;
  try {
    envelope = (await req.json()) as WebhookEnvelope;
  } catch {
    return NextResponse.json({ ok: false, error: "json inválido" }, { status: 400 });
  }

  const event = String(envelope.event ?? "").toLowerCase().replace(/_/g, "-");
  const instanceName = envelope.instance;
  if (!event || !instanceName) {
    return NextResponse.json({ ok: false, error: "envelope incompleto" }, { status: 400 });
  }

  // Idempotência: quem já foi processado sai daqui sem efeito colateral.
  const key = dedupeKey(event, instanceName, envelope.data);
  const claimed = await db
    .insert(webhookEvents)
    .values({ dedupeKey: key, event, instanceName, payload: null })
    .onConflictDoNothing({ target: webhookEvents.dedupeKey })
    .returning({ id: webhookEvents.id });

  if (claimed.length === 0) {
    return NextResponse.json({ ok: true, deduped: true });
  }
  const eventRowId = claimed[0].id;

  try {
    const result = await route(event, instanceName, envelope.data);
    await db
      .update(webhookEvents)
      .set({ processedAt: new Date() })
      .where(eq(webhookEvents.id, eventRowId));
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`[webhook] ${event} falhou:`, msg);
    await db
      .update(webhookEvents)
      .set({ processedAt: new Date(), error: msg })
      .where(eq(webhookEvents.id, eventRowId));
    // 200 de propósito: a Evolution reenviaria em loop e o erro já está registrado.
    return NextResponse.json({ ok: false, error: msg });
  }
}

async function route(event: string, instanceName: string, data: unknown) {
  const instance = await findInstanceByName(instanceName);
  if (!instance) return { skipped: "instância não cadastrada" };

  switch (event) {
    case "messages.upsert":
      return handleMessage(instance, data as IncomingMessage | { messages?: IncomingMessage[] });
    case "group-participants.update":
      return handleParticipants(instance, data as GroupParticipantsUpdate);
    case "groups.upsert":
    case "groups.update":
      return handleGroupInfo(instance, data as EvolutionGroup | EvolutionGroup[]);
    case "connection.update":
      return handleConnection(instance, data as ConnectionUpdate);
    default:
      return { skipped: `evento ignorado: ${event}` };
  }
}

/* ------------------------------------------------------------------ *
 * Mensagens
 * ------------------------------------------------------------------ */

async function handleMessage(
  instance: InstanceRow,
  data: IncomingMessage | { messages?: IncomingMessage[] },
) {
  const msg: IncomingMessage | undefined =
    "key" in data ? data : Array.isArray(data?.messages) ? data.messages[0] : undefined;
  if (!msg?.key?.remoteJid) return { skipped: "sem remoteJid" };

  const remoteJid = normalizeJid(msg.key.remoteJid);
  const text = extractText(msg);

  if (!isGroupJid(remoteJid)) {
    return handlePrivateMessage(msg, remoteJid, text);
  }

  if (msg.key.fromMe) return { skipped: "mensagem do próprio bot" };

  const author = senderJid(msg.key);
  if (!author) return { skipped: "autor desconhecido" };

  const group = await findGroup(instance.id, remoteJid);
  if (!group) {
    // Grupo novo: registra pra aparecer no painel, mas não age sem configuração.
    await upsertGroup(instance.id, remoteJid, { managed: false });
    return { skipped: "grupo ainda não gerenciado" };
  }
  if (!group.managed) return { skipped: "grupo fora do gerenciamento" };

  const contact = await upsertContact(author, msg.pushName);
  const member = await upsertMember(group.id, contact.id);

  const at = new Date(messageTimestampMs(msg) ?? Date.now());
  const isNew = await recordMessageEvent({
    groupId: group.id,
    contactId: contact.id,
    messageId: msg.key.id ?? null,
    messageType: messageType(msg),
    at,
  });
  if (!isNew) return { deduped: true };

  await bumpMemberActivity(group.id, contact.id, at);
  await bumpDailyStat(group.id, "messages");

  const moderation = await runModeration({
    instance,
    group,
    contact,
    member,
    key: { ...msg.key, remoteJid },
    rawText: text,
    messageType: messageType(msg),
    hasMedia: hasMedia(msg),
    senderIsAdmin: member.isAdmin,
    minutesOfDay: minutesOfDayIn(instance, at),
  });

  // Mensagem que foi moderada não vira lead — o autor acabou de infringir a regra.
  if (moderation.applied) {
    return { moderated: moderation };
  }

  const keyword = await runKeywordTriggers({
    instance,
    group,
    contact,
    rawText: text,
    messageId: msg.key.id ?? null,
    senderIsAdmin: member.isAdmin,
  });

  return { keyword };
}

/** No privado só nos interessa quem está pedindo pra parar de receber. */
async function handlePrivateMessage(msg: IncomingMessage, remoteJid: string, text: string) {
  if (msg.key.fromMe || !text) return { skipped: "privado sem texto" };
  if (!isOptOutMessage(text)) return { skipped: "privado sem opt-out" };

  const contact = await upsertContact(remoteJid, msg.pushName);
  if (contact.optOut) return { optOut: "já estava" };

  await db
    .update(contacts)
    .set({ optOut: true, optOutAt: new Date() })
    .where(eq(contacts.id, contact.id));

  return { optOut: "registrado" };
}

/* ------------------------------------------------------------------ *
 * Participantes
 * ------------------------------------------------------------------ */

async function handleParticipants(instance: InstanceRow, data: GroupParticipantsUpdate) {
  if (!data?.id || !Array.isArray(data.participants)) return { skipped: "payload inválido" };

  const groupJid = normalizeJid(data.id);
  const group = await findGroup(instance.id, groupJid);
  if (!group?.managed) return { skipped: "grupo fora do gerenciamento" };

  const results: string[] = [];

  for (const raw of data.participants) {
    const jid = normalizeJid(raw);
    const contact = await upsertContact(jid);

    switch (data.action) {
      case "add": {
        await upsertMember(group.id, contact.id, { joinedAt: new Date(), leftAt: null });
        await bumpDailyStat(group.id, "joins");
        const sent = await sendWelcome({ instance, group, contact });
        results.push(sent ? "boas-vindas enviada" : "entrada registrada");
        break;
      }
      case "remove": {
        await markMemberLeft(group.id, contact.id);
        await bumpDailyStat(group.id, "leaves");
        await sendFarewell({ instance, group, contact });
        results.push("saída registrada");
        break;
      }
      case "promote":
      case "demote": {
        await upsertMember(group.id, contact.id, { isAdmin: data.action === "promote" });
        results.push(`admin: ${data.action}`);
        break;
      }
    }
  }

  await refreshCount(instance, group);
  return { participants: results };
}

/** Mantém o contador de membros e o "sou admin?" em dia sem sync completo. */
async function refreshCount(instance: InstanceRow, group: GroupRow) {
  try {
    const info = await evolution.group.info(instance.evolutionName, group.jid);
    await upsertGroup(instance.id, group.jid, {
      name: info.subject ?? group.name,
      participantsCount: info.size ?? info.participants?.length ?? group.participantsCount,
    });
  } catch {
    // A Evolution às vezes não responde logo após a mudança; o sync manual corrige.
  }
}

/* ------------------------------------------------------------------ *
 * Grupo e conexão
 * ------------------------------------------------------------------ */

async function handleGroupInfo(instance: InstanceRow, data: EvolutionGroup | EvolutionGroup[]) {
  const list = Array.isArray(data) ? data : [data];
  let n = 0;
  for (const g of list) {
    if (!g?.id) continue;
    await upsertGroup(instance.id, normalizeJid(g.id), {
      name: g.subject ?? "",
      description: g.desc ?? null,
      ownerJid: g.owner ? normalizeJid(g.owner) : null,
      participantsCount: g.size ?? g.participants?.length ?? 0,
    });
    n++;
  }
  return { groupsSynced: n };
}

async function handleConnection(instance: InstanceRow, data: ConnectionUpdate) {
  const map = {
    open: "connected",
    connecting: "connecting",
    close: "disconnected",
    refused: "banned",
  } as const;
  const status = data?.state ? map[data.state] : undefined;
  if (!status) return { skipped: "estado desconhecido" };

  await db
    .update(instances)
    .set({ status, lastSeenAt: new Date() })
    .where(eq(instances.id, instance.id));

  return { connection: status };
}

/** Minutos desde a meia-noite no fuso configurado — usado pelo "só admin". */
function minutesOfDayIn(_instance: InstanceRow, at: Date): number {
  const fmt = new Intl.DateTimeFormat("pt-BR", {
    timeZone: env().TZ_DEFAULT,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(at);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return h * 60 + m;
}
