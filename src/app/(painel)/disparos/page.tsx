import Link from "next/link";
import { asc, count, desc, eq, inArray } from "drizzle-orm";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { broadcastTargets, broadcasts, groupTags, groups, instances, tags } from "@/lib/db/schema";
import type { BroadcastPayload } from "@/lib/services/broadcast";
import { Alert, Badge, Card, Empty, Stat, Table, Td } from "@/components/ui";
import {
  AcoesCampanha,
  FormNovoDisparo,
  type EtiquetaOpcao,
  type GrupoOpcao,
} from "./novo-form";

export const dynamic = "force-dynamic";

/** Campanha antiga não ajuda a operar e a página fica pesada. */
const LIMITE_CAMPANHAS = 40;

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

const TIPO: Record<string, string> = {
  text: "texto",
  image: "imagem",
  video: "vídeo",
  document: "documento",
};

const FUSO = "America/Sao_Paulo";

const dataHora = (d: Date | null) =>
  d ? d.toLocaleString("pt-BR", { timeZone: FUSO, dateStyle: "short", timeStyle: "short" }) : "—";

function Progresso({ enviados, total }: { enviados: number; total: number }) {
  const pct = total > 0 ? Math.round((enviados / total) * 100) : 0;
  return (
    <div className="min-w-32">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs tabular-nums text-muted">
        {enviados}/{total} ({pct}%)
      </p>
    </div>
  );
}

