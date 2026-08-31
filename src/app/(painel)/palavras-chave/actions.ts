"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { groups, instances, keywordTriggers, tags } from "@/lib/db/schema";
import { matchTriggers, type MatchMode, type Trigger } from "@/lib/domain/keywords";

export interface EstadoGatilho {
  error?: string;
  ok?: string;
  /** Muda a cada resposta pro formulário saber que houve um envio novo. */
  at?: number;
}

const ROTA = "/palavras-chave";
const idSchema = z.uuid("Identificador inválido.");
const OPCAO_NOVA_ETIQUETA = "__nova__";

function agora(estado: EstadoGatilho): EstadoGatilho {
  return { ...estado, at: Date.now() };
}

/** Textarea "uma por linha" -> array limpo, sem duplicata e sem linha vazia. */
function linhas(valor: FormDataEntryValue | null): string[] {
  const brutas = String(valor ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return [...new Set(brutas)];
}

function numero(valor: FormDataEntryValue | null, padrao: number): number {
  const bruto = String(valor ?? "").trim();
  if (!bruto) return padrao;
  const n = Number(bruto);
  return Number.isFinite(n) ? n : Number.NaN;
}

/* ------------------------------------------------------------------ *
 * Salvar (criar ou editar)
 * ------------------------------------------------------------------ */

const gatilhoSchema = z.object({
  id: z.union([z.literal(""), idSchema]),
  instanceId: idSchema,
  groupId: z.union([z.literal(""), idSchema]),
  name: z.string().trim().min(1, "Dê um nome ao gatilho.").max(120, "Nome muito longo."),
  keywords: z.array(z.string()).min(1, "Informe ao menos uma palavra-chave."),
  requiredAll: z.array(z.string()),
  negativeKeywords: z.array(z.string()),
  mode: z.enum(["contains", "exact", "starts_with", "regex"], { error: "Modo inválido." }),
  priority: z
    .number("A prioridade precisa ser um número.")
    .int("A prioridade precisa ser um número inteiro.")
    .min(-100, "Prioridade mínima: -100.")
    .max(100, "Prioridade máxima: 100."),
  dmTemplate: z
    .string()
    .trim()
    .min(1, "Escreva a mensagem que vai para o privado.")
    .max(4000, "Mensagem muito longa."),
  dmMediaUrl: z.union([z.literal(""), z.url("URL de mídia inválida.")]),
  dmMediaType: z.enum(["image", "video", "document"], { error: "Tipo de mídia inválido." }),
  replyInGroup: z.boolean(),
  groupReplyTemplate: z.string().trim().max(2000, "Resposta no grupo muito longa."),
  cooldownMinutes: z
    .number("O cooldown precisa ser um número.")
    .int("O cooldown precisa ser um número inteiro.")
    .min(0, "O cooldown não pode ser negativo.")
    .max(43200, "O cooldown máximo é de 43200 minutos (30 dias)."),
  dailyLimit: z
    .number("O teto diário precisa ser um número.")
    .int("O teto diário precisa ser um número inteiro.")
    .min(0, "O teto diário não pode ser negativo.")
    .max(10000, "Teto diário alto demais para um número de WhatsApp."),
  applyTagId: z.union([z.literal(""), z.literal(OPCAO_NOVA_ETIQUETA), idSchema]),
  novaEtiqueta: z.string().trim().max(60, "Nome de etiqueta muito longo."),
  enabled: z.boolean(),
});

/** Regex inválida só aparece quando alguém fala no grupo — melhor barrar aqui. */
function regexInvalida(padroes: string[]): string | null {
  for (const p of padroes) {
    try {
      new RegExp(p, "iu");
    } catch {
      return p;
    }
  }
  return null;
}

async function resolverEtiqueta(
  applyTagId: string,
  novaEtiqueta: string,
): Promise<{ id: string | null } | { error: string }> {
  if (applyTagId !== OPCAO_NOVA_ETIQUETA) return { id: applyTagId || null };

  const nome = novaEtiqueta.trim();
  if (!nome) return { error: "Dê um nome para a nova etiqueta." };

  const [criada] = await db
    .insert(tags)
    .values({ name: nome })
    .onConflictDoNothing()
    .returning({ id: tags.id });
  if (criada) return { id: criada.id };

  // Já existia (o índice único é sobre lower(name)): reaproveita em vez de duplicar.
  const [existente] = await db
    .select({ id: tags.id })
    .from(tags)
    .where(sql`lower(${tags.name}) = lower(${nome})`)
    .limit(1);
  if (!existente) return { error: "Não foi possível criar a etiqueta." };
  return { id: existente.id };
}

export async function salvarGatilho(
  _prev: EstadoGatilho,
  formData: FormData,
): Promise<EstadoGatilho> {
  await requireUser();

  const parsed = gatilhoSchema.safeParse({
    id: String(formData.get("id") ?? "").trim(),
    instanceId: String(formData.get("instanceId") ?? "").trim(),
    groupId: String(formData.get("groupId") ?? "").trim(),
    name: String(formData.get("name") ?? ""),
    keywords: linhas(formData.get("keywords")),
    requiredAll: linhas(formData.get("requiredAll")),
    negativeKeywords: linhas(formData.get("negativeKeywords")),
    mode: String(formData.get("mode") ?? "contains"),
    priority: numero(formData.get("priority"), 0),
    dmTemplate: String(formData.get("dmTemplate") ?? ""),
    dmMediaUrl: String(formData.get("dmMediaUrl") ?? "").trim(),
    dmMediaType: String(formData.get("dmMediaType") ?? "image"),
    replyInGroup: formData.get("replyInGroup") === "on",
    groupReplyTemplate: String(formData.get("groupReplyTemplate") ?? ""),
    cooldownMinutes: numero(formData.get("cooldownMinutes"), 1440),
    dailyLimit: numero(formData.get("dailyLimit"), 100),
    applyTagId: String(formData.get("applyTagId") ?? "").trim(),
    novaEtiqueta: String(formData.get("novaEtiqueta") ?? ""),
    enabled: formData.get("enabled") === "on",
  });
  if (!parsed.success) return agora({ error: parsed.error.issues[0].message });

  const dados = parsed.data;

  if (dados.mode === "regex") {
    const ruim = regexInvalida([...dados.keywords, ...dados.negativeKeywords]);
    if (ruim) return agora({ error: `Expressão regular inválida: "${ruim}".` });
  }

  if (dados.replyInGroup && !dados.groupReplyTemplate) {
    return agora({ error: "Escreva o texto da resposta no grupo ou desmarque a opção." });
  }

  const [instancia] = await db
    .select({ id: instances.id })
    .from(instances)
    .where(eq(instances.id, dados.instanceId))
    .limit(1);
  if (!instancia) return agora({ error: "Número não encontrado." });

  if (dados.groupId) {
    const [grupo] = await db
      .select({ id: groups.id })
      .from(groups)
      .where(and(eq(groups.id, dados.groupId), eq(groups.instanceId, dados.instanceId)))
      .limit(1);
    if (!grupo) return agora({ error: "O grupo escolhido não pertence a esse número." });
  }

  const etiqueta = await resolverEtiqueta(dados.applyTagId, dados.novaEtiqueta);
  if ("error" in etiqueta) return agora({ error: etiqueta.error });

  const valores = {
    instanceId: dados.instanceId,
    groupId: dados.groupId || null,
    name: dados.name,
    keywords: dados.keywords,
    requiredAll: dados.requiredAll,
    negativeKeywords: dados.negativeKeywords,
    mode: dados.mode,
    priority: dados.priority,
    dmTemplate: dados.dmTemplate,
    dmMediaUrl: dados.dmMediaUrl || null,
    dmMediaType: dados.dmMediaUrl ? dados.dmMediaType : null,
    replyInGroup: dados.replyInGroup,
    groupReplyTemplate: dados.replyInGroup ? dados.groupReplyTemplate : null,
    cooldownMinutes: dados.cooldownMinutes,
    dailyLimit: dados.dailyLimit,
    applyTagId: etiqueta.id,
    enabled: dados.enabled,
  };

  if (dados.id) {
    const [alterado] = await db
      .update(keywordTriggers)
      .set(valores)
      .where(eq(keywordTriggers.id, dados.id))
      .returning({ id: keywordTriggers.id });
    if (!alterado) return agora({ error: "Gatilho não encontrado." });
    revalidatePath(ROTA);
    return agora({ ok: `Gatilho "${dados.name}" atualizado.` });
  }

  await db.insert(keywordTriggers).values(valores);
  revalidatePath(ROTA);
  return agora({
    ok: dados.enabled
      ? `Gatilho "${dados.name}" criado e ativo.`
      : `Gatilho "${dados.name}" criado (desativado).`,
  });
}

/* ------------------------------------------------------------------ *
 * Ações de linha
 * ------------------------------------------------------------------ */

export async function alternarGatilho(id: string, ativo: boolean): Promise<EstadoGatilho> {
  await requireUser();

  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const [row] = await db
    .update(keywordTriggers)
    .set({ enabled: ativo })
    .where(eq(keywordTriggers.id, parsed.data))
    .returning({ name: keywordTriggers.name });
  if (!row) return { error: "Gatilho não encontrado." };

  revalidatePath(ROTA);
  return { ok: ativo ? `"${row.name}" ativado.` : `"${row.name}" desativado.` };
}

export async function duplicarGatilho(id: string): Promise<EstadoGatilho> {
  await requireUser();

  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const [original] = await db
    .select()
    .from(keywordTriggers)
    .where(eq(keywordTriggers.id, parsed.data))
    .limit(1);
  if (!original) return { error: "Gatilho não encontrado." };

  // Cópia nasce desativada: ninguém quer duas regras iguais disparando junto.
  await db.insert(keywordTriggers).values({
    instanceId: original.instanceId,
    groupId: original.groupId,
    name: `${original.name} (cópia)`.slice(0, 120),
    keywords: original.keywords,
    requiredAll: original.requiredAll,
    negativeKeywords: original.negativeKeywords,
    mode: original.mode,
    dmTemplate: original.dmTemplate,
    dmMediaUrl: original.dmMediaUrl,
    dmMediaType: original.dmMediaType,
    replyInGroup: original.replyInGroup,
    groupReplyTemplate: original.groupReplyTemplate,
    cooldownMinutes: original.cooldownMinutes,
    dailyLimit: original.dailyLimit,
    applyTagId: original.applyTagId,
    priority: original.priority,
    enabled: false,
  });

  revalidatePath(ROTA);
  return { ok: `Cópia de "${original.name}" criada, desativada. Revise antes de ligar.` };
}

export async function excluirGatilho(id: string): Promise<EstadoGatilho> {
  await requireUser();

  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const [row] = await db
    .delete(keywordTriggers)
    .where(eq(keywordTriggers.id, parsed.data))
    .returning({ name: keywordTriggers.name });
  if (!row) return { error: "Gatilho não encontrado." };

  revalidatePath(ROTA);
  return { ok: `"${row.name}" excluído junto com o histórico dele.` };
}

/* ------------------------------------------------------------------ *
 * Teste a seco — não envia nada
 * ------------------------------------------------------------------ */

export interface ResultadoTeste {
  id: string;
  nome: string;
  termo: string;
  modo: MatchMode;
  ativo: boolean;
  escopo: string;
  noEscopo: boolean;
  /** O runner envia só o primeiro da fila; este é ele. */
  dispararia: boolean;
}

export interface EstadoTeste {
  error?: string;
  frase?: string;
  grupoId?: string;
  resultados?: ResultadoTeste[];
  at?: number;
}

const testeSchema = z.object({
  instanceId: idSchema,
  grupoId: z.union([z.literal(""), idSchema]),
  frase: z.string().trim().min(1, "Escreva a frase que você quer testar.").max(2000),
});

/** O jsonb chega como unknown; array sujo não pode quebrar a tela. */
function comoLista(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

export async function testarFrase(_prev: EstadoTeste, formData: FormData): Promise<EstadoTeste> {
  await requireUser();

  const frase = String(formData.get("frase") ?? "");
  const grupoId = String(formData.get("grupoId") ?? "").trim();

  const parsed = testeSchema.safeParse({
    instanceId: String(formData.get("instanceId") ?? "").trim(),
    grupoId,
    frase,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message, frase, grupoId, at: Date.now() };
  }

  const linhasBanco = await db
    .select({
      id: keywordTriggers.id,
      name: keywordTriggers.name,
      keywords: keywordTriggers.keywords,
      requiredAll: keywordTriggers.requiredAll,
      negativeKeywords: keywordTriggers.negativeKeywords,
      mode: keywordTriggers.mode,
      priority: keywordTriggers.priority,
      enabled: keywordTriggers.enabled,
      groupId: keywordTriggers.groupId,
      groupName: groups.name,
    })
    .from(keywordTriggers)
    .leftJoin(groups, eq(keywordTriggers.groupId, groups.id))
    .where(eq(keywordTriggers.instanceId, parsed.data.instanceId));

  const porId = new Map(linhasBanco.map((r) => [r.id, r]));

  // Avaliamos até os desativados (enabled: true forçado) para o operador ver
  // que a regra casa mesmo antes de ligá-la — o estado real vai na coluna.
  const paraCasar: Trigger[] = linhasBanco.map((r) => ({
    id: r.id,
    name: r.name,
    keywords: comoLista(r.keywords),
    requiredAll: comoLista(r.requiredAll),
    negativeKeywords: comoLista(r.negativeKeywords),
    mode: r.mode,
    priority: r.priority,
    enabled: true,
    groupId: r.groupId,
  }));

  const casados = matchTriggers(paraCasar, parsed.data.frase);
  const alvo = parsed.data.grupoId;
  let jaMarcouVencedor = false;

  const resultados: ResultadoTeste[] = casados.map((m) => {
    const row = porId.get(m.trigger.id);
    const noEscopo = !alvo || row?.groupId === null || row?.groupId === alvo;
    const ativo = row?.enabled ?? false;
    const dispararia = ativo && noEscopo && !jaMarcouVencedor;
    if (dispararia) jaMarcouVencedor = true;

    return {
      id: m.trigger.id,
      nome: m.trigger.name,
      termo: m.matchedTerm,
      modo: m.trigger.mode,
      ativo,
      escopo: row?.groupId ? (row.groupName ?? "grupo específico") : "todos os grupos",
      noEscopo,
      dispararia,
    };
  });

  return { frase: parsed.data.frase, grupoId: alvo, resultados, at: Date.now() };
}
