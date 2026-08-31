import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron/auth";
import { dispatchDue } from "@/lib/services/broadcast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Margem antes do teto da função. Sair por conta própria deixa o estado
 * consistente; ser morto pelo runtime deixaria alvo em limbo.
 */
const SAFETY_MS = 8_000;

async function handle(req: Request) {
  if (!isAuthorizedCron(req)) return new NextResponse(null, { status: 401 });

  const deadlineMs = Date.now() + maxDuration * 1000 - SAFETY_MS;
  const report = await dispatchDue({ deadlineMs });

  return NextResponse.json({ ok: true, ...report });
}

export const GET = handle;
export const POST = handle;