export default async function DisparosPage() {
  await requireUser();

  const listaInstancias = await db
    .select({ id: instances.id, label: instances.label, status: instances.status })
    .from(instances)
    .orderBy(asc(instances.createdAt));

  const [gruposRows, etiquetasRows, vinculos, campanhas] = await Promise.all([
    db
      .select({
        id: groups.id,
        instanceId: groups.instanceId,
        nome: groups.name,
        participantes: groups.participantsCount,
      })
      .from(groups)
      .where(eq(groups.managed, true))
      .orderBy(asc(groups.name)),
    db
      .select({ id: tags.id, nome: tags.name, cor: tags.color })
      .from(tags)
      .orderBy(asc(tags.name)),
    db.select({ groupId: groupTags.groupId, tagId: groupTags.tagId }).from(groupTags),
    db
      .select({ campanha: broadcasts, instancia: instances.label })
      .from(broadcasts)
      .innerJoin(instances, eq(broadcasts.instanceId, instances.id))
      .orderBy(desc(broadcasts.createdAt))
      .limit(LIMITE_CAMPANHAS),
  ]);

  const contagens = campanhas.length
    ? await db
        .select({
          broadcastId: broadcastTargets.broadcastId,
          status: broadcastTargets.status,
          n: count(),
        })
        .from(broadcastTargets)
        .where(
          inArray(
            broadcastTargets.broadcastId,
            campanhas.map((c) => c.campanha.id),
          ),
        )
        .groupBy(broadcastTargets.broadcastId, broadcastTargets.status)
    : [];

  const porCampanha = new Map<string, { total: number; enviados: number; falhados: number }>();
  for (const linha of contagens) {
    const atual = porCampanha.get(linha.broadcastId) ?? { total: 0, enviados: 0, falhados: 0 };
    atual.total += linha.n;
    if (linha.status === "sent") atual.enviados += linha.n;
    if (linha.status === "failed") atual.falhados += linha.n;
    porCampanha.set(linha.broadcastId, atual);
  }

  const tagsPorGrupo = new Map<string, string[]>();
  for (const v of vinculos) {
    const atual = tagsPorGrupo.get(v.groupId);
    if (atual) atual.push(v.tagId);
    else tagsPorGrupo.set(v.groupId, [v.tagId]);
  }

  const gruposOpcoes: GrupoOpcao[] = gruposRows.map((g) => ({
    id: g.id,
    instanceId: g.instanceId,
    nome: g.nome,
    participantes: g.participantes,
    tagIds: tagsPorGrupo.get(g.id) ?? [],
  }));

  const etiquetasOpcoes: EtiquetaOpcao[] = etiquetasRows.map((t) => ({
    id: t.id,
    nome: t.nome,
    cor: t.cor,
  }));

  const emAndamento = campanhas.filter(
    (c) => c.campanha.status === "running" || c.campanha.status === "scheduled",
  ).length;
  const pendentesTotais = campanhas.reduce((soma, c) => {
    const p = porCampanha.get(c.campanha.id);
    return soma + (p ? p.total - p.enviados : 0);
  }, 0);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Disparos</h1>
        <p className="mt-1 text-sm text-muted">
          Mensagem agendada para os grupos gerenciados, com intervalo aleatório entre os envios.
        </p>
      </header>

      <Alert tone="info" title="Como o envio acontece">
        O disparo não é enviado pelo navegador: o cron <code>/api/cron/dispatch</code> processa a
        fila em lotes e continua exatamente de onde parou a cada execução. Fechar esta página não
        interrompe nada, e pausar só vale a partir do próximo lote.
      </Alert>

      {listaInstancias.length === 0 ? (
        <Alert tone="warn" title="Nenhum número cadastrado">
          Conecte um número em{" "}
          <Link href="/instancias" className="underline">
            Números
          </Link>{" "}
          antes de criar um disparo.
        </Alert>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Campanhas" value={campanhas.length} hint={`últimas ${LIMITE_CAMPANHAS}`} />
            <Stat
              label="Ativas"
              value={emAndamento}
              hint="agendadas ou em andamento"
              tone={emAndamento > 0 ? "accent" : "default"}
            />
            <Stat label="Grupos na fila" value={pendentesTotais} hint="ainda não enviados" />
          </div>

          <Card
            title="Novo disparo"
            subtitle="Escolha os grupos por checkbox, por etiqueta, ou os dois — a lista é a união."
          >
            {gruposOpcoes.length === 0 ? (
              <Empty
                title="Nenhum grupo gerenciado"
                hint="Sincronize os grupos e marque como gerenciados na aba Grupos."
              />
            ) : (
              <FormNovoDisparo
                instancias={listaInstancias.map((i) => ({
                  id: i.id,
                  label: i.label,
                  conectada: i.status === "connected",
                }))}
                grupos={gruposOpcoes}
                etiquetas={etiquetasOpcoes}
              />
            )}
          </Card>
        </>
      )}

      <Card title="Campanhas" subtitle="Progresso contado em alvos enviados sobre o total">
        {campanhas.length === 0 ? (
          <Empty
            title="Nenhuma campanha ainda"
            hint="Crie o primeiro disparo no formulário acima."
          />
        ) : (
          <Table
            head={["Campanha", "Número", "Status", "Progresso", "Agendada para", "Ações"]}
          >
            {campanhas.map(({ campanha, instancia }) => {
              const s = STATUS[campanha.status] ?? STATUS.draft;
              const p = porCampanha.get(campanha.id) ?? { total: 0, enviados: 0, falhados: 0 };
              const payload = campanha.payload as BroadcastPayload;
              return (
                <tr key={campanha.id}>
                  <Td>
                    <Link href={`/disparos/${campanha.id}`} className="font-medium hover:underline">
                      {campanha.name}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted">
                      {TIPO[payload?.type] ?? "texto"} · criada em {dataHora(campanha.createdAt)}
                    </p>
                  </Td>
                  <Td className="text-muted">{instancia}</Td>
                  <Td>
                    <Badge tone={s.tone}>{s.label}</Badge>
                    {p.falhados > 0 && (
                      <span className="ml-2 text-xs text-danger">{p.falhados} falhou</span>
                    )}
                  </Td>
                  <Td>
                    <Progresso enviados={p.enviados} total={p.total} />
                  </Td>
                  <Td className="whitespace-nowrap text-muted">{dataHora(campanha.scheduledAt)}</Td>
                  <Td>
                    <AcoesCampanha
                      broadcastId={campanha.id}
                      status={campanha.status}
                      nome={campanha.name}
                    />
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </div>
  );
}
