"use server";

import { and, count, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { contactTags, contacts, groupTags, keywordTriggers, tags } from "@/lib/db/schema";

export interface ActionState {
  error?: string;
  ok?: string;
}

const ROTA = "/contatos";
const idSchema = z.uuid("Identificador inválido.");

/**
 * A tela de contatos é inteira server-side (não há componente cliente aqui),
 * então o retorno da ação volta pela querystring. A URL é sempre remontada a
 * partir de ROTA: o que veio do formulário entra só como query, nunca como
 * caminho — assim um `voltar` adulterado não vira redirecionamento pra fora.
 */
function destino(formData: FormData, estado: ActionState): string {
  const params = new URLSearchParams(String(formData.get("voltar") ?? ""));
  params.delete("erro");
  params.delete("ok");
  if (estado.error) params.set("erro", estado.error);
  else if (estado.ok) params.set("ok", estado.ok);
  const query = params.toString();
  return query ? `${ROTA}?${query}` : ROTA;
}

/* ------------------------------------------------------------------ *
 * Opt-out
 * ------------------------------------------------------------------ */

const optOutSchema = z.object({
  contactId: idSchema,
  marcar: z.boolean(),
});

async function mudarOptOut(formData: FormData): Promise<ActionState> {
  await requireUser();

  const parsed = optOutSchema.safeParse({
    contactId: String(formData.get("contactId") ?? ""),
    marcar: formData.get("marcar") === "1",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { contactId, marcar } = parsed.data;

  const [row] = await db
    .update(contacts)
    .set({ optOut: marcar, optOutAt: marcar ? new Date() : null })
    .where(eq(contacts.id, contactId))
    .returning({ id: contacts.id });
  if (!row) return { error: "Contato não encontrado." };

  return {
    ok: marcar
      ? "Opt-out registrado: esse contato não recebe mais nenhum DM automático."
      : "Opt-out removido. Só faça isso quando a própria pessoa pedir para voltar.",
  };
}

export async function alternarOptOut(formData: FormData): Promise<void> {
  const estado = await mudarOptOut(formData);
  if (!estado.error) revalidatePath(ROTA);
  redirect(destino(formData, estado));
}

/* ------------------------------------------------------------------ *
 * Etiqueta do contato
 * ------------------------------------------------------------------ */

const etiquetaContatoSchema = z.object({
  contactId: idSchema,
  tagId: idSchema,
});

async function carregarEtiqueta(tagId: string) {
  const [row] = await db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(eq(tags.id, tagId))
    .limit(1);
  return row ?? null;
}

async function vincularEtiqueta(formData: FormData): Promise<ActionState> {
  await requireUser();

  const parsed = etiquetaContatoSchema.safeParse({
    contactId: String(formData.get("contactId") ?? ""),
    tagId: String(formData.get("tagId") ?? ""),
  });
  if (!parsed.success) return { error: "Escolha uma etiqueta antes de aplicar." };

  const [contato] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.id, parsed.data.contactId))
    .limit(1);
  if (!contato) return { error: "Contato não encontrado." };

  const etiqueta = await carregarEtiqueta(parsed.data.tagId);
  if (!etiqueta) return { error: "Etiqueta não encontrada." };

  await db
    .insert(contactTags)
    .values({ contactId: contato.id, tagId: etiqueta.id, source: "painel" })
    .onConflictDoNothing();

  return { ok: `Etiqueta "${etiqueta.name}" aplicada ao contato.` };
}

export async function aplicarEtiqueta(formData: FormData): Promise<void> {
  const estado = await vincularEtiqueta(formData);
  if (!estado.error) revalidatePath(ROTA);
  redirect(destino(formData, estado));
}

async function desvincularEtiqueta(formData: FormData): Promise<ActionState> {
  await requireUser();

  const parsed = etiquetaContatoSchema.safeParse({
    contactId: String(formData.get("contactId") ?? ""),
    tagId: String(formData.get("tagId") ?? ""),
  });
  if (!parsed.success) return { error: "Etiqueta inválida." };

  const [row] = await db
    .delete(contactTags)
    .where(
      and(
        eq(contactTags.contactId, parsed.data.contactId),
        eq(contactTags.tagId, parsed.data.tagId),
      ),
    )
    .returning({ tagId: contactTags.tagId });
  if (!row) return { error: "Esse contato já não tinha essa etiqueta." };

  return { ok: "Etiqueta removida do contato." };
}

export async function removerEtiqueta(formData: FormData): Promise<void> {
  const estado = await desvincularEtiqueta(formData);
  if (!estado.error) revalidatePath(ROTA);
  redirect(destino(formData, estado));
}

/* ------------------------------------------------------------------ *
 * Etiquetas (usadas por gatilhos e disparos)
 * ------------------------------------------------------------------ */

const novaEtiquetaSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(1, "Dê um nome à etiqueta.")
    .max(60, "Nome de etiqueta muito longo (máx. 60 caracteres)."),
  cor: z.union([
    z.literal(""),
    z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida — use o formato #RRGGBB."),
  ]),
});

