"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { contacts, groupMembers, groups, instances, welcomeConfigs } from "@/lib/db/schema";
import { jidToPhone } from "@/lib/domain/jid";
import { EvolutionError, evolution } from "@/lib/evolution/client";
import type { EvolutionGroup, EvolutionParticipant } from "@/lib/evolution/types";
import { markMemberLeft, upsertGroup } from "@/lib/services/entities";

export interface ActionState {
  error?: string;
  ok?: string;
}

const idSchema = z.uuid("Identificador inválido.");

/** Traduz a falha da Evolution pra algo que o operador entenda sem abrir log. */
function mensagemEvolution(e: unknown, contexto: string): string {
  if (e instanceof EvolutionError) {
    if (e.status === 0) return `${contexto}: a Evolution API não respondeu (número fora do ar?).`;
    if (e.status === 401 || e.status === 403)
      return `${contexto}: sem permissão. Confirme se o número é admin do grupo.`;
    if (e.status === 404) return `${contexto}: grupo ou número não encontrado na Evolution API.`;
    if (e.status === 429) return `${contexto}: a Evolution API pediu pra desacelerar. Tente em instantes.`;
    return `${contexto}: a Evolution API respondeu ${e.status}.`;
  }
  return `${contexto}: ${(e as Error).message}`;
}

async function carregarGrupo(groupId: string) {
  const [row] = await db
    .select({ grupo: groups, instancia: instances })
    .from(groups)
    .innerJoin(instances, eq(groups.instanceId, instances.id))
    .where(eq(groups.id, groupId))
    .limit(1);
  return row ?? null;
}

function revalidar(groupId: string) {
  revalidatePath("/grupos");
  revalidatePath(`/grupos/${groupId}`);
}

/* ------------------------------------------------------------------ *
 * Sincronização
 * ------------------------------------------------------------------ */

/**
 * Em alguns servidores a Evolution devolve o participante como `@lid`, e aí o
 * JID não carrega o telefone real. Quando não dá pra casar com o número da
 * instância devolvemos `undefined` — melhor manter o valor salvo do que
 * marcar "sem admin" e o operador achar que perdeu a permissão.
 */
function detectarBotAdmin(
  participantes: EvolutionParticipant[] | undefined,
  telefoneBot: string | null,
): boolean | undefined {
  if (!telefoneBot || !participantes?.length) return undefined;
  const eu = participantes.find((p) => p?.id && jidToPhone(p.id) === telefoneBot);
  if (!eu) return undefined;
  return eu.admin != null;
}

export async function sincronizarGrupos(instanceId: string): Promise<ActionState> {
  await requireUser();

  const parsed = idSchema.safeParse(instanceId);
  if (!parsed.success) return { error: "Selecione um número válido." };

  const [instancia] = await db
    .select()
    .from(instances)
    .where(eq(instances.id, parsed.data))
    .limit(1);
  if (!instancia) return { error: "Número não encontrado." };

  let remotos: EvolutionGroup[];
  try {
    remotos = await evolution.group.fetchAll(instancia.evolutionName, true);
  } catch (e) {
    return { error: mensagemEvolution(e, "Não foi possível sincronizar") };
  }

  const lista = Array.isArray(remotos) ? remotos : [];
  const telefoneBot = instancia.phone?.replace(/\D/g, "") || null;
  let indeterminados = 0;
  let total = 0;

  for (const g of lista) {
    if (!g?.id) continue;

    const patch: Partial<typeof groups.$inferInsert> = {
      name: g.subject ?? "",
      participantsCount: g.size ?? g.participants?.length ?? 0,
      lastSyncedAt: new Date(),
    };
    if (g.desc) patch.description = g.desc;
    const dono = g.owner ?? g.subjectOwner;
    if (dono) patch.ownerJid = dono;

    const admin = detectarBotAdmin(g.participants, telefoneBot);
    if (admin === undefined) indeterminados++;
    else patch.botIsAdmin = admin;

    await upsertGroup(instancia.id, g.id, patch);
    total++;
  }

  revalidatePath("/grupos");

  if (total === 0) return { ok: "Nenhum grupo encontrado nesse número." };
  const aviso =
    indeterminados > 0
      ? ` Em ${indeterminados} não deu pra confirmar se o número é admin — o valor anterior foi mantido.`
      : "";
  return { ok: `${total} grupo(s) sincronizado(s).${aviso}` };
}

