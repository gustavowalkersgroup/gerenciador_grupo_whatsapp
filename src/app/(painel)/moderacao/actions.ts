"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { groups, instances, moderationRules } from "@/lib/db/schema";
import { jidToPhone } from "@/lib/domain/jid";
import type { RuleConfig } from "@/lib/domain/moderation";
import { EvolutionError, evolution } from "@/lib/evolution/client";

export interface ActionState {
  error?: string;
  ok?: string;
}

const ROUTE = "/moderacao";

const idSchema = z.uuid("Identificador inválido.");

/** Traduz a falha da Evolution pra algo que o operador entenda sem abrir log. */
function mensagemEvolution(e: unknown, contexto: string): string {
  if (e instanceof EvolutionError) {
    if (e.status === 0) return `${contexto}: a Evolution API não respondeu (número fora do ar?).`;
    if (e.status === 401 || e.status === 403)
      return `${contexto}: sem permissão. Confirme se o número é admin do grupo.`;
    if (e.status === 404) return `${contexto}: grupo ou número não encontrado na Evolution API.`;
    if (e.status === 429)
      return `${contexto}: a Evolution API pediu pra desacelerar. Tente em instantes.`;
    return `${contexto}: a Evolution API respondeu ${e.status}.`;
  }
  return `${contexto}: ${(e as Error).message}`;
}

/* ------------------------------------------------------------------ *
 * Validação
 * ------------------------------------------------------------------ */

const TIPOS_MIDIA = [
  "imageMessage",
  "videoMessage",
  "audioMessage",
  "documentMessage",
  "stickerMessage",
] as const;

const TIPOS_REGRA = [
  "anti_link",
  "anti_flood",
  "banned_words",
  "anti_media",
  "only_admins",
] as const;

const horarioSchema = z.union([
  z.literal(""),
  z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use o formato HH:MM, entre 00:00 e 23:59."),
]);

const inteiro = (rotulo: string) =>
  z.coerce
    .number({ error: `Informe um número válido em ${rotulo}.` })
    .int(`${rotulo} precisa ser um número inteiro.`);

const comum = {
  id: z.union([z.literal(""), idSchema]),
  instanceId: idSchema,
  groupId: z.union([z.literal(""), idSchema]),
  action: z.enum(["warn", "delete", "delete_and_warn", "remove"], {
    error: "Escolha uma ação válida.",
  }),
  removeAtStrikes: inteiro("remoção por strikes")
    .min(0, "Use 0 para nunca remover automaticamente.")
    .max(20, "Acima de 20 strikes a regra deixa de fazer efeito na prática."),
  exemptAdmins: z.boolean(),
  enabled: z.boolean(),
  warnTemplate: z.string().trim().max(1000, "O aviso pode ter no máximo 1000 caracteres."),
};

const regraSchema = z.discriminatedUnion("kind", [
  z.object({
    ...comum,
    kind: z.literal("anti_link"),
    allowDomains: z.string().max(4000, "A lista de domínios ficou grande demais."),
    onlyWhatsAppInvites: z.boolean(),
  }),
  z.object({
    ...comum,
    kind: z.literal("banned_words"),
    words: z.string().max(8000, "A lista de palavras ficou grande demais."),
  }),
  z.object({
    ...comum,
    kind: z.literal("anti_flood"),
    maxMessages: inteiro("máximo de mensagens")
      .min(1, "O máximo de mensagens precisa ser pelo menos 1.")
      .max(100, "Acima de 100 mensagens a regra nunca dispara."),
    windowSeconds: inteiro("janela")
      .min(1, "A janela precisa ter pelo menos 1 segundo.")
      .max(3600, "A janela não pode passar de 3600 segundos."),
  }),
  z.object({
    ...comum,
    kind: z.literal("anti_media"),
    blockedTypes: z.array(z.enum(TIPOS_MIDIA, { error: "Tipo de mídia inválido." })),
  }),
  z.object({
    ...comum,
    kind: z.literal("only_admins"),
    quietFrom: horarioSchema,
    quietTo: horarioSchema,
  }),
]);

type RegraValidada = z.infer<typeof regraSchema>;

/* ------------------------------------------------------------------ *
 * Helpers de config
 * ------------------------------------------------------------------ */

function linhas(valor: string): string[] {
  const vistos = new Set<string>();
  for (const linha of valor.split(/\r?\n/)) {
    const limpo = linha.trim();
    if (limpo) vistos.add(limpo);
  }
  return [...vistos];
}

