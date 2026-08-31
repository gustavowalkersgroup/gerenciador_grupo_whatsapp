"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { broadcastTargets, broadcasts, instances } from "@/lib/db/schema";
import {
  createBroadcast,
  resolveTargetGroupIds,
  type BroadcastPayload,
} from "@/lib/services/broadcast";

export interface ActionState {
  error?: string;
  ok?: string;
}

const ROUTE = "/disparos";

const idSchema = z.uuid("Identificador inválido.");

const inteiro = (rotulo: string) =>
  z.coerce
    .number({ error: `Informe um número válido em ${rotulo}.` })
    .int(`${rotulo} precisa ser um número inteiro.`);

/* ------------------------------------------------------------------ *
 * Fuso do agendamento
 * ------------------------------------------------------------------ */

const FUSO = "America/Sao_Paulo";

const partesNoFuso = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Deslocamento do fuso em ms no instante dado (negativo a oeste de Greenwich). */
function deslocamentoMs(instante: Date): number {
  const p: Record<string, string> = {};
  for (const parte of partesNoFuso.formatToParts(instante)) {
    if (parte.type !== "literal") p[parte.type] = parte.value;
  }
  const comoUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return comoUtc - (instante.getTime() - instante.getMilliseconds());
}

/**
 * O input datetime-local não carrega fuso e a função roda em UTC na Vercel:
 * ler "14:00" cru agendaria o disparo 3h antes do que o operador marcou.
 */
function paraDataSaoPaulo(local: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const comoUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  // Duas passadas: o deslocamento depende do instante, então a primeira
  // estimativa serve só pra descobrir de que lado de uma virada de horário caímos.
  const primeira = comoUtc - deslocamentoMs(new Date(comoUtc));
  const ts = comoUtc - deslocamentoMs(new Date(primeira));
  const data = new Date(ts);
  return Number.isNaN(data.getTime()) ? null : data;
}

/* ------------------------------------------------------------------ *
 * Validação
 * ------------------------------------------------------------------ */

const TIPOS = ["text", "image", "video", "document"] as const;

const disparoSchema = z.object({
  instanceId: idSchema,
  name: z
    .string()
    .trim()
    .min(2, "Dê um nome para a campanha.")
    .max(120, "O nome pode ter no máximo 120 caracteres."),
  type: z.enum(TIPOS, { error: "Escolha um tipo de conteúdo válido." }),
  text: z.string().max(4000, "O texto pode ter no máximo 4000 caracteres."),
  mediaUrl: z.union([
    z.literal(""),
    z.url("Informe uma URL de mídia válida, começando com https://"),
  ]),
  fileName: z.string().trim().max(200, "O nome do arquivo ficou grande demais."),
  groupIds: z.array(idSchema),
  tagIds: z.array(idSchema),
  scheduledAt: z.union([
    z.literal(""),
    z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Data de agendamento inválida."),
  ]),
  minDelaySeconds: inteiro("intervalo mínimo")
    .min(1, "O intervalo mínimo precisa ser de pelo menos 1 segundo.")
    .max(600, "O intervalo mínimo não pode passar de 600 segundos."),
  maxDelaySeconds: inteiro("intervalo máximo")
    .min(1, "O intervalo máximo precisa ser de pelo menos 1 segundo.")
    .max(600, "O intervalo máximo não pode passar de 600 segundos."),
});

/* ------------------------------------------------------------------ *
 * Criar campanha
 * ------------------------------------------------------------------ */