/* ------------------------------------------------------------------ *
 * Grupo
 * ------------------------------------------------------------------ */

export async function alternarGerenciado(
  groupId: string,
  gerenciado: boolean,
): Promise<ActionState> {
  await requireUser();

  const parsed = idSchema.safeParse(groupId);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const [row] = await db
    .update(groups)
    .set({ managed: gerenciado })
    .where(eq(groups.id, parsed.data))
    .returning({ id: groups.id });
  if (!row) return { error: "Grupo não encontrado." };

  revalidar(parsed.data);
  return { ok: gerenciado ? "Grupo passou a ser gerenciado." : "Grupo saiu da gestão." };
}

/** A Evolution ora devolve `inviteCode`, ora só a URL pronta. */
function extrairCodigo(res: { inviteUrl?: string; inviteCode?: string }): string | null {
  if (res.inviteCode) return res.inviteCode;
  if (res.inviteUrl) return res.inviteUrl.split("/").filter(Boolean).pop() ?? null;
  return null;
}

export async function buscarConvite(groupId: string): Promise<ActionState> {
  await requireUser();

  const parsed = idSchema.safeParse(groupId);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const row = await carregarGrupo(parsed.data);
  if (!row) return { error: "Grupo não encontrado." };

  try {
    const res = await evolution.group.inviteCode(row.instancia.evolutionName, row.grupo.jid);
    const codigo = extrairCodigo(res);
    if (!codigo) return { error: "A Evolution API não devolveu o código do convite." };
    await db.update(groups).set({ inviteCode: codigo }).where(eq(groups.id, parsed.data));
    revalidar(parsed.data);
    return { ok: "Link de convite atualizado." };
  } catch (e) {
    return { error: mensagemEvolution(e, "Não foi possível buscar o convite") };
  }
}

export async function revogarConvite(groupId: string): Promise<ActionState> {
  await requireUser();

  const parsed = idSchema.safeParse(groupId);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const row = await carregarGrupo(parsed.data);
  if (!row) return { error: "Grupo não encontrado." };

  try {
    const res = await evolution.group.revokeInviteCode(row.instancia.evolutionName, row.grupo.jid);
    await db
      .update(groups)
      .set({ inviteCode: extrairCodigo(res) })
      .where(eq(groups.id, parsed.data));
    revalidar(parsed.data);
    return { ok: "Link antigo revogado. Quem tinha o link não entra mais." };
  } catch (e) {
    return { error: mensagemEvolution(e, "Não foi possível revogar o convite") };
  }
}

export async function alterarConfiguracao(
  groupId: string,
  acao: "announcement" | "not_announcement",
): Promise<ActionState> {
  await requireUser();

  const parsed = idSchema.safeParse(groupId);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const row = await carregarGrupo(parsed.data);
  if (!row) return { error: "Grupo não encontrado." };

  try {
    await evolution.group.updateSetting(row.instancia.evolutionName, row.grupo.jid, acao);
    revalidar(parsed.data);
    return {
      ok: acao === "announcement" ? "Grupo fechado: só admin fala." : "Grupo aberto para todos.",
    };
  } catch (e) {
    return { error: mensagemEvolution(e, "Não foi possível alterar o grupo") };
  }
}

/* ------------------------------------------------------------------ *
 * Boas-vindas
 * ------------------------------------------------------------------ */