/** "https://www.Loja.com.br/promo" e "loja.com.br" precisam virar a mesma entrada. */
function dominios(valor: string): string[] {
  const vistos = new Set<string>();
  for (const bruto of linhas(valor)) {
    const host = bruto
      .toLowerCase()
      .replace(/^[a-z]+:\/\//, "")
      .replace(/^www\./, "")
      .split(/[/?#]/)[0]
      .trim();
    if (host) vistos.add(host);
  }
  return [...vistos];
}

function montarConfig(dados: RegraValidada): RuleConfig {
  switch (dados.kind) {
    case "anti_link":
      return {
        allowDomains: dominios(dados.allowDomains),
        onlyWhatsAppInvites: dados.onlyWhatsAppInvites,
      };
    case "banned_words":
      return { words: linhas(dados.words) };
    case "anti_flood":
      return { maxMessages: dados.maxMessages, windowSeconds: dados.windowSeconds };
    case "anti_media":
      return { blockedTypes: [...dados.blockedTypes] };
    case "only_admins":
      // Janela vazia = grupo fechado o tempo todo; o motor trata a config sem horário assim.
      return dados.quietFrom && dados.quietTo
        ? { quietFrom: dados.quietFrom, quietTo: dados.quietTo }
        : {};
  }
}

/** Regras que o motor não consegue checar sozinho porque dependem do tipo. */
function validarConfig(dados: RegraValidada): string | null {
  if (dados.kind === "banned_words" && linhas(dados.words).length === 0) {
    return "Escreva pelo menos uma palavra proibida, uma por linha.";
  }
  if (dados.kind === "only_admins") {
    const preenchidos = [dados.quietFrom, dados.quietTo].filter(Boolean).length;
    if (preenchidos === 1) {
      return "Preencha os dois horários ou deixe os dois em branco (grupo fechado o tempo todo).";
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Criar / editar
 * ------------------------------------------------------------------ */

export async function salvarRegra(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();

  const tipo = z
    .enum(TIPOS_REGRA, { error: "Escolha um tipo de regra válido." })
    .safeParse(String(formData.get("kind") ?? ""));
  if (!tipo.success) return { error: tipo.error.issues[0].message };

  const parsed = regraSchema.safeParse({
    kind: tipo.data,
    id: String(formData.get("id") ?? ""),
    instanceId: String(formData.get("instanceId") ?? ""),
    groupId: String(formData.get("groupId") ?? ""),
    action: String(formData.get("action") ?? ""),
    removeAtStrikes: String(formData.get("removeAtStrikes") ?? "0"),
    exemptAdmins: formData.get("exemptAdmins") === "on",
    enabled: formData.get("enabled") === "on",
    warnTemplate: String(formData.get("warnTemplate") ?? ""),
    allowDomains: String(formData.get("allowDomains") ?? ""),
    onlyWhatsAppInvites: formData.get("onlyWhatsAppInvites") === "on",
    words: String(formData.get("words") ?? ""),
    maxMessages: String(formData.get("maxMessages") ?? "0"),
    windowSeconds: String(formData.get("windowSeconds") ?? "0"),
    blockedTypes: formData.getAll("blockedTypes").map(String),
    quietFrom: String(formData.get("quietFrom") ?? "").trim(),
    quietTo: String(formData.get("quietTo") ?? "").trim(),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const dados = parsed.data;

  const problema = validarConfig(dados);
  if (problema) return { error: problema };

  const [instancia] = await db
    .select({ id: instances.id })
    .from(instances)
    .where(eq(instances.id, dados.instanceId))
    .limit(1);
  if (!instancia) return { error: "Número não encontrado." };

  const groupId = dados.groupId || null;
  if (groupId) {
    const [grupo] = await db
      .select({ id: groups.id })
      .from(groups)
      .where(and(eq(groups.id, groupId), eq(groups.instanceId, dados.instanceId)))
      .limit(1);
    if (!grupo) return { error: "Esse grupo não pertence ao número selecionado." };
  }

  // O motor só aplica uma regra por tipo em cada escopo — a duplicada seria ignorada em silêncio.
  const existentes = await db
    .select({ id: moderationRules.id })
    .from(moderationRules)
    .where(
      and(
        eq(moderationRules.instanceId, dados.instanceId),
        eq(moderationRules.kind, dados.kind),
        groupId ? eq(moderationRules.groupId, groupId) : isNull(moderationRules.groupId),
      ),
    );
  if (existentes.some((r) => r.id !== dados.id)) {
    return {
      error: groupId
        ? "Já existe uma regra desse tipo nesse grupo. Edite a regra existente."
        : "Já existe uma regra global desse tipo para este número. Edite a regra existente.",
    };
  }

  const valores = {
    instanceId: dados.instanceId,
    groupId,
    kind: dados.kind,
    action: dados.action,
    removeAtStrikes: dados.removeAtStrikes,
    config: montarConfig(dados),
    warnTemplate: dados.warnTemplate ? dados.warnTemplate : null,
    exemptAdmins: dados.exemptAdmins,
    enabled: dados.enabled,
  };

  if (dados.id) {
    const [atualizada] = await db
      .update(moderationRules)
      .set(valores)
      .where(eq(moderationRules.id, dados.id))
      .returning({ id: moderationRules.id });
    if (!atualizada) return { error: "Regra não encontrada." };
    revalidatePath(ROUTE);
    return { ok: "Regra atualizada." };
  }

  await db.insert(moderationRules).values(valores);
  revalidatePath(ROUTE);
  return {
    ok: groupId
      ? "Regra criada para o grupo — ela sobrescreve a global do mesmo tipo."
      : "Regra global criada.",
  };
}

/* ------------------------------------------------------------------ *
 * Ativar / desativar e excluir
 * ------------------------------------------------------------------ */

export async function alternarRegra(ruleId: string, ativa: boolean): Promise<ActionState> {
  await requireUser();

  const parsed = idSchema.safeParse(ruleId);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const [row] = await db
    .update(moderationRules)
    .set({ enabled: ativa })
    .where(eq(moderationRules.id, parsed.data))
    .returning({ id: moderationRules.id });
  if (!row) return { error: "Regra não encontrada." };

  revalidatePath(ROUTE);
  return { ok: ativa ? "Regra ativada." : "Regra desativada." };
}

export async function excluirRegra(ruleId: string): Promise<ActionState> {
  await requireUser();

  const parsed = idSchema.safeParse(ruleId);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const [row] = await db
    .delete(moderationRules)
    .where(eq(moderationRules.id, parsed.data))
    .returning({ id: moderationRules.id });
  if (!row) return { error: "Regra não encontrada." };

  revalidatePath(ROUTE);
  return { ok: "Regra excluída." };
}

/* ------------------------------------------------------------------ *
 * Permissão de admin
 * ------------------------------------------------------------------ */

/**
 * Sem ser admin do grupo o motor só consegue avisar. Aqui a gente reconfere
 * na Evolution em vez de esperar o operador rodar a sincronização inteira.
 */
export async function verificarAdmin(groupId: string): Promise<ActionState> {
  await requireUser();

  const parsed = idSchema.safeParse(groupId);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const [row] = await db
    .select({ grupo: groups, instancia: instances })
    .from(groups)
    .innerJoin(instances, eq(groups.instanceId, instances.id))
    .where(eq(groups.id, parsed.data))
    .limit(1);
  if (!row) return { error: "Grupo não encontrado." };

  const telefoneBot = row.instancia.phone?.replace(/\D/g, "") || null;
  if (!telefoneBot) {
    return {
      error: "O telefone da instância ainda não foi identificado. Conecte o número antes de verificar.",
    };
  }

  try {
    const res = await evolution.group.participants(row.instancia.evolutionName, row.grupo.jid);
    const participantes = res?.participants ?? [];
    const eu = participantes.find((p) => p?.id && jidToPhone(p.id) === telefoneBot);
    if (!eu) {
      return {
        error:
          "Não deu pra achar o número na lista de participantes (a Evolution pode ter devolvido JIDs @lid). O valor salvo foi mantido.",
      };
    }

    const admin = eu.admin != null;
    await db.update(groups).set({ botIsAdmin: admin }).where(eq(groups.id, parsed.data));
    revalidatePath(ROUTE);
    revalidatePath("/grupos");

    return admin
      ? { ok: `O número é admin de "${row.grupo.name}" — apagar e remover já funcionam.` }
      : {
          error: `O número ainda não é admin de "${row.grupo.name}". Promova ele no WhatsApp para apagar mensagem e remover membro.`,
        };
  } catch (e) {
    return { error: mensagemEvolution(e, "Não foi possível verificar a permissão") };
  }
}