export async function criarDisparo(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();

  const parsed = disparoSchema.safeParse({
    instanceId: String(formData.get("instanceId") ?? ""),
    name: String(formData.get("name") ?? ""),
    type: String(formData.get("type") ?? ""),
    text: String(formData.get("text") ?? ""),
    mediaUrl: String(formData.get("mediaUrl") ?? "").trim(),
    fileName: String(formData.get("fileName") ?? ""),
    groupIds: formData.getAll("groupIds").map(String),
    tagIds: formData.getAll("tagIds").map(String),
    scheduledAt: String(formData.get("scheduledAt") ?? "").trim(),
    minDelaySeconds: String(formData.get("minDelaySeconds") ?? "6"),
    maxDelaySeconds: String(formData.get("maxDelaySeconds") ?? "18"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const dados = parsed.data;
  const texto = dados.text.trim();

  if (dados.maxDelaySeconds < dados.minDelaySeconds) {
    return { error: "O intervalo máximo precisa ser maior ou igual ao mínimo." };
  }
  if (dados.groupIds.length === 0 && dados.tagIds.length === 0) {
    return { error: "Selecione pelo menos um grupo ou uma etiqueta." };
  }
  if (dados.type === "text" && !texto) {
    return { error: "Escreva a mensagem que vai para os grupos." };
  }
  if (dados.type !== "text" && !dados.mediaUrl) {
    return { error: "Informe a URL da mídia que será enviada." };
  }

  const [instancia] = await db
    .select({ id: instances.id })
    .from(instances)
    .where(eq(instances.id, dados.instanceId))
    .limit(1);
  if (!instancia) return { error: "Número não encontrado." };

  let scheduledAt: Date | null = null;
  if (dados.scheduledAt) {
    scheduledAt = paraDataSaoPaulo(dados.scheduledAt);
    if (!scheduledAt) return { error: "Data de agendamento inválida." };
    // Um minuto de folga: entre escolher a hora e enviar o formulário o
    // relógio anda, e recusar por 10 segundos só irrita quem opera.
    if (scheduledAt.getTime() < Date.now() - 60_000) {
      return { error: "O agendamento precisa ser no futuro (horário de Brasília)." };
    }
  }

  // Conferido antes de gravar pra devolver uma mensagem precisa; o
  // createBroadcast resolve os alvos de novo por conta própria.
  const alvos = await resolveTargetGroupIds({
    instanceId: dados.instanceId,
    groupIds: dados.groupIds,
    tagIds: dados.tagIds,
  });
  if (alvos.length === 0) {
    return {
      error:
        "Nenhum grupo gerenciado corresponde à seleção. Confirme se os grupos estão marcados como gerenciados neste número.",
    };
  }

  const payload: BroadcastPayload =
    dados.type === "text"
      ? { type: "text", text: texto }
      : {
          type: dados.type,
          text: texto || undefined,
          mediaUrl: dados.mediaUrl,
          fileName: dados.type === "document" ? dados.fileName || undefined : undefined,
        };

  try {
    const { broadcast, targetCount } = await createBroadcast({
      instanceId: dados.instanceId,
      name: dados.name,
      payload,
      groupIds: dados.groupIds,
      tagIds: dados.tagIds,
      scheduledAt,
      minDelayMs: dados.minDelaySeconds * 1000,
      maxDelayMs: dados.maxDelaySeconds * 1000,
      createdBy: user.id,
    });

    revalidatePath(ROUTE);
    revalidatePath(`${ROUTE}/${broadcast.id}`);

    return {
      ok: scheduledAt
        ? `Campanha "${broadcast.name}" agendada para ${scheduledAt.toLocaleString("pt-BR", { timeZone: FUSO })} com ${targetCount} grupo(s).`
        : `Campanha "${broadcast.name}" criada com ${targetCount} grupo(s). O próximo ciclo do cron começa o envio.`,
    };
  } catch {
    return { error: "Não foi possível criar a campanha. Tente de novo." };
  }
}

/* ------------------------------------------------------------------ *
 * Controle da campanha
 * ------------------------------------------------------------------ */

function revalidar(id: string) {
  revalidatePath(ROUTE);
  revalidatePath(`${ROUTE}/${id}`);
}

export async function pausarDisparo(broadcastId: string): Promise<ActionState> {
  await requireUser();

  const parsed = idSchema.safeParse(broadcastId);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const [row] = await db
    .update(broadcasts)
    .set({ status: "paused" })
    .where(
      and(eq(broadcasts.id, parsed.data), inArray(broadcasts.status, ["running", "scheduled"])),
    )
    .returning({ id: broadcasts.id });
  if (!row) return { error: "Só dá para pausar campanha agendada ou em andamento." };

  revalidar(parsed.data);
  return { ok: "Campanha pausada. O lote que já estava em envio termina antes de parar." };
}

export async function retomarDisparo(broadcastId: string): Promise<ActionState> {
  await requireUser();

  const parsed = idSchema.safeParse(broadcastId);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const [campanha] = await db
    .select({
      id: broadcasts.id,
      status: broadcasts.status,
      scheduledAt: broadcasts.scheduledAt,
      startedAt: broadcasts.startedAt,
    })
    .from(broadcasts)
    .where(eq(broadcasts.id, parsed.data))
    .limit(1);
  if (!campanha) return { error: "Campanha não encontrada." };
  if (campanha.status !== "paused") return { error: "Só campanha pausada pode ser retomada." };

  // Se a hora marcada ainda não chegou, volta pra fila de agendadas em vez
  // de disparar na hora — quem pausou não pediu pra antecipar.
  const aindaAgendada = campanha.scheduledAt != null && campanha.scheduledAt.getTime() > Date.now();

  await db
    .update(broadcasts)
    .set({
      status: aindaAgendada ? "scheduled" : "running",
      startedAt: aindaAgendada ? campanha.startedAt : (campanha.startedAt ?? new Date()),
      finishedAt: null,
    })
    .where(eq(broadcasts.id, campanha.id));

  revalidar(parsed.data);
  return {
    ok: aindaAgendada
      ? "Campanha voltou para a fila de agendadas."
      : "Campanha retomada. O envio continua de onde parou.",
  };
}

export async function cancelarDisparo(broadcastId: string): Promise<ActionState> {
  await requireUser();

  const parsed = idSchema.safeParse(broadcastId);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const [row] = await db
    .update(broadcasts)
    .set({ status: "canceled", finishedAt: new Date() })
    .where(
      and(
        eq(broadcasts.id, parsed.data),
        inArray(broadcasts.status, ["draft", "scheduled", "running", "paused", "failed"]),
      ),
    )
    .returning({ id: broadcasts.id });
  if (!row) return { error: "Essa campanha já foi concluída ou cancelada." };

  // Alvo pendente vira "skipped": sem isso a fila voltaria a andar sozinha
  // se alguém reativasse a campanha depois.
  const pulados = await db
    .update(broadcastTargets)
    .set({ status: "skipped" })
    .where(
      and(
        eq(broadcastTargets.broadcastId, parsed.data),
        eq(broadcastTargets.status, "pending"),
      ),
    )
    .returning({ id: broadcastTargets.id });

  revalidar(parsed.data);
  return { ok: `Campanha cancelada. ${pulados.length} grupo(s) pendente(s) não vão receber.` };
}

export async function reenfileirarFalhados(broadcastId: string): Promise<ActionState> {
  await requireUser();

  const parsed = idSchema.safeParse(broadcastId);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const [campanha] = await db
    .select({
      id: broadcasts.id,
      status: broadcasts.status,
      startedAt: broadcasts.startedAt,
    })
    .from(broadcasts)
    .where(eq(broadcasts.id, parsed.data))
    .limit(1);
  if (!campanha) return { error: "Campanha não encontrada." };
  if (campanha.status === "canceled") {
    return { error: "Campanha cancelada. Crie uma nova campanha para reenviar." };
  }

  const voltaram = await db
    .update(broadcastTargets)
    .set({ status: "pending", attempts: 0, error: null })
    .where(
      and(eq(broadcastTargets.broadcastId, parsed.data), eq(broadcastTargets.status, "failed")),
    )
    .returning({ id: broadcastTargets.id });
  if (voltaram.length === 0) return { error: "Nenhum alvo falhado para reenfileirar." };

  // O cron só percorre campanha "running": sem reabrir o status, os alvos
  // reenfileirados ficariam pendentes pra sempre.
  if (campanha.status === "done" || campanha.status === "failed") {
    await db
      .update(broadcasts)
      .set({ status: "running", finishedAt: null, startedAt: campanha.startedAt ?? new Date() })
      .where(eq(broadcasts.id, campanha.id));
  }

  revalidar(parsed.data);
  return {
    ok:
      campanha.status === "paused"
        ? `${voltaram.length} alvo(s) voltaram para a fila. Retome a campanha para o cron enviar.`
        : `${voltaram.length} alvo(s) voltaram para a fila.`,
  };
}
