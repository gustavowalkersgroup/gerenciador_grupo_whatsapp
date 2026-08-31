import { containsTerm, domainOf, normalize, scanLinks } from "./text";

export type ModerationKind =
  | "anti_link"
  | "anti_flood"
  | "banned_words"
  | "anti_media"
  | "only_admins";

export type ModerationAction = "warn" | "delete" | "delete_and_warn" | "remove";

export interface RuleConfig {
  /** anti_link: domínios liberados, ex: ["instagram.com", "minhaloja.com.br"] */
  allowDomains?: string[];
  /** anti_link: bloquear só convite de outro grupo, deixando o resto passar */
  onlyWhatsAppInvites?: boolean;
  /** banned_words */
  words?: string[];
  /** anti_flood */
  maxMessages?: number;
  windowSeconds?: number;
  /** anti_media */
  blockedTypes?: string[];
  /** only_admins: janela em que só admin fala, no fuso do grupo */
  quietFrom?: string;
  quietTo?: string;
}

export interface Rule {
  id: string;
  kind: ModerationKind;
  action: ModerationAction;
  removeAtStrikes: number;
  config: RuleConfig;
  warnTemplate: string | null;
  exemptAdmins: boolean;
  enabled: boolean;
}

export interface MessageContext {
  rawText: string;
  messageType: string;
  hasMedia: boolean;
  senderIsAdmin: boolean;
  senderIsBot: boolean;
  /** Quantas mensagens esse membro mandou na janela do anti_flood. */
  recentCount: number;
  /** Hora local do grupo em minutos desde meia-noite, pro only_admins. */
  minutesOfDay: number;
}

export interface Violation {
  ruleId: string;
  kind: ModerationKind;
  action: ModerationAction;
  reason: string;
  matched?: string;
  removeAtStrikes: number;
  warnTemplate: string | null;
}

const DEFAULT_WARN: Record<ModerationKind, string> = {
  anti_link: "⚠️ {{nome}}, links não são permitidos neste grupo. Aviso {{strikes}}/{{limite}}.",
  anti_flood: "⚠️ {{nome}}, calma no envio de mensagens. Aviso {{strikes}}/{{limite}}.",
  banned_words: "⚠️ {{nome}}, essa palavra não é permitida aqui. Aviso {{strikes}}/{{limite}}.",
  anti_media: "⚠️ {{nome}}, esse tipo de mídia não é permitido. Aviso {{strikes}}/{{limite}}.",
  only_admins: "🔒 {{nome}}, no momento apenas administradores podem enviar mensagens.",
};

export function defaultWarnTemplate(kind: ModerationKind): string {
  return DEFAULT_WARN[kind];
}

/**
 * Avalia todas as regras e devolve as violações. Regra mais severa primeiro,
 * porque quem chama aplica só a primeira (não faz sentido apagar e remover
 * a mesma mensagem duas vezes).
 */
export function evaluate(rules: Rule[], ctx: MessageContext): Violation[] {
  if (ctx.senderIsBot) return [];

  const found: Violation[] = [];
  const normalized = normalize(ctx.rawText);

  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.exemptAdmins && ctx.senderIsAdmin) continue;

    const hit = checkRule(rule, ctx, normalized);
    if (hit) {
      found.push({
        ruleId: rule.id,
        kind: rule.kind,
        action: rule.action,
        reason: hit.reason,
        matched: hit.matched,
        removeAtStrikes: rule.removeAtStrikes,
        warnTemplate: rule.warnTemplate ?? DEFAULT_WARN[rule.kind],
      });
    }
  }

  return found.sort((a, b) => severity(b.action) - severity(a.action));
}

const severity = (a: ModerationAction) =>
  ({ warn: 1, delete: 2, delete_and_warn: 3, remove: 4 })[a];

function checkRule(
  rule: Rule,
  ctx: MessageContext,
  normalized: string,
): { reason: string; matched?: string } | null {
  const cfg = rule.config ?? {};

  switch (rule.kind) {
    case "anti_link": {
      const scan = scanLinks(ctx.rawText);
      if (!scan.hasLink && !scan.hasWhatsAppInvite) return null;

      if (cfg.onlyWhatsAppInvites) {
        return scan.hasWhatsAppInvite
          ? { reason: "convite de outro grupo", matched: "chat.whatsapp.com" }
          : null;
      }

      const allow = (cfg.allowDomains ?? []).map((d) => d.toLowerCase().replace(/^www\./, ""));
      const offending = scan.links.find((link) => {
        const host = domainOf(link);
        if (!host) return true;
        return !allow.some((a) => host === a || host.endsWith(`.${a}`));
      });

      if (!offending && !scan.hasWhatsAppInvite) return null;
      return { reason: "link não permitido", matched: offending ?? "chat.whatsapp.com" };
    }

    case "banned_words": {
      const words = cfg.words ?? [];
      const matched = words.find((w) => containsTerm(normalized, w));
      return matched ? { reason: "palavra proibida", matched } : null;
    }

    case "anti_flood": {
      const max = cfg.maxMessages ?? 5;
      if (ctx.recentCount <= max) return null;
      return {
        reason: `flood: ${ctx.recentCount} mensagens em ${cfg.windowSeconds ?? 10}s`,
        matched: String(ctx.recentCount),
      };
    }

    case "anti_media": {
      if (!ctx.hasMedia) return null;
      const blocked = cfg.blockedTypes ?? [];
      if (blocked.length === 0) return { reason: "mídia não permitida", matched: ctx.messageType };
      return blocked.includes(ctx.messageType)
        ? { reason: "tipo de mídia bloqueado", matched: ctx.messageType }
        : null;
    }

    case "only_admins": {
      if (ctx.senderIsAdmin) return null;
      const from = parseHhmm(cfg.quietFrom);
      const to = parseHhmm(cfg.quietTo);
      // Sem janela definida = grupo fechado o tempo todo.
      if (from === null || to === null) {
        return { reason: "somente administradores", matched: undefined };
      }
      const inWindow =
        from <= to
          ? ctx.minutesOfDay >= from && ctx.minutesOfDay < to
          : ctx.minutesOfDay >= from || ctx.minutesOfDay < to; // janela que cruza a meia-noite
      return inWindow ? { reason: "grupo fechado neste horário" } : null;
    }
  }
}

function parseHhmm(v: string | undefined): number | null {
  if (!v) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}
