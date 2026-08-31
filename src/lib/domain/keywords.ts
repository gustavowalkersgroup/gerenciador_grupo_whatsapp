import { containsTerm, equalsTerm, normalize, startsWithTerm } from "./text";

export type MatchMode = "contains" | "exact" | "regex" | "starts_with";

export interface Trigger {
  id: string;
  name: string;
  keywords: string[];
  /** Todos precisam aparecer, além de bater alguma keyword. */
  requiredAll: string[];
  /** Se qualquer um aparecer, o gatilho é descartado. */
  negativeKeywords: string[];
  mode: MatchMode;
  priority: number;
  enabled: boolean;
  groupId: string | null;
}

export interface TriggerMatch {
  trigger: Trigger;
  matchedTerm: string;
}

/**
 * Casa a mensagem contra os gatilhos. Devolve ordenado por prioridade
 * (maior primeiro) e, em empate, pelo termo mais específico — assim
 * "sapato 44" ganha de "sapato" quando os dois batem.
 */
export function matchTriggers(triggers: Trigger[], rawText: string): TriggerMatch[] {
  const text = rawText?.trim();
  if (!text) return [];
  const normalized = normalize(text);
  if (!normalized) return [];

  const matches: TriggerMatch[] = [];

  for (const trigger of triggers) {
    if (!trigger.enabled) continue;
    if (!trigger.keywords?.length) continue;

    if (trigger.negativeKeywords?.some((n) => termMatches(trigger.mode, normalized, text, n))) {
      continue;
    }

    if (
      trigger.requiredAll?.length &&
      !trigger.requiredAll.every((r) => termMatches("contains", normalized, text, r))
    ) {
      continue;
    }

    const matchedTerm = trigger.keywords.find((k) =>
      termMatches(trigger.mode, normalized, text, k),
    );
    if (matchedTerm) matches.push({ trigger, matchedTerm });
  }

  return matches.sort(
    (a, b) =>
      b.trigger.priority - a.trigger.priority ||
      b.matchedTerm.length - a.matchedTerm.length ||
      a.trigger.name.localeCompare(b.trigger.name),
  );
}

function termMatches(
  mode: MatchMode,
  normalized: string,
  raw: string,
  term: string,
): boolean {
  if (!term) return false;
  switch (mode) {
    case "contains":
      return containsTerm(normalized, term);
    case "exact":
      return equalsTerm(normalized, term);
    case "starts_with":
      return startsWithTerm(normalized, term);
    case "regex":
      return safeRegexTest(term, raw);
  }
}

/**
 * Regex vem do painel, ou seja, de humano. Um padrão inválido não pode
 * derrubar o webhook, e um catastrófico não pode travar a função.
 */
function safeRegexTest(pattern: string, input: string): boolean {
  let re: RegExp;
  try {
    re = new RegExp(pattern, "iu");
  } catch {
    return false;
  }
  // Limita o tamanho da entrada — protege contra backtracking exponencial.
  return re.test(input.slice(0, 2000));
}

/** Motivos pelos quais o DM não sai. Vão pro log pra você auditar depois. */
export type SuppressionReason =
  | "opt_out"
  | "cooldown"
  | "trigger_daily_limit"
  | "instance_daily_limit"
  | "sender_is_admin"
  | "sender_is_bot"
  | "send_error";

export interface GateInput {
  optOut: boolean;
  minutesSinceLastHit: number | null;
  cooldownMinutes: number;
  hitsTodayForTrigger: number;
  triggerDailyLimit: number;
  dmsTodayForInstance: number;
  instanceDailyLimit: number;
}

/**
 * Decide se pode mandar o DM. É aqui que o sistema deixa de ser um
 * spammer: opt-out manda em tudo, e os tetos diários protegem o número.
 */
export function canSendDm(input: GateInput): { allowed: true } | { allowed: false; reason: SuppressionReason } {
  if (input.optOut) return { allowed: false, reason: "opt_out" };

  if (
    input.cooldownMinutes > 0 &&
    input.minutesSinceLastHit !== null &&
    input.minutesSinceLastHit < input.cooldownMinutes
  ) {
    return { allowed: false, reason: "cooldown" };
  }

  if (input.triggerDailyLimit > 0 && input.hitsTodayForTrigger >= input.triggerDailyLimit) {
    return { allowed: false, reason: "trigger_daily_limit" };
  }

  if (input.instanceDailyLimit > 0 && input.dmsTodayForInstance >= input.instanceDailyLimit) {
    return { allowed: false, reason: "instance_daily_limit" };
  }

  return { allowed: true };
}

/** Frases que fazem o contato sair da lista. Checadas no privado. */
const OPT_OUT_TERMS = [
  "sair",
  "parar",
  "pare",
  "descadastrar",
  "cancelar",
  "nao quero mais",
  "não quero mais",
  "remover meu numero",
  "stop",
  "unsubscribe",
];

export function isOptOutMessage(rawText: string): boolean {
  const n = normalize(rawText);
  if (!n || n.length > 40) return false;
  return OPT_OUT_TERMS.some((t) => equalsTerm(n, t) || containsTerm(n, t));
}
