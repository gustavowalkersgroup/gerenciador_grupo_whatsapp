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
export function dedupeKey(
  event: string,
  instance: string,
  data: unknown,
  /** `date_time` do envelope: o reenvio da Evolution carrega o mesmo valor. */
  occurredAt?: string,
): string {
  const d = data as {
    key?: { id?: string };
    id?: string;
    participants?: string[];
    action?: string;
    messages?: Array<{ key?: { id?: string } }>;
  };

  const messageId = d?.key?.id ?? d?.messages?.[0]?.key?.id ?? "";

  // Mensagem tem id próprio: ele já identifica o evento sem ambiguidade.
  if (messageId) return `${event}:${instance}:${messageId}`;

  /**
   * Eventos de participante não têm id. Usar só (grupo, ação, participantes)
   * parecia suficiente, mas cria um bug silencioso: quem sai do grupo e volta
   * gera exatamente a mesma chave, o evento é descartado como duplicata e a
   * pessoa nunca recebe boas-vindas na segunda entrada.
   *
   * O `date_time` do envelope resolve — reenvio repete, entrada nova não. Sem
   * ele, caímos numa janela de 10 segundos: cobre o reenvio (que vem em
   * segundos) e libera a reentrada (que vem em minutos). Na dúvida entre uma
   * boas-vindas repetida e uma que nunca chega, a repetida é o erro barato.
   */
  const janela = occurredAt ?? String(Math.floor(Date.now() / 10_000));
  const partes = [
    event,
    instance,
    d?.id ?? "",
    d?.action ?? "",
    (d?.participants ?? []).join(","),
    janela,
  ];

  if (!partes[2] && !partes[3] && !partes[4]) {
    const hash = createHash("sha256")
      .update(JSON.stringify(data ?? null))
      .digest("hex")
      .slice(0, 32);
    return `${event}:${instance}:${hash}:${janela}`;
  }
  return partes.join(":");
}
