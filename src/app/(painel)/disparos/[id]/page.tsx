import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { broadcastTargets, broadcasts, groups, instances } from "@/lib/db/schema";
import type { BroadcastPayload } from "@/lib/services/broadcast";
import { Alert, Badge, Card, Empty, Stat, Table, Td } from "@/components/ui";
import { AcoesCampanha, BotaoReenfileirar } from "../novo-form";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS: Record<
  string,
  { label: string; tone: "accent" | "warn" | "danger" | "info" | "neutral" }
> = {
  draft: { label: "rascunho", tone: "neutral" },
  scheduled: { label: "agendado", tone: "info" },
  running: { label: "em andamento", tone: "accent" },
  paused: { label: "pausado", tone: "warn" },
  done: { label: "concluído", tone: "accent" },
  failed: { label: "falhou", tone: "danger" },
  canceled: { label: "cancelado", tone: "neutral" },
};

const STATUS_ALVO: Record<string, { label: string; tone: "accent" | "warn" | "danger" | "neutral" }> =
  {
    pending: { label: "na fila", tone: "neutral" },
    sent: { label: "enviado", tone: "accent" },
    failed: { label: "falhou", tone: "danger" },
    skipped: { label: "pulado", tone: "warn" },
  };

const TIPO: Record<string, string> = {
  text: "texto",
  image: "imagem",
  video: "vídeo",
  document: "documento",
};

const FUSO = "America/Sao_Paulo";

const dataHora = (d: Date | null) =>
  d ? d.toLocaleString("pt-BR", { timeZone: FUSO, dateStyle: "short", timeStyle: "short" }) : "—";

function Linha({ rotulo, valor }: { rotulo: string; valor: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-muted">{rotulo}</dt>
      <dd className="mt-1 text-sm">{valor}</dd>
    </div>
  );
}

export default async function DisparoDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();

  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const [linha] = await db
    .select({ campanha: broadcasts, instancia: instances })
    .from(broadcasts)
    .innerJoin(instances, eq(broadcasts.instanceId, instances.id))
    .where(eq(broadcasts.id, id))
    .limit(1);
  if (!linha) notFound();

  const { campanha, instancia } = linha;
  const payload = campanha.payload as BroadcastPayload;

  const alvos = await db
    .select({
      id: broadcastTargets.id,
      status: broadcastTargets.status,
      attempts: broadcastTargets.attempts,
      error: broadcastTargets.error,
      sentAt: broadcastTargets.sentAt,
      grupo: groups.name,
      jid: groups.jid,
    })
    .from(broadcastTargets)
    .innerJoin(groups, eq(broadcastTargets.groupId, groups.id))
    .where(eq(broadcastTargets.broadcastId, campanha.id))
    .orderBy(asc(groups.name));

  const conta = (s: string) => alvos.filter((a) => a.status === s).length;
  const enviados = conta("sent");
  const falhados = conta("failed");
  const pendentes = conta("pending");
  const pulados = conta("skipped");
  const pct = alvos.length > 0 ? Math.round((enviados / alvos.length) * 100) : 0;

  const s = STATUS[campanha.status] ?? STATUS.draft;
  const intervalo = `${(campanha.minDelayMs / 1000).toFixed(0)}s a ${(campanha.maxDelayMs / 1000).toFixed(0)}s`;

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <Link href="/disparos" className="text-xs text-muted hover:text-text">
          ← Voltar para disparos
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{campanha.name}</h1>
            <p className="mt-1 text-sm text-muted">
              {instancia.label} · {TIPO[payload?.type] ?? "texto"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge tone={s.tone}>{s.label}</Badge>
            <AcoesCampanha
              broadcastId={campanha.id}
              status={campanha.status}
              nome={campanha.name}
            />
          </div>
        </div>
      </header>

      <Alert tone="info" title="Envio processado pelo cron">
        Quem envia é o cron <code>/api/cron/dispatch</code>, em lotes de {campanha.batchSize} grupos
        por execução. Cada rodada continua de onde a anterior parou, então esta tela pode levar
        alguns minutos para chegar a 100%.
      </Alert>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Alvos" value={alvos.length} hint={`${pct}% enviado`} />
        <Stat label="Enviados" value={enviados} tone="accent" />
        <Stat label="Na fila" value={pendentes} />
        <Stat label="Falhados" value={falhados} tone={falhados > 0 ? "danger" : "default"} />
        <Stat label="Pulados" value={pulados} tone={pulados > 0 ? "warn" : "default"} />
      </div>

      <Card title="Resumo" subtitle="Conteúdo e ritmo configurados na criação">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Linha rotulo="Intervalo entre envios" valor={intervalo} />
          <Linha rotulo="Lote por execução do cron" valor={`${campanha.batchSize} grupos`} />
          <Linha rotulo="Agendada para" valor={dataHora(campanha.scheduledAt)} />
          <Linha rotulo="Criada em" valor={dataHora(campanha.createdAt)} />
          <Linha rotulo="Iniciada em" valor={dataHora(campanha.startedAt)} />
          <Linha rotulo="Finalizada em" valor={dataHora(campanha.finishedAt)} />
          {payload?.mediaUrl && (
            <Linha
              rotulo="Mídia"
              valor={<span className="break-all font-mono text-xs">{payload.mediaUrl}</span>}
            />
          )}
          {payload?.fileName && <Linha rotulo="Nome do arquivo" valor={payload.fileName} />}
        </dl>

        <div className="mt-5">
          <p className="text-xs uppercase tracking-wider text-muted">
            {payload?.type === "text" ? "Mensagem" : "Legenda"}
          </p>
          <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm">
            {payload?.text?.trim() || "(sem texto)"}
          </pre>
          <p className="mt-1 text-xs text-muted">
            {"{{grupo}}"} é trocado pelo nome de cada grupo no momento do envio.
          </p>
        </div>

        <div className="mt-5">
          <BotaoReenfileirar broadcastId={campanha.id} falhados={falhados} />
          <p className="mt-2 text-xs text-muted">
            Reenfileirar devolve os alvos falhados para a fila e zera as tentativas. Se a campanha já
            tinha terminado, ela volta a ficar em andamento para o cron pegar de novo.
          </p>
        </div>
      </Card>

      <Card title="Alvos" subtitle="Um grupo por linha, na ordem alfabética">
        {alvos.length === 0 ? (
          <Empty title="Nenhum alvo" hint="A campanha foi criada sem grupos correspondentes." />
        ) : (
          <Table head={["Grupo", "Status", "Tentativas", "Erro", "Enviado em"]}>
            {alvos.map((a) => {
              const sa = STATUS_ALVO[a.status] ?? STATUS_ALVO.pending;
              return (
                <tr key={a.id}>
                  <Td>
                    <span className="font-medium">{a.grupo || "(sem nome)"}</span>
                    <p className="mt-0.5 font-mono text-xs text-muted">{a.jid}</p>
                  </Td>
                  <Td>
                    <Badge tone={sa.tone}>{sa.label}</Badge>
                  </Td>
                  <Td className="tabular-nums">{a.attempts}</Td>
                  <Td className="max-w-xs text-xs text-danger">{a.error ?? "—"}</Td>
                  <Td className="whitespace-nowrap text-muted">{dataHora(a.sentAt)}</Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </div>
  );
}
