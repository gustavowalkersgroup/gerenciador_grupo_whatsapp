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
