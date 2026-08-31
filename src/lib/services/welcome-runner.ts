import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { welcomeConfigs } from "@/lib/db/schema";
import { formatPhone, jidToPhone } from "@/lib/domain/jid";
import { renderTemplate } from "@/lib/domain/text";
import { evolution } from "@/lib/evolution/client";
import type { ContactRow, GroupRow, InstanceRow } from "./entities";

export async function loadWelcome(groupId: string) {
  const [row] = await db
    .select()
    .from(welcomeConfigs)
    .where(eq(welcomeConfigs.groupId, groupId))
    .limit(1);
  return row ?? null;
}

export async function sendWelcome(input: {
  instance: InstanceRow;
  group: GroupRow;
  contact: ContactRow;
}): Promise<boolean> {
  const cfg = await loadWelcome(input.group.id);
  if (!cfg?.enabled || !cfg.template.trim()) return false;

  const vars = {
    nome: input.contact.pushName ?? "seja bem-vindo(a)",
    grupo: input.group.name,
    numero: formatPhone(input.contact.phone ?? jidToPhone(input.contact.jid)),
  };

  // No privado não faz sentido mencionar, e quem optou por sair não recebe DM.
  const asDm = cfg.sendAsDm && !input.contact.optOut;
  const to = asDm ? input.contact.jid : input.group.jid;
  if (cfg.sendAsDm && input.contact.optOut) return false;

  const text = renderTemplate(cfg.template, vars);
  const mentions = !asDm && cfg.mentionMember ? [input.contact.jid] : undefined;
  const delayMs = Math.min(cfg.delaySeconds, 15) * 1000;

  try {
    if (cfg.mediaUrl) {
      await evolution.message.sendMedia(input.instance.evolutionName, {
        to,
        mediatype: (cfg.mediaType as "image" | "video" | "document") ?? "image",
        media: cfg.mediaUrl,
        caption: text,
        mentions,
        delayMs,
      });
    } else {
      await evolution.message.sendText(input.instance.evolutionName, {
        to,
        text,
        mentions,
        delayMs,
      });
    }
    return true;
  } catch (e) {
    console.error("[boas-vindas] falhou:", (e as Error).message);
    return false;
  }
}

export async function sendFarewell(input: {
  instance: InstanceRow;
  group: GroupRow;
  contact: ContactRow;
}): Promise<boolean> {
  const cfg = await loadWelcome(input.group.id);
  if (!cfg?.enabled || !cfg.farewellTemplate?.trim()) return false;

  const text = renderTemplate(cfg.farewellTemplate, {
    nome: input.contact.pushName ?? "alguém",
    grupo: input.group.name,
    numero: formatPhone(input.contact.phone ?? jidToPhone(input.contact.jid)),
  });

  try {
    await evolution.message.sendText(input.instance.evolutionName, {
      to: input.group.jid,
      text,
      delayMs: 1000,
    });
    return true;
  } catch (e) {
    console.error("[despedida] falhou:", (e as Error).message);
    return false;
  }
}
