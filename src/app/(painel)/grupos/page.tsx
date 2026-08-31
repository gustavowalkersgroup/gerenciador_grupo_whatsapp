import Link from "next/link";
import { and, asc, desc, eq, ilike, inArray, type SQL } from "drizzle-orm";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { groupTags, groups, instances, tags } from "@/lib/db/schema";
import { Alert, Badge, Card, Empty, Table, Td } from "@/components/ui";
import { BotaoSincronizar, FiltrosGrupos, ToggleGerenciado } from "./filtros";

export const dynamic = "force-dynamic";

const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function GruposPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();

  const sp = await searchParams;
  const busca = (primeiro(sp.q) ?? "").trim();
  const somenteGerenciados = primeiro(sp.gerenciados) === "1";

  const listaInstancias = await db
    .select({ id: instances.id, label: instances.label, evolutionName: instances.evolutionName })
    .from(instances)
    .orderBy(asc(instances.createdAt));

  if (listaInstancias.length === 0) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-xl font-semibold">Grupos</h1>
        </header>
        <Alert tone="warn" title="Nenhum número cadastrado">
          Conecte um número em{" "}
          <Link href="/instancias" className="underline">
            Números
          </Link>{" "}
          antes de sincronizar os grupos.
        </Alert>
      </div>
    );
  }

  const pedida = primeiro(sp.instancia);
  const instancia = listaInstancias.find((i) => i.id === pedida) ?? listaInstancias[0];

  const filtros: SQL[] = [eq(groups.instanceId, instancia.id)];
  if (busca) filtros.push(ilike(groups.name, `%${busca}%`));
  if (somenteGerenciados) filtros.push(eq(groups.managed, true));

  const lista = await db
    .select()
    .from(groups)
    .where(and(...filtros))
    .orderBy(desc(groups.participantsCount), asc(groups.name));

  const etiquetas = lista.length
    ? await db
        .select({ groupId: groupTags.groupId, nome: tags.name, cor: tags.color })
        .from(groupTags)
        .innerJoin(tags, eq(groupTags.tagId, tags.id))
        .where(
          inArray(
            groupTags.groupId,
            lista.map((g) => g.id),
          ),
        )
    : [];

  const porGrupo = new Map<string, { nome: string; cor: string }[]>();
  for (const e of etiquetas) {
    const atual = porGrupo.get(e.groupId) ?? [];
    atual.push({ nome: e.nome, cor: e.cor });
    porGrupo.set(e.groupId, atual);
  }

  const gerenciadosSemAdmin = lista.filter((g) => g.managed && !g.botIsAdmin).length;
  const ultimoSync = lista.reduce<Date | null>(
    (maior, g) => (g.lastSyncedAt && (!maior || g.lastSyncedAt > maior) ? g.lastSyncedAt : maior),
    null,
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Grupos</h1>
          <p className="mt-1 text-sm text-muted">
            {instancia.label} ·{" "}
            {ultimoSync
              ? `sincronizado em ${ultimoSync.toLocaleString("pt-BR")}`
              : "nunca sincronizado"}
          </p>
        </div>
        <BotaoSincronizar instanceId={instancia.id} />
      </header>

      {gerenciadosSemAdmin > 0 && (
        <Alert tone="warn" title="Moderação parada em alguns grupos">
          {gerenciadosSemAdmin} grupo(s) gerenciado(s) estão sem o número como admin. Sem admin o
          sistema não apaga mensagem nem remove ninguém — promova o número dentro do WhatsApp e
          sincronize de novo.
        </Alert>
      )}

      <Card>
        <FiltrosGrupos
          instancias={listaInstancias}
          instanciaId={instancia.id}
          busca={busca}
          somenteGerenciados={somenteGerenciados}
        />
      </Card>

      <Card
        title={`${lista.length} grupo(s)`}
        subtitle="Gerenciado define quem entra na moderação, nas boas-vindas e nos disparos."
      >
        {lista.length === 0 ? (
          <Empty
            title="Nenhum grupo por aqui"
            hint={
              busca || somenteGerenciados
                ? "Nenhum grupo bate com o filtro atual."
                : "Clique em Sincronizar grupos para trazer os grupos desse número."
            }
          />
        ) : (
          <Table head={["Grupo", "Membros", "Bot é admin?", "Gerenciado", "Etiquetas", ""]}>
            {lista.map((g) => (
              <tr key={g.id}>
                <Td>
                  <Link href={`/grupos/${g.id}`} className="font-medium hover:text-accent">
                    {g.name || "(sem nome)"}
                  </Link>
                  <p className="mt-0.5 font-mono text-xs text-muted">{g.jid}</p>
                </Td>
                <Td className="tabular-nums">{g.participantsCount}</Td>
                <Td>
                  {g.botIsAdmin ? (
                    <Badge tone="accent">Admin</Badge>
                  ) : (
                    <Badge tone="danger">Sem admin — não modera</Badge>
                  )}
                </Td>
                <Td>
                  <ToggleGerenciado groupId={g.id} gerenciado={g.managed} nome={g.name} />
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {(porGrupo.get(g.id) ?? []).map((t) => (
                      <span
                        key={t.nome}
                        className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-xs text-muted"
                      >
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: t.cor }}
                          aria-hidden
                        />
                        {t.nome}
                      </span>
                    ))}
                    {(porGrupo.get(g.id) ?? []).length === 0 && (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </div>
                </Td>
                <Td>
                  <Link href={`/grupos/${g.id}`} className="text-xs text-accent hover:underline">
                    Abrir
                  </Link>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
