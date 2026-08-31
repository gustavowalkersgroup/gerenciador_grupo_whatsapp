/**
 * Data no formato YYYY-MM-DD no fuso informado.
 *
 * `toISOString().slice(0,10)` seria mais curto e estaria errado: no Brasil
 * (UTC-3) tudo que acontece depois das 21h cai no dia seguinte em UTC, e o
 * relatório de "mensagens de terça" perderia a noite inteira de terça.
 */
export function localDay(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Primeiro e último dia de uma janela que termina hoje, no fuso informado.
 *
 * Fica aqui, e não dentro do componente, porque ler o relógio durante o render
 * é impuro — o lint do React reclama com razão, mesmo em página dinâmica.
 */
export function periodDays(days: number, timeZone: string, now = new Date()): string[] {
  return Array.from({ length: days }, (_, i) =>
    localDay(new Date(now.getTime() - (days - 1 - i) * 86_400_000), timeZone),
  );
}
