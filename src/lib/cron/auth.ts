import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * A Vercel chama o cron com `Authorization: Bearer $CRON_SECRET`.
 * Também aceitamos o header direto, para quando quem dispara é o cron do VPS
 * (necessário no plano Hobby, onde o cron da Vercel roda uma vez por dia).
 */
export function isAuthorizedCron(req: Request): boolean {
  const expected = env().CRON_SECRET;
  const auth = req.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  const direct = req.headers.get("x-cron-secret");
  return equals(bearer, expected) || equals(direct, expected);
}

function equals(received: string | null, expected: string): boolean {
  if (!received) return false;
  const a = createHash("sha256").update(received).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
