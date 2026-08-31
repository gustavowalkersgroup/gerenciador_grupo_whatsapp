import Link from "next/link";
import { and, desc, eq, gte, sql, sum } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, dailyGroupStats, groupMembers, groups } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/guard";
import { periodDays } from "@/lib/domain/day";
import { formatPhone } from "@/lib/domain/jid";
import { env } from "@/lib/env";
import { BarChart, LineChart, type Point } from "@/components/chart";
import { Card, Empty, Stat, Table, Td } from "@/components/ui";

export const dynamic = "force-dynamic";

const PERIODOS = [7, 30, 90] as const;
type Periodo = (typeof PERIODOS)[number];

function periodoDe(valor: string | undefined): Periodo {
  const n = Number(valor);
  return (PERIODOS as readonly number[]).includes(n) ? (n as Periodo) : 30;
}

const fmt = new Intl.NumberFormat("pt-BR");

export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string; grupo?: string }>;
}) {
  await requireUser();
  const params = await searchParams;

  const dias = periodoDe(params.dias);
  const grupoFiltro = /^[0-9a-f-]{36}$/i.test(params.grupo ?? "") ? params.grupo! : null;

  const tz = env().TZ_DEFAULT;
  const janela = periodDays(dias, tz);
  const inicioDia = janela[0];

  const escopo = grupoFiltro
    ? and(gte(dailyGroupStats.day, inicioDia), eq(dailyGroupStats.groupId, grupoFiltro))
    : gte(dailyGroupStats.day, inicioDia);

  const [totais, porDia, porGrupo, listaGrupos, maisAtivos] = await Promise.all([
    db
      .select({
        mensagens: sum(dailyGroupStats.messages).mapWith(Number),
        ativos: sum(dailyGroupStats.activeMembers).mapWith(Number),
        entradas: sum(dailyGroupStats.joins).mapWith(Number),
        saidas: sum(dailyGroupStats.leaves).mapWith(Number),
        capturas: sum(dailyGroupStats.keywordHits).mapWith(Number),
        moderacoes: sum(dailyGroupStats.moderations).mapWith(Number),
      })
      .from(dailyGroupStats)
      .where(escopo),

    db
      .select({
        dia: dailyGroupStats.day,
        mensagens: sum(dailyGroupStats.messages).mapWith(Number),
      })
      .from(dailyGroupStats)
      .where(escopo)
      .groupBy(dailyGroupStats.day)
      .orderBy(dailyGroupStats.day),

    db
      .select({
        id: groups.id,
        nome: groups.name,
        mensagens: sum(dailyGroupStats.messages).mapWith(Number),
        ativos: sum(dailyGroupStats.activeMembers).mapWith(Number),
        entradas: sum(dailyGroupStats.joins).mapWith(Number),
        saidas: sum(dailyGroupStats.leaves).mapWith(Number),
        capturas: sum(dailyGroupStats.keywordHits).mapWith(Number),
        moderacoes: sum(dailyGroupStats.moderations).mapWith(Number),
      })
      .from(dailyGroupStats)
      .innerJoin(groups, eq(dailyGroupStats.groupId, groups.id))
      .where(escopo)
      .groupBy(groups.id, groups.name)
      .orderBy(desc(sum(dailyGroupStats.messages))),

    db
      .select({ id: groups.id, nome: groups.name })
      .from(groups)
      .where(eq(groups.managed, true))
      .orderBy(groups.name),

    db
      .select({
        nome: contacts.pushName,
        telefone: contacts.phone,
        grupo: groups.name,
        mensagens: groupMembers.messageCount,
      })
      .from(groupMembers)
      .innerJoin(contacts, eq(groupMembers.contactId, contacts.id))
      .innerJoin(groups, eq(groupMembers.groupId, groups.id))
      .where(grupoFiltro ? eq(groupMembers.groupId, grupoFiltro) : sql`true`)
      .orderBy(desc(groupMembers.messageCount))
      .limit(20),
  ]);

  const t = totais[0] ?? {
    mensagens: 0,
    ativos: 0,
    entradas: 0,
    saidas: 0,
    capturas: 0,
    moderacoes: 0,
  };
  const crescimento = (t.entradas ?? 0) - (t.saidas ?? 0);

  const serie = preencherDias(porDia, janela);
  const ranking: Point[] = porGrupo
    .slice(0, 10)
    .map((g) => ({ label: g.nome || "sem nome", value: g.mensagens ?? 0 }));

  const semDados = (t.mensagens ?? 0) === 0 && porGrupo.length === 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Relatórios</h1>
          <p className="mt-1 text-sm text-muted">
            Últimos {dias} dias{grupoFiltro ? " · um grupo" : " · todos os grupos"}
          </p>
        </div>

        <nav className="flex flex-wrap items-center gap-2">
          {PERIODOS.map((p) => (
            <Link
              key={p}
              href={query({ dias: p, grupo: grupoFiltro })}
              className={
                p === dias
                  ? "rounded-lg bg-surface-2 px-3 py-1.5 text-sm font-medium text-accent"
                  : "rounded-lg px-3 py-1.5 text-sm text-muted hover:text-text"
              }
            >
              {p} dias
            </Link>
          ))}
          {grupoFiltro && (
            <Link
              href={query({ dias, grupo: null })}
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:text-text"
            >
              Limpar grupo
            </Link>
          )}
        </nav>
      </header>

      {semDados ? (
        <Empty
          title="Ainda não há números para mostrar"
          hint="Os relatórios se preenchem conforme as mensagens dos grupos chegam pelo webhook. Confirme que o número está conectado e que os grupos estão marcados como gerenciados."
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
            <Stat label="Mensagens" value={fmt.format(t.mensagens ?? 0)} />
            <Stat label="Membros ativos" value={fmt.format(t.ativos ?? 0)} hint="soma por dia" />
            <Stat label="Entradas" value={fmt.format(t.entradas ?? 0)} tone="accent" />
            <Stat label="Saídas" value={fmt.format(t.saidas ?? 0)} tone="danger" />
            <Stat
              label="Crescimento"
              value={`${crescimento >= 0 ? "+" : ""}${fmt.format(crescimento)}`}
              tone={crescimento >= 0 ? "accent" : "danger"}
              hint="entradas menos saídas"
            />
            <Stat label="Capturas" value={fmt.format(t.capturas ?? 0)} hint="leads no privado" />
          </div>

          <Card title="Mensagens por dia" subtitle="Dias sem registro entram como zero">
            <LineChart data={serie} label="Mensagens por dia" />
          </Card>

          <Card title="Grupos mais ativos" subtitle="Top 10 por volume de mensagens no período">
            <BarChart data={ranking} label="Grupos por mensagens" />
          </Card>

          <Card title="Por grupo" subtitle="Clique no nome para filtrar o período inteiro">
            <Table
              head={[
                "Grupo",
                "Mensagens",
                "Ativos",
                "Entradas",
                "Saídas",
                "Crescimento",
                "Capturas",
                "Moderações",
              ]}
            >
              {porGrupo.map((g) => {
                const delta = (g.entradas ?? 0) - (g.saidas ?? 0);
                return (
                  <tr key={g.id}>
                    <Td>
                      <Link
                        href={query({ dias, grupo: g.id })}
                        className="font-medium hover:text-accent"
                      >
                        {g.nome || "sem nome"}
                      </Link>
                    </Td>
                    <Td className="tabular-nums">{fmt.format(g.mensagens ?? 0)}</Td>
                    <Td className="tabular-nums text-muted">{fmt.format(g.ativos ?? 0)}</Td>
                    <Td className="tabular-nums text-muted">{fmt.format(g.entradas ?? 0)}</Td>
                    <Td className="tabular-nums text-muted">{fmt.format(g.saidas ?? 0)}</Td>
                    <Td
                      className={
                        delta >= 0 ? "tabular-nums text-accent" : "tabular-nums text-danger"
                      }
                    >
                      {delta >= 0 ? "+" : ""}
                      {fmt.format(delta)}
                    </Td>
                    <Td className="tabular-nums">{fmt.format(g.capturas ?? 0)}</Td>
                    <Td className="tabular-nums text-muted">{fmt.format(g.moderacoes ?? 0)}</Td>
                  </tr>
                );
              })}
            </Table>
          </Card>
        </>
      )}

      <Card
        title="Membros mais ativos"
        subtitle="Total acumulado desde que o grupo entrou no gerenciamento, não apenas no período"
      >
        {maisAtivos.length === 0 ? (
          <Empty title="Nenhuma atividade registrada" />
        ) : (
          <Table head={["Contato", "Telefone", "Grupo", "Mensagens"]}>
            {maisAtivos.map((m, i) => (
              <tr key={`${m.telefone}-${m.grupo}-${i}`}>
                <Td className="font-medium">{m.nome ?? "—"}</Td>
                <Td className="font-mono text-xs text-muted">{formatPhone(m.telefone)}</Td>
                <Td className="text-muted">{m.grupo}</Td>
                <Td className="tabular-nums">{fmt.format(m.mensagens)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {listaGrupos.length > 0 && !grupoFiltro && (
        <p className="text-xs text-muted">
          {listaGrupos.length} grupo(s) sob gerenciamento no total.
        </p>
      )}
    </div>
  );
}

function query({ dias, grupo }: { dias: number; grupo: string | null }) {
  const p = new URLSearchParams({ dias: String(dias) });
  if (grupo) p.set("grupo", grupo);
  return `/relatorios?${p.toString()}`;
}

/**
 * Preenche os dias sem registro com zero. Uma série com buracos engana a
 * leitura: o gráfico ligaria segunda direto na quinta como se nada tivesse
 * acontecido no meio.
 */
function preencherDias(
  linhas: Array<{ dia: string; mensagens: number | null }>,
  janela: string[],
): Point[] {
  const mapa = new Map(linhas.map((l) => [l.dia, l.mensagens ?? 0]));

  return janela.map((iso) => {
    const [, mes, dia] = iso.split("-");
    return { label: `${dia}/${mes}`, value: mapa.get(iso) ?? 0 };
  });
}
