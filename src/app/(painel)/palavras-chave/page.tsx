import Link from "next/link";
import { and, asc, count, desc, eq, ne, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import {
  contacts,
  groups,
  instances,
  keywordHits,
  keywordTriggers,
  tags,
} from "@/lib/db/schema";
import { formatPhone } from "@/lib/domain/jid";
import { Alert, Badge, Card, Empty, Stat, Table, Td } from "@/components/ui";
import { AcoesGatilho, FormGatilho, type GatilhoInicial } from "./gatilho-form";
import { TestarFrase } from "./testar";

export const dynamic = "force-dynamic";

const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const MODO: Record<string, string> = {
  contains: "contém",
  exact: "exata",
  starts_with: "começa com",
  regex: "regex",
};

/** Motivos gravados pelo runner, traduzidos pra quem opera o painel. */
const MOTIVO: Record<string, string> = {
  opt_out: "pediu para sair",
  cooldown: "já recebeu há pouco",
  trigger_daily_limit: "teto do gatilho",
  instance_daily_limit: "teto do número",
  daily_limit: "teto diário",
  sender_is_admin: "quem falou é admin",
  sender_is_bot: "mensagem do próprio número",
  send_error: "falha no envio",
};

/** jsonb chega como unknown: um array sujo não pode quebrar a listagem. */
function comoLista(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function porLinha(v: unknown): string {
  return comoLista(v).join("\n");
}

/** Janela das últimas 24h resolvida pelo Postgres, não pelo relógio do serverless. */
const ultimas24h = () => sql`${keywordHits.createdAt} >= now() - interval '24 hours'`;

function tempo(minutos: number): string {
  if (minutos <= 0) return "sem cooldown";
  if (minutos % 1440 === 0) return `${minutos / 1440} dia(s)`;
  if (minutos % 60 === 0) return `${minutos / 60} h`;
  return `${minutos} min`;
}

export default async function PalavrasChavePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();

  const sp = await searchParams;

  const listaInstancias = await db
    .select({ id: instances.id, label: instances.label, dailyDmLimit: instances.dailyDmLimit })
    .from(instances)
    .orderBy(asc(instances.createdAt));

  if (listaInstancias.length === 0) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-xl font-semibold">Palavras-chave</h1>
        </header>
        <Alert tone="warn" title="Nenhum número cadastrado">
          Conecte um número em{" "}
          <Link href="/instancias" className="underline">
            Números
          </Link>{" "}
          antes de criar gatilhos — é ele que escuta os grupos e manda o privado.
        </Alert>
      </div>
    );
  }

  const pedida = primeiro(sp.instancia);
  const instancia = listaInstancias.find((i) => i.id === pedida) ?? listaInstancias[0];
  const editarId = primeiro(sp.editar) ?? "";

  const [listaGrupos, listaEtiquetas, gatilhos, contagens, [suprimidos], historico] =
    await Promise.all([
    db
      .select({ id: groups.id, nome: groups.name })
      .from(groups)
      .where(and(eq(groups.instanceId, instancia.id), eq(groups.managed, true)))
      .orderBy(asc(groups.name)),
    db.select({ id: tags.id, nome: tags.name }).from(tags).orderBy(asc(tags.name)),
    db
      .select({
        gatilho: keywordTriggers,
        grupoNome: groups.name,
        etiquetaNome: tags.name,
      })
      .from(keywordTriggers)
      .leftJoin(groups, eq(keywordTriggers.groupId, groups.id))
      .leftJoin(tags, eq(keywordTriggers.applyTagId, tags.id))
      .where(eq(keywordTriggers.instanceId, instancia.id))
      .orderBy(desc(keywordTriggers.priority), asc(keywordTriggers.name)),
    db
      .select({ triggerId: keywordHits.triggerId, n: count() })
      .from(keywordHits)
      .innerJoin(keywordTriggers, eq(keywordHits.triggerId, keywordTriggers.id))
      .where(
        and(
          eq(keywordTriggers.instanceId, instancia.id),
          eq(keywordHits.status, "sent"),
          ultimas24h(),
        ),
      )
      .groupBy(keywordHits.triggerId),
    db
      .select({ n: count() })
      .from(keywordHits)
      .innerJoin(keywordTriggers, eq(keywordHits.triggerId, keywordTriggers.id))
      .where(
        and(
          eq(keywordTriggers.instanceId, instancia.id),
          ne(keywordHits.status, "sent"),
          ultimas24h(),
        ),
      ),
    db
      .select({
        id: keywordHits.id,
        createdAt: keywordHits.createdAt,
        matchedTerm: keywordHits.matchedTerm,
        excerpt: keywordHits.excerpt,
        status: keywordHits.status,
        reason: keywordHits.reason,
        gatilho: keywordTriggers.name,
        contato: contacts.pushName,
        telefone: contacts.phone,
        grupo: groups.name,
      })
      .from(keywordHits)
      .innerJoin(keywordTriggers, eq(keywordHits.triggerId, keywordTriggers.id))
      .innerJoin(contacts, eq(keywordHits.contactId, contacts.id))
      .leftJoin(groups, eq(keywordHits.groupId, groups.id))
      .where(eq(keywordTriggers.instanceId, instancia.id))
      .orderBy(desc(keywordHits.createdAt))
      .limit(100),
    ]);

  const disparos = new Map(contagens.map((c) => [c.triggerId, c.n]));
  const ativos = gatilhos.filter((g) => g.gatilho.enabled).length;
  const enviados24h = contagens.reduce((soma, c) => soma + c.n, 0);
  const suprimidos24h = suprimidos?.n ?? 0;

  const emEdicao = gatilhos.find((g) => g.gatilho.id === editarId);
  const inicial: GatilhoInicial | undefined = emEdicao
    ? {
        id: emEdicao.gatilho.id,
        name: emEdicao.gatilho.name,
        groupId: emEdicao.gatilho.groupId ?? "",
        keywords: porLinha(emEdicao.gatilho.keywords),
        requiredAll: porLinha(emEdicao.gatilho.requiredAll),
        negativeKeywords: porLinha(emEdicao.gatilho.negativeKeywords),
        mode: emEdicao.gatilho.mode,
        priority: emEdicao.gatilho.priority,
        dmTemplate: emEdicao.gatilho.dmTemplate,
        dmMediaUrl: emEdicao.gatilho.dmMediaUrl ?? "",
        dmMediaType: emEdicao.gatilho.dmMediaType ?? "image",
        replyInGroup: emEdicao.gatilho.replyInGroup,
        groupReplyTemplate: emEdicao.gatilho.groupReplyTemplate ?? "",
        cooldownMinutes: emEdicao.gatilho.cooldownMinutes,
        dailyLimit: emEdicao.gatilho.dailyLimit,
        applyTagId: emEdicao.gatilho.applyTagId ?? "",
        enabled: emEdicao.gatilho.enabled,
      }
    : undefined;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Palavras-chave</h1>
        <p className="mt-1 text-sm text-muted">
          Captura quem demonstra interesse no grupo e puxa a conversa pro privado.
        </p>
      </header>

      <Alert tone="info" title="Como funciona">
        Alguém escreve <strong>“quero sapato x 44”</strong> num grupo que você gerencia. O sistema
        reconhece a frase, manda a mensagem que você escreveu no privado dessa pessoa e aplica a
        etiqueta de lead. Quem pediu para sair nunca recebe, ninguém recebe duas vezes dentro do
        cooldown, e os tetos diários seguram o volume para o número não ser bloqueado.
      </Alert>

      {listaInstancias.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-muted">Número</span>
          {listaInstancias.map((i) => (
            <Link
              key={i.id}
              href={`/palavras-chave?instancia=${i.id}`}
              className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                i.id === instancia.id
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-border bg-surface-2 text-muted hover:text-text"
              }`}
            >
              {i.label}
            </Link>
          ))}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Gatilhos ativos" value={`${ativos}/${gatilhos.length}`} tone="accent" />
        <Stat label="Privados enviados" value={enviados24h} hint="últimas 24h" />
        <Stat label="Suprimidos" value={suprimidos24h} hint="últimas 24h" tone="warn" />
        <Stat
          label="Teto do número"
          value={instancia.dailyDmLimit}
          hint="privados por dia, somando todos os gatilhos"
        />
      </div>

      <Card
        title={`${gatilhos.length} gatilho(s)`}
        subtitle="Quando dois gatilhos casam na mesma mensagem, só o de maior prioridade envia."
      >
        {gatilhos.length === 0 ? (
          <Empty
            title="Nenhum gatilho criado"
            hint="Comece pelo formulário abaixo — ex.: palavras “sapato 44” exigindo “sapato”."
          />
        ) : (
          <Table
            head={[
              "Gatilho",
              "Onde vale",
              "Palavras",
              "Modo",
              "Cooldown",
              "Teto/dia",
              "Etiqueta",
              "24h",
              "Estado",
              "",
            ]}
          >
            {gatilhos.map(({ gatilho: g, grupoNome, etiquetaNome }) => {
              const palavras = comoLista(g.keywords);
              const obrigatorias = comoLista(g.requiredAll);
              const negativas = comoLista(g.negativeKeywords);
              return (
                <tr key={g.id} className={g.id === editarId ? "bg-accent/5" : undefined}>
                  <Td>
                    <span className="font-medium">{g.name}</span>
                    {g.priority !== 0 && (
                      <span className="ml-2 text-xs text-muted">prioridade {g.priority}</span>
                    )}
                  </Td>
                  <Td className="text-muted">{grupoNome ?? "Todos os grupos"}</Td>
                  <Td>
                    <div className="flex max-w-64 flex-wrap gap-1">
                      {palavras.slice(0, 4).map((p) => (
                        <code key={p} className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">
                          {p}
                        </code>
                      ))}
                      {palavras.length > 4 && (
                        <span className="text-xs text-muted">+{palavras.length - 4}</span>
                      )}
                    </div>
                    {(obrigatorias.length > 0 || negativas.length > 0) && (
                      <p className="mt-1 text-xs text-muted">
                        {obrigatorias.length > 0 && `exige: ${obrigatorias.join(", ")}`}
                        {obrigatorias.length > 0 && negativas.length > 0 && " · "}
                        {negativas.length > 0 && `nunca: ${negativas.join(", ")}`}
                      </p>
                    )}
                  </Td>
                  <Td className="text-muted">{MODO[g.mode] ?? g.mode}</Td>
                  <Td className="whitespace-nowrap text-muted">{tempo(g.cooldownMinutes)}</Td>
                  <Td className="tabular-nums text-muted">
                    {g.dailyLimit > 0 ? g.dailyLimit : "—"}
                  </Td>
                  <Td>
                    {etiquetaNome ? (
                      <Badge tone="info">{etiquetaNome}</Badge>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </Td>
                  <Td className="tabular-nums font-medium">{disparos.get(g.id) ?? 0}</Td>
                  <Td>
                    {g.enabled ? (
                      <Badge tone="accent">ativo</Badge>
                    ) : (
                      <Badge tone="neutral">parado</Badge>
                    )}
                  </Td>
                  <Td>
                    <AcoesGatilho id={g.id} nome={g.name} ativo={g.enabled} />
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      <Card
        title="Testar uma frase"
        subtitle="Nada é enviado. Use antes de ligar uma regra num grupo de 500 pessoas."
      >
        <TestarFrase instanceId={instancia.id} grupos={listaGrupos} />
      </Card>

      <div id="formulario" className="scroll-mt-6">
        <Card
          title={emEdicao ? `Editando: ${emEdicao.gatilho.name}` : "Novo gatilho"}
          subtitle={
            emEdicao
              ? "As mudanças valem para as próximas mensagens do grupo."
              : "Um gatilho por intenção. Quanto mais específico, menos falso positivo."
          }
        >
          <FormGatilho
            key={emEdicao?.gatilho.id ?? "novo"}
            instanceId={instancia.id}
            grupos={listaGrupos}
            etiquetas={listaEtiquetas}
            inicial={inicial}
          />
        </Card>
      </div>

      <Card
        title="Histórico"
        subtitle="Últimas 100 capturas deste número, enviadas ou não."
      >
        {historico.length === 0 ? (
          <Empty
            title="Nenhuma captura registrada"
            hint="Assim que alguém falar a palavra num grupo gerenciado, a linha aparece aqui."
          />
        ) : (
          <Table
            head={["Quando", "Contato", "Grupo", "Gatilho", "Termo", "Mensagem", "Resultado"]}
          >
            {historico.map((h) => (
              <tr key={h.id}>
                <Td className="whitespace-nowrap text-muted">
                  {h.createdAt.toLocaleString("pt-BR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </Td>
                <Td>
                  <span className="font-medium">{h.contato ?? "—"}</span>
                  <span className="block font-mono text-xs text-muted">
                    {formatPhone(h.telefone)}
                  </span>
                </Td>
                <Td className="text-muted">{h.grupo ?? "—"}</Td>
                <Td>{h.gatilho}</Td>
                <Td>
                  <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">
                    {h.matchedTerm ?? "—"}
                  </code>
                </Td>
                <Td className="max-w-72 text-muted">{h.excerpt ?? "—"}</Td>
                <Td>
                  {h.status === "sent" ? (
                    <Badge tone="accent">enviado</Badge>
                  ) : (
                    <Badge tone={h.status === "failed" ? "danger" : "warn"}>
                      {h.reason ? (MOTIVO[h.reason] ?? h.reason) : "suprimido"}
                    </Badge>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
