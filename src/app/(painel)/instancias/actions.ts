"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { instances } from "@/lib/db/schema";
import { EvolutionError, evolution } from "@/lib/evolution/client";
import { env } from "@/lib/env";

export interface FormState {
  error?: string;
  ok?: string;
}

const ROUTE = "/instancias";

/* ------------------------------------------------------------------ *
 * Validação
 * ------------------------------------------------------------------ */

const novoNumero = z.object({
  label: z
    .string()
    .trim()
    .min(2, "O rótulo precisa de pelo menos 2 caracteres.")
    .max(60, "O rótulo pode ter no máximo 60 caracteres."),
  evolutionName: z
    .string()
    .trim()
    .regex(
      /^[a-z0-9-]{3,32}$/,
      "O nome da instância aceita só letras minúsculas, números e hífen (3 a 32 caracteres).",
    ),
});

const idSchema = z.string().uuid("Número inválido.");

const limites = z
  .object({
    id: idSchema,
    dailyDmLimit: z
      .coerce.number({ error: "Informe um número válido no limite diário." })
      .int("O limite diário precisa ser um número inteiro.")
      .min(1, "O limite diário precisa ser pelo menos 1.")
      .max(1000, "Acima de 1000 DMs por dia o número é banido rápido."),
    minSendDelayMs: z
      .coerce.number({ error: "Informe um número válido no intervalo mínimo." })
      .int("O intervalo mínimo precisa ser um número inteiro.")
      .min(1000, "Menos de 1 segundo entre envios parece robô — o WhatsApp bane.")
      .max(600_000, "O intervalo mínimo não pode passar de 600000 ms."),
    maxSendDelayMs: z
      .coerce.number({ error: "Informe um número válido no intervalo máximo." })
      .int("O intervalo máximo precisa ser um número inteiro.")
      .min(1000, "O intervalo máximo precisa ser de pelo menos 1000 ms.")
      .max(600_000, "O intervalo máximo não pode passar de 600000 ms."),
  })
  .refine((v) => v.maxSendDelayMs >= v.minSendDelayMs, {
    message: "O intervalo máximo precisa ser maior ou igual ao mínimo.",
    path: ["maxSendDelayMs"],
  });

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const APP_URL_FALTANDO =
  "Configure a variável de ambiente APP_URL com a URL pública do painel " +
  "(ex.: https://painel.suaempresa.com.br). Sem ela a Evolution API não sabe " +
  "para onde mandar os eventos dos grupos.";

interface WebhookConfig {
  url: string;
  secret: string;
}

/** `env()` também estoura quando falta outra variável — o erro é o mesmo pro operador: configurar o ambiente. */
function webhookConfig(): WebhookConfig | null {
  try {
    const base = env().APP_URL?.replace(/\/+$/, "");
    if (!base) return null;
    return { url: `${base}/api/webhooks/evolution`, secret: env().WEBHOOK_SECRET };
  } catch {
    return null;
  }
}

/** Traduz a falha da Evolution pra algo que o operador consiga agir. */
function evolutionMessage(e: unknown): string {
  if (e instanceof EvolutionError) {
    if (e.status === 0) return "a API não respondeu (fora do ar, URL errada ou timeout)";
    if (e.status === 401 || e.status === 403) return "a chave de API foi recusada";
    if (e.status === 404) return "a instância não existe mais na Evolution";
    if (e.status === 409) return "já existe uma instância com esse nome na Evolution";
    return `a API respondeu ${e.status}`;
  }
  return e instanceof Error ? e.message : "erro desconhecido";
}

async function findInstance(id: string) {
  const [row] = await db.select().from(instances).where(eq(instances.id, id)).limit(1);
  return row ?? null;
}

/* ------------------------------------------------------------------ *
 * Cadastro
 * ------------------------------------------------------------------ */

