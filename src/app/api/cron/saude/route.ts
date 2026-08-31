import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { instances } from "@/lib/db/schema";
import { isAuthorizedCron } from "@/lib/cron/auth";
import { evolution } from "@/lib/evolution/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAPA = {
  open: "connected",
  connecting: "connecting",
  close: "disconnected",
  refused: "banned",
} as const;

/**
 * Pergunta ativamente à Evolution como está cada número.
 *
 * O status só era gravado quando CHEGAVA um evento de conexão. Se o VPS
 * morre, nenhum evento chega — e o painel segue mostrando "conectado" para
 * sempre enquanto o cliente não recebe nada. O único jeito de descobrir que
 * o silêncio é falha, e não sossego, é perguntar.
 */
async function handle(req: Request) {
  if (!isAuthorizedCron(req)) return new NextResponse(null, { status: 401 });

  const linhas = await db.select().from(instances);
  const resultado: Array<{ instancia: string; de: string; para: string }> = [];

  for (const inst of linhas) {
    let status: (typeof MAPA)[keyof typeof MAPA] = "disconnected";
    try {
      const r = await evolution.instance.state(inst.evolutionName);
      status = MAPA[r?.instance?.state ?? "close"] ?? "disconnected";
    } catch {
      // Evolution fora do ar: o número está inalcançável, e é exatamente
      // isso que o painel precisa mostrar.
      status = "disconnected";
    }

    if (status !== inst.status) {
      resultado.push({ instancia: inst.label, de: inst.status, para: status });
    }

    await db
      .update(instances)
      .set({
        status,
        // lastSeenAt só avança quando a conexão está realmente de pé: é o
        // carimbo de "a última vez que este número funcionou".
        ...(status === "connected" ? { lastSeenAt: new Date() } : {}),
      })
      .where(eq(instances.id, inst.id));
  }

  return NextResponse.json({
    ok: true,
    verificadas: linhas.length,
    mudancas: resultado,
  });
}

export const GET = handle;
export const POST = handle;
