import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { instances } from "@/lib/db/schema";
import { evolution } from "@/lib/evolution/client";
import type { ConnectionState } from "@/lib/evolution/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Status = (typeof instances.$inferSelect)["status"];

const STATE_TO_STATUS: Record<ConnectionState, Status> = {
  open: "connected",
  connecting: "connecting",
  close: "disconnected",
  refused: "banned",
};

export interface QrPayload {
  status: Status;
  base64: string | null;
  code: string | null;
  pairingCode: string | null;
  /** Preenchido quando a Evolution falhou mas ainda dá pra mostrar o último estado conhecido. */
  warning?: string;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  // Painel autenticado por cookie: aqui o certo é 401 e não o redirect do
  // requireUser — o fetch do QR seguiria pro HTML do login e quebraria o JSON.
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const { id } = await params;

  const [row] = await db.select().from(instances).where(eq(instances.id, id)).limit(1);
  if (!row) {
    return NextResponse.json({ error: "Número não encontrado." }, { status: 404 });
  }

  let base64: string | null = null;
  let code: string | null = null;
  let pairingCode: string | null = null;
  let status: Status = row.status;
  let connectError: string | null = null;
  let stateError: string | null = null;

  try {
    const conn = await evolution.instance.connect(row.evolutionName);
    base64 = conn?.base64 ?? null;
    code = conn?.code ?? null;
    pairingCode = conn?.pairingCode ?? null;
  } catch (e) {
    // Instância já pareada costuma recusar /connect — o state abaixo confirma.
    connectError = e instanceof Error ? e.message : "falha ao pedir o QR Code";
  }

  try {
    const state = await evolution.instance.state(row.evolutionName);
    const reported = state?.instance?.state;
    if (reported && reported in STATE_TO_STATUS) status = STATE_TO_STATUS[reported];
  } catch (e) {
    stateError = e instanceof Error ? e.message : "falha ao consultar a conexão";
  }

  if (connectError && stateError) {
    return NextResponse.json(
      {
        error:
          "A Evolution API não respondeu. Confira se o VPS está no ar e se EVOLUTION_API_URL " +
          "e EVOLUTION_API_KEY estão corretas.",
      },
      { status: 502 },
    );
  }

  if (status !== row.status) {
    await db
      .update(instances)
      .set({ status, lastSeenAt: new Date() })
      .where(eq(instances.id, row.id));
    revalidatePath("/instancias");
  } else if (status === "connected") {
    await db.update(instances).set({ lastSeenAt: new Date() }).where(eq(instances.id, row.id));
  }

  const payload: QrPayload = {
    status,
    base64,
    code,
    pairingCode,
    ...(connectError && status !== "connected"
      ? { warning: "A Evolution não devolveu um QR Code novo agora. Tentando de novo…" }
      : {}),
  };

  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}