const boasVindasSchema = z.object({
  groupId: idSchema,
  enabled: z.boolean(),
  template: z.string().trim().min(1, "Escreva a mensagem de boas-vindas.").max(4000),
  sendAsDm: z.boolean(),
  mentionMember: z.boolean(),
  delaySeconds: z
    .number("Informe o atraso em segundos.")
    .int("O atraso precisa ser um número inteiro.")
    .min(0, "O atraso não pode ser negativo.")
    .max(60, "O atraso máximo é de 60 segundos."),
  farewellTemplate: z.string().trim().max(4000).optional(),
  mediaUrl: z.union([z.literal(""), z.url("URL de mídia inválida.")]),
});

export async function salvarBoasVindas(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();

  const parsed = boasVindasSchema.safeParse({
    groupId: String(formData.get("groupId") ?? ""),
    enabled: formData.get("enabled") === "on",
    template: String(formData.get("template") ?? ""),
    sendAsDm: formData.get("sendAsDm") === "on",
    mentionMember: formData.get("mentionMember") === "on",
    delaySeconds: Number(formData.get("delaySeconds") ?? 3),
    farewellTemplate: String(formData.get("farewellTemplate") ?? ""),
    mediaUrl: String(formData.get("mediaUrl") ?? "").trim(),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { groupId, farewellTemplate, mediaUrl, ...dados } = parsed.data;

  const row = await carregarGrupo(groupId);
  if (!row) return { error: "Grupo não encontrado." };

  const valores = {
    ...dados,
    farewellTemplate: farewellTemplate ? farewellTemplate : null,
    mediaUrl: mediaUrl ? mediaUrl : null,
  };

  await db
    .insert(welcomeConfigs)
    .values({ groupId, ...valores })
    .onConflictDoUpdate({ target: welcomeConfigs.groupId, set: valores });

  revalidatePath(`/grupos/${groupId}`);
  return { ok: "Boas-vindas salvas." };
}

/* ------------------------------------------------------------------ *
 * Membros
 * ------------------------------------------------------------------ */

const acaoMembroSchema = z.object({
  groupId: idSchema,
  memberId: idSchema,
  acao: z.enum(["promote", "demote", "remove"], { error: "Ação inválida." }),
});

const RESULTADO: Record<"promote" | "demote" | "remove", string> = {
  promote: "Membro promovido a admin.",
  demote: "Membro rebaixado.",
  remove: "Membro removido do grupo.",
};

export async function acaoMembro(
  groupId: string,
  memberId: string,
  acao: "promote" | "demote" | "remove",
): Promise<ActionState> {
  await requireUser();

  const parsed = acaoMembroSchema.safeParse({ groupId, memberId, acao });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const row = await carregarGrupo(parsed.data.groupId);
  if (!row) return { error: "Grupo não encontrado." };
  if (!row.grupo.botIsAdmin) {
    return {
      error: "O número não é admin desse grupo — sincronize os grupos ou promova o número no WhatsApp.",
    };
  }

  const [membro] = await db
    .select({ id: groupMembers.id, contactId: contacts.id, jid: contacts.jid })
    .from(groupMembers)
    .innerJoin(contacts, eq(groupMembers.contactId, contacts.id))
    .where(
      and(eq(groupMembers.id, parsed.data.memberId), eq(groupMembers.groupId, parsed.data.groupId)),
    )
    .limit(1);
  if (!membro) return { error: "Membro não encontrado nesse grupo." };

  try {
    await evolution.group.updateParticipants(
      row.instancia.evolutionName,
      row.grupo.jid,
      parsed.data.acao,
      [membro.jid],
    );
  } catch (e) {
    return { error: mensagemEvolution(e, "Não foi possível aplicar a ação") };
  }

  if (parsed.data.acao === "remove") {
    await markMemberLeft(parsed.data.groupId, membro.contactId);
  } else {
    await db
      .update(groupMembers)
      .set({ isAdmin: parsed.data.acao === "promote" })
      .where(eq(groupMembers.id, membro.id));
  }

  revalidar(parsed.data.groupId);
  return { ok: RESULTADO[parsed.data.acao] };
}