export async function createInstance(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireUser();

  const parsed = novoNumero.safeParse({
    label: formData.get("label"),
    evolutionName: formData.get("evolutionName"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const webhook = webhookConfig();
  if (!webhook) return { error: APP_URL_FALTANDO };

  const { label, evolutionName } = parsed.data;

  const [duplicate] = await db
    .select({ id: instances.id })
    .from(instances)
    .where(eq(instances.evolutionName, evolutionName))
    .limit(1);
  if (duplicate) return { error: `Já existe um número usando a instância "${evolutionName}".` };

  try {
    await evolution.instance.create(evolutionName, webhook.url, webhook.secret);
  } catch (e) {
    return { error: `Não foi possível criar a instância na Evolution: ${evolutionMessage(e)}.` };
  }

  // Só grava depois que a Evolution aceitou: linha órfã no banco receberia
  // webhook de uma instância que não existe e quebraria a moderação.
  try {
    await db.insert(instances).values({ label, evolutionName });
  } catch {
    return {
      error:
        `A instância "${evolutionName}" foi criada na Evolution, mas não deu para gravar no banco. ` +
        "Tente cadastrar de novo com o mesmo nome ou remova a instância na Evolution.",
    };
  }

  revalidatePath(ROUTE);
  return { ok: `Número "${label}" cadastrado. Clique em Conectar para ler o QR Code.` };
}

/* ------------------------------------------------------------------ *
 * Ações por número
 * ------------------------------------------------------------------ */

export async function resendWebhook(id: string): Promise<FormState> {
  await requireUser();

  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return { error: parsedId.error.issues[0].message };

  const webhook = webhookConfig();
  if (!webhook) return { error: APP_URL_FALTANDO };

  const row = await findInstance(parsedId.data);
  if (!row) return { error: "Número não encontrado." };

  try {
    await evolution.instance.setWebhook(row.evolutionName, webhook.url, webhook.secret);
  } catch (e) {
    return { error: `Não foi possível reenviar o webhook: ${evolutionMessage(e)}.` };
  }

  revalidatePath(ROUTE);
  return { ok: `Webhook reapontado para ${webhook.url}.` };
}

export async function disconnectInstance(id: string): Promise<FormState> {
  await requireUser();

  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return { error: parsedId.error.issues[0].message };

  const row = await findInstance(parsedId.data);
  if (!row) return { error: "Número não encontrado." };

  try {
    await evolution.instance.logout(row.evolutionName);
  } catch (e) {
    return { error: `Não foi possível desconectar: ${evolutionMessage(e)}.` };
  }

  await db
    .update(instances)
    .set({ status: "disconnected", lastSeenAt: new Date() })
    .where(eq(instances.id, row.id));

  revalidatePath(ROUTE);
  return { ok: `"${row.label}" desconectado. O celular precisa ler o QR de novo.` };
}

export async function removeInstance(id: string): Promise<FormState> {
  await requireUser();

  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return { error: parsedId.error.issues[0].message };

  const row = await findInstance(parsedId.data);
  if (!row) return { error: "Número não encontrado." };

  try {
    await evolution.instance.remove(row.evolutionName);
  } catch (e) {
    // 404 = já sumiu da Evolution; insistir só deixaria lixo no painel.
    const gone = e instanceof EvolutionError && e.status === 404;
    if (!gone) {
      return { error: `Não foi possível remover na Evolution: ${evolutionMessage(e)}.` };
    }
  }

  await db.delete(instances).where(eq(instances.id, row.id));

  revalidatePath(ROUTE);
  return { ok: `Número "${row.label}" removido.` };
}

/* ------------------------------------------------------------------ *
 * Limites de segurança
 * ------------------------------------------------------------------ */

export async function updateLimits(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireUser();

  const parsed = limites.safeParse({
    id: formData.get("id"),
    dailyDmLimit: formData.get("dailyDmLimit"),
    minSendDelayMs: formData.get("minSendDelayMs"),
    maxSendDelayMs: formData.get("maxSendDelayMs"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { id, ...values } = parsed.data;

  const [updated] = await db
    .update(instances)
    .set(values)
    .where(eq(instances.id, id))
    .returning({ id: instances.id });
  if (!updated) return { error: "Número não encontrado." };

  revalidatePath(ROUTE);
  return { ok: "Limites salvos." };
}
