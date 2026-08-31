import type { IncomingMessage } from "./types";

type Body = NonNullable<IncomingMessage["message"]>;

/** Desembrulha mensagem efêmera / ver-uma-vez até achar o conteúdo real. */
function unwrap(msg: Body | undefined, depth = 0): Body | undefined {
  if (!msg || depth > 3) return msg;
  if (msg.ephemeralMessage?.message) return unwrap(msg.ephemeralMessage.message, depth + 1);
  if (msg.viewOnceMessageV2?.message) return unwrap(msg.viewOnceMessageV2.message, depth + 1);
  return msg;
}

/** Texto visível da mensagem, venha ele de onde vier. */
export function extractText(message: IncomingMessage): string {
  const m = unwrap(message.message);
  if (!m) return "";
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.documentMessage?.caption ??
    m.buttonsResponseMessage?.selectedDisplayText ??
    m.listResponseMessage?.title ??
    m.templateButtonReplyMessage?.selectedDisplayText ??
    ""
  ).trim();
}

const MEDIA_KEYS = [
  "imageMessage",
  "videoMessage",
  "audioMessage",
  "documentMessage",
  "stickerMessage",
] as const;

export function messageType(message: IncomingMessage): string {
  const m = unwrap(message.message);
  if (!m) return message.messageType ?? "unknown";
  for (const k of MEDIA_KEYS) {
    if (k in m && m[k as keyof Body]) return k;
  }
  if (m.conversation) return "conversation";
  if (m.extendedTextMessage) return "extendedTextMessage";
  return message.messageType ?? "unknown";
}

export function hasMedia(message: IncomingMessage): boolean {
  const t = messageType(message);
  return (MEDIA_KEYS as readonly string[]).includes(t);
}

/** Timestamp em ms. A Evolution manda em segundos, às vezes como string. */
export function messageTimestampMs(message: IncomingMessage): number | null {
  const raw = message.messageTimestamp;
  if (raw === undefined || raw === null) return null;
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e12 ? n * 1000 : n;
}
