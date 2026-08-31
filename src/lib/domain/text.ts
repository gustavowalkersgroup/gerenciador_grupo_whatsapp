/**
 * Normalização de texto pra casar palavra-chave em português.
 * "Quero SAPATO x 44!" e "quero sapato 44" precisam bater na mesma regra.
 */
export function normalize(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // tira acento (marcas de combinação do NFD)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s@._+-]/gu, " ") // pontuação vira espaço
    .replace(/\s+/g, " ")
    .trim();
}

/** Compara respeitando limite de palavra, pra "44" não bater em "444". */
export function containsTerm(haystackNormalized: string, term: string): boolean {
  const t = normalize(term);
  if (!t) return false;
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // \b não funciona bem com acento/unicode já normalizado, então usamos lookaround manual.
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, "u");
  return re.test(haystackNormalized);
}

export function startsWithTerm(haystackNormalized: string, term: string): boolean {
  const t = normalize(term);
  return !!t && haystackNormalized.startsWith(t);
}

export function equalsTerm(haystackNormalized: string, term: string): boolean {
  return haystackNormalized === normalize(term);
}

const URL_RE =
  /\b(?:https?:\/\/|www\.)[^\s]+|\b[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:com|net|org|br|io|me|co|shop|store|app|xyz|link|site|online|info|gg|tv|ly)(?:\.[a-z]{2})?\b(?:\/[^\s]*)?/gi;

const WA_INVITE_RE = /chat\.whatsapp\.com\/[A-Za-z0-9]{10,}/gi;

export interface LinkScan {
  hasLink: boolean;
  links: string[];
  hasWhatsAppInvite: boolean;
}

export function scanLinks(raw: string): LinkScan {
  const links = raw.match(URL_RE) ?? [];
  return {
    hasLink: links.length > 0,
    links,
    hasWhatsAppInvite: WA_INVITE_RE.test(raw),
  };
}

/** Extrai o domínio pra checar contra a allowlist. */
export function domainOf(link: string): string | null {
  try {
    const withProto = /^https?:\/\//i.test(link) ? link : `https://${link}`;
    return new URL(withProto).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Substitui {{nome}}, {{grupo}} etc. Placeholder sem valor vira string vazia. */
export function renderTemplate(template: string, vars: Record<string, string | undefined>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => vars[key] ?? "");
}

/** Recorte curto pra log — não guardamos a mensagem inteira (LGPD). */
export function excerpt(raw: string, max = 180): string {
  const clean = raw.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}
