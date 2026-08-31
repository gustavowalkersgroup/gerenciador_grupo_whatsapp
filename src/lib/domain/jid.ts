/** Helpers de JID do WhatsApp. Errar aqui manda DM pro número errado. */

export const isGroupJid = (jid: string) => jid.endsWith("@g.us");
export const isUserJid = (jid: string) =>
  jid.endsWith("@s.whatsapp.net") || jid.endsWith("@c.us") || jid.endsWith("@lid");
export const isBroadcastJid = (jid: string) =>
  jid === "status@broadcast" || jid.endsWith("@broadcast");

/** Remove sufixo de device (`:12`) e normaliza o domínio. */
export function normalizeJid(jid: string): string {
  if (!jid) return jid;
  const [rawUser, rawDomain] = jid.split("@");
  if (!rawDomain) return jid;
  const user = rawUser.split(":")[0];
  const domain = rawDomain === "c.us" ? "s.whatsapp.net" : rawDomain;
  return `${user}@${domain}`;
}

/** Só os dígitos do número, sem domínio. */
export function jidToPhone(jid: string): string | null {
  const user = normalizeJid(jid).split("@")[0];
  const digits = user.replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

export function phoneToJid(phone: string): string {
  return `${phone.replace(/\D/g, "")}@s.whatsapp.net`;
}

/**
 * Quem realmente mandou a mensagem. Em grupo o `remoteJid` é o grupo,
 * e o autor vem em `participant`.
 */
export function senderJid(key: {
  remoteJid: string;
  participant?: string;
  fromMe?: boolean;
}): string | null {
  if (isGroupJid(key.remoteJid)) {
    return key.participant ? normalizeJid(key.participant) : null;
  }
  return normalizeJid(key.remoteJid);
}

/** Formata pra exibir no painel: 5511999998888 -> +55 11 99999-8888 */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "—";
  const d = phone.replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("55")) {
    return `+55 ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`;
  }
  if (d.length === 12 && d.startsWith("55")) {
    return `+55 ${d.slice(2, 4)} ${d.slice(4, 8)}-${d.slice(8)}`;
  }
  return `+${d}`;
}