async function inserirEtiqueta(formData: FormData): Promise<ActionState> {
  await requireUser();

  const parsed = novaEtiquetaSchema.safeParse({
    nome: String(formData.get("nome") ?? ""),
    cor: String(formData.get("cor") ?? "").trim(),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { nome, cor } = parsed.data;

  const [criada] = await db
    .insert(tags)
    .values(cor ? { name: nome, color: cor } : { name: nome })
    .onConflictDoNothing()
    .returning({ id: tags.id });
  // O índice único é sobre lower(name): sem linha de volta, o nome já existe.
  if (!criada) return { error: `Já existe uma etiqueta chamada "${nome}".` };

  return { ok: `Etiqueta "${nome}" criada.` };
}

export async function criarEtiqueta(formData: FormData): Promise<void> {
  const estado = await inserirEtiqueta(formData);
  if (!estado.error) {
    revalidatePath(ROTA);
    revalidatePath("/palavras-chave");
  }
  redirect(destino(formData, estado));
}

const excluirEtiquetaSchema = z.object({
  tagId: idSchema,
  confirmar: z.literal(true, {
    error: 'Marque "confirmar" antes de excluir — a etiqueta some de todos os contatos.',
  }),
});

async function apagarEtiqueta(formData: FormData): Promise<ActionState> {
  await requireUser();

  const parsed = excluirEtiquetaSchema.safeParse({
    tagId: String(formData.get("tagId") ?? ""),
    confirmar: formData.get("confirmar") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const etiqueta = await carregarEtiqueta(parsed.data.tagId);
  if (!etiqueta) return { error: "Etiqueta não encontrada." };

  // A FK zera o applyTagId do gatilho em silêncio; aí ele passaria a capturar
  // lead sem etiquetar ninguém. Melhor barrar e mandar ajustar o gatilho antes.
  const [emUso] = await db
    .select({ n: count() })
    .from(keywordTriggers)
    .where(eq(keywordTriggers.applyTagId, etiqueta.id));
  if ((emUso?.n ?? 0) > 0) {
    return {
      error: `"${etiqueta.name}" está em uso por ${emUso.n} gatilho(s) de palavra-chave. Troque a etiqueta do gatilho antes de excluir.`,
    };
  }

  const [contatosMarcados] = await db
    .select({ n: count() })
    .from(contactTags)
    .where(eq(contactTags.tagId, etiqueta.id));
  const [gruposMarcados] = await db
    .select({ n: count() })
    .from(groupTags)
    .where(eq(groupTags.tagId, etiqueta.id));

  await db.delete(tags).where(eq(tags.id, etiqueta.id));

  return {
    ok: `Etiqueta "${etiqueta.name}" excluída — saiu de ${contatosMarcados?.n ?? 0} contato(s) e ${gruposMarcados?.n ?? 0} grupo(s).`,
  };
}

export async function excluirEtiqueta(formData: FormData): Promise<void> {
  const estado = await apagarEtiqueta(formData);
  if (!estado.error) {
    revalidatePath(ROTA);
    revalidatePath("/palavras-chave");
    revalidatePath("/grupos");
  }
  redirect(destino(formData, estado));
}
