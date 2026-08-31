import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Comparação em tempo constante. Comparar com `===` vaza, pelo tempo de
 * resposta, quantos caracteres do segredo o atacante já acertou.
 */
export function secretMatches(received: string | null, expected: string): boolean {
  if (!received) return false;
  const a = createHash("sha256").update(received).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Chave de deduplicação. A Evolution reenvia o evento quando não recebe 2xx
 * a tempo; sem isso o mesmo "quero sapato 44" vira três DMs pro mesmo contato.
 */
export function dedupeKey(event: string, instance: string, data: unknown): string {
  const d = data as {
    key?: { id?: string };
    id?: string;
    participants?: string[];
    action?: string;
    messages?: Array<{ key?: { id?: string } }>;
  };

  const messageId = d?.key?.id ?? d?.messages?.[0]?.key?.id ?? "";
  const parts = [event, instance, messageId, d?.action ?? "", (d?.participants ?? []).join(",")];

  // Evento sem identificador próprio (connection.update) cai no hash do corpo.
  if (!parts[2] && !parts[3] && !parts[4]) {
    const hash = createHash("sha256")
      .update(JSON.stringify(data ?? null))
      .digest("hex")
      .slice(0, 32);
    return `${event}:${instance}:${hash}`;
  }
  return parts.join(":");
}
