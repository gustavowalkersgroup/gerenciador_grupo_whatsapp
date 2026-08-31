import Link from "next/link";
import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { contactTags, contacts, tags } from "@/lib/db/schema";
import { formatPhone } from "@/lib/domain/jid";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Empty,
  Field,
  Input,
  Select,
  Stat,
  Table,
  Td,
} from "@/components/ui";
import {
  alternarOptOut,
  aplicarEtiqueta,
  criarEtiqueta,
  excluirEtiqueta,
  removerEtiqueta,
} from "./actions";

export const dynamic = "force-dynamic";

const POR_PAGINA = 50;

const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ContatosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();

  const sp = await searchParams;
  const busca = (primeiro(sp.q) ?? "").trim();
  const somenteOptOut = primeiro(sp.optout) === "1";
  const erro = primeiro(sp.erro);
  const aviso = primeiro(sp.ok);
  const paginaPedida = Math.max(1, Math.trunc(Number(primeiro(sp.pagina) ?? 1)) || 1);

  const listaEtiquetas = await db
    .select({
      id: tags.id,
      nome: tags.name,
      cor: tags.color,
      // Subconsulta escrita à mão: dentro da lista de seleção o drizzle imprime
      // a coluna sem o nome da tabela, e aí "id" cairia na tabela de dentro.
      contatos: sql<number>`(select count(*) from contact_tags ct where ct.tag_id = tags.id)`.mapWith(
        Number,
      ),
      grupos: sql<number>`(select count(*) from group_tags gt where gt.tag_id = tags.id)`.mapWith(
        Number,
      ),
      gatilhos:
        sql<number>`(select count(*) from keyword_triggers kt where kt.apply_tag_id = tags.id)`.mapWith(
          Number,
        ),
    })
    .from(tags)
    .orderBy(asc(tags.name));

  // O id vem da URL: se não for uma etiqueta conhecida o filtro é ignorado —
  // um uuid inventado quebraria a comparação no Postgres.
  const etiquetaPedida = (primeiro(sp.etiqueta) ?? "").trim();
  const etiquetaId = listaEtiquetas.some((t) => t.id === etiquetaPedida) ? etiquetaPedida : "";

  const filtros: SQL[] = [];
  if (busca) {
    const digitos = busca.replace(/\D/g, "");
    const alternativas: SQL[] = [ilike(contacts.pushName, `%${busca}%`)];
    if (digitos) {
      alternativas.push(ilike(contacts.phone, `%${digitos}%`), ilike(contacts.jid, `%${digitos}%`));
    }
    const combinado = or(...alternativas);
    if (combinado) filtros.push(combinado);
  }
  if (etiquetaId) {
    filtros.push(
      inArray(
        contacts.id,
        db
          .select({ id: contactTags.contactId })
          .from(contactTags)
          .where(eq(contactTags.tagId, etiquetaId)),
      ),
    );
  }
  if (somenteOptOut) filtros.push(eq(contacts.optOut, true));

  const condicao = filtros.length ? and(...filtros) : undefined;

  const [[encontrados], [optOutTotal]] = await Promise.all([
    db.select({ n: count() }).from(contacts).where(condicao),
    db.select({ n: count() }).from(contacts).where(eq(contacts.optOut, true)),
  ]);

  const total = encontrados?.n ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const pagina = Math.min(paginaPedida, totalPaginas);

  const lista = await db
    .select({
      id: contacts.id,
      nome: contacts.pushName,
      phone: contacts.phone,
      jid: contacts.jid,
      optOut: contacts.optOut,
      optOutAt: contacts.optOutAt,
      lastDmAt: contacts.lastDmAt,
      grupos:
        sql<number>`(select count(*) from group_members gm where gm.contact_id = contacts.id and gm.left_at is null)`.mapWith(
          Number,
        ),
      capturas:
        sql<number>`(select count(*) from keyword_hits kh where kh.contact_id = contacts.id and kh.status = 'sent')`.mapWith(
          Number,
        ),
    })
    .from(contacts)
    .where(condicao)
    // Quem recebeu DM mais recente primeiro; quem nunca recebeu vai pro fim.
    .orderBy(sql`${contacts.lastDmAt} desc nulls last`, desc(contacts.createdAt))
    .limit(POR_PAGINA)
    .offset((pagina - 1) * POR_PAGINA);

  const vinculos = lista.length
    ? await db
        .select({
          contactId: contactTags.contactId,
          tagId: tags.id,
          nome: tags.name,
          cor: tags.color,
        })
        .from(contactTags)
        .innerJoin(tags, eq(contactTags.tagId, tags.id))
        .where(
          inArray(
            contactTags.contactId,
            lista.map((c) => c.id),
          ),
        )
        .orderBy(asc(tags.name))
    : [];

  const porContato = new Map<string, { tagId: string; nome: string; cor: string }[]>();
  for (const v of vinculos) {
    const atual = porContato.get(v.contactId) ?? [];
    atual.push({ tagId: v.tagId, nome: v.nome, cor: v.cor });
    porContato.set(v.contactId, atual);
  }

  const filtrosAtuais = new URLSearchParams();
  if (busca) filtrosAtuais.set("q", busca);
  if (etiquetaId) filtrosAtuais.set("etiqueta", etiquetaId);
  if (somenteOptOut) filtrosAtuais.set("optout", "1");

  const linkPagina = (n: number) => {
    const p = new URLSearchParams(filtrosAtuais);
    if (n > 1) p.set("pagina", String(n));
    const query = p.toString();
    return query ? `/contatos?${query}` : "/contatos";
  };

  // Vai escondido em cada formulário para a ação devolver o operador ao mesmo
  // filtro e à mesma página em que ele estava.
  const voltar = linkPagina(pagina).split("?")[1] ?? "";

  const exportar = filtrosAtuais.toString()
    ? `/api/contatos/exportar?${filtrosAtuais.toString()}`
    : "/api/contatos/exportar";

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Contatos</h1>
          <p className="mt-1 text-sm text-muted">
            Todo mundo que o sistema já viu nos grupos — é daqui que sai a lista de leads das
            palavras-chave.
          </p>
        </div>
        <a
          href={exportar}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm font-medium text-text transition hover:border-muted"
        >
          Exportar CSV
        </a>
      </header>

      <Alert tone="warn" title="LGPD">
        O opt-out é permanente: marcado, o contato não recebe mais nenhum DM automático — nem
        captura por palavra-chave, nem boas-vindas no privado, nem disparo. A exportação leva nome e
        telefone de pessoas reais, então trate o arquivo como dado pessoal: não repasse e apague
        quando não precisar mais.
      </Alert>

      {erro && <Alert tone="danger">{erro}</Alert>}
      {aviso && <Alert tone="accent">{aviso}</Alert>}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Contatos no filtro" value={total} hint={`${totalPaginas} página(s)`} />
        <Stat
          label="Opt-outs"
          value={optOutTotal?.n ?? 0}
          hint="bloqueados para qualquer DM"
          tone={(optOutTotal?.n ?? 0) > 0 ? "warn" : "default"}
        />
        <Stat label="Etiquetas" value={listaEtiquetas.length} hint="usadas por gatilhos e disparos" />
      </div>

      <Card>
        <form method="get" action="/contatos" className="flex flex-wrap items-end gap-3">
          <Field label="Buscar" className="w-64">
            <Input name="q" defaultValue={busca} placeholder="Nome ou telefone" />
          </Field>

          <Field label="Etiqueta" className="w-56">
            <Select name="etiqueta" defaultValue={etiquetaId}>
              <option value="">Todas</option>
              {listaEtiquetas.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                </option>
              ))}
            </Select>
          </Field>

          <div className="flex items-center gap-3 pb-2">
            <Checkbox
              label="Somente opt-out"
              name="optout"
              value="1"
              defaultChecked={somenteOptOut}
            />
            <Button type="submit" variant="secondary">
              Filtrar
            </Button>
            {(busca || etiquetaId || somenteOptOut) && (
              <Link href="/contatos" className="text-xs text-muted underline hover:text-text">
                Limpar
              </Link>
            )}
          </div>
        </form>
      </Card>

      <Card
        title="Etiquetas"
        subtitle="Os gatilhos de palavra-chave etiquetam o contato automaticamente; aqui você cria e limpa a lista."
      >
        <form action={criarEtiqueta} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="voltar" value={voltar} />
          <Field label="Nova etiqueta" className="w-64">
            <Input name="nome" maxLength={60} placeholder="ex.: sapato-44" />
          </Field>
          <Field label="Cor" className="w-24">
            <Input name="cor" type="color" defaultValue="#25d366" className="h-10 p-1" />
          </Field>
          <div className="pb-2">
            <Button type="submit">Criar etiqueta</Button>
          </div>
        </form>

        <div className="mt-5">
          {listaEtiquetas.length === 0 ? (
            <Empty
              title="Nenhuma etiqueta ainda"
              hint="Crie uma acima ou deixe um gatilho de palavra-chave criar na primeira captura."
            />
          ) : (
            <Table head={["Etiqueta", "Contatos", "Grupos", "Gatilhos", ""]}>
              {listaEtiquetas.map((t) => (
                <tr key={t.id}>
                  <Td>
                    <Badge>
                      <span
                        className="size-2 rounded-full"
                        style={{ backgroundColor: t.cor }}
                        aria-hidden
                      />
                      {t.nome}
                    </Badge>
                  </Td>
                  <Td className="tabular-nums">{t.contatos}</Td>
                  <Td className="tabular-nums">{t.grupos}</Td>
                  <Td className="tabular-nums">
                    {t.gatilhos > 0 ? (
                      <Badge tone="info">{t.gatilhos} em uso</Badge>
                    ) : (
                      <span className="text-muted">0</span>
                    )}
                  </Td>
                  <Td>
                    <form action={excluirEtiqueta} className="flex items-center gap-2">
                      <input type="hidden" name="voltar" value={voltar} />
                      <input type="hidden" name="tagId" value={t.id} />
                      <Checkbox label="confirmar" name="confirmar" />
                      <Button type="submit" variant="danger" className="px-2 py-1 text-xs">
                        Excluir
                      </Button>
                    </form>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      </Card>

      <Card
        title={`${total} contato(s)`}
        subtitle={`Página ${pagina} de ${totalPaginas} · ${POR_PAGINA} por página`}
      >
        {lista.length === 0 ? (
          <Empty
            title="Nenhum contato por aqui"
            hint={
              busca || etiquetaId || somenteOptOut
                ? "Nenhum contato bate com o filtro atual."
                : "Os contatos aparecem sozinhos conforme as pessoas falam nos grupos gerenciados."
            }
          />
        ) : (
          <>
            <Table
              head={["Contato", "Etiquetas", "Grupos", "Capturas", "Último DM", "Opt-out"]}
            >
              {lista.map((c) => {
                const etiquetasDoContato = porContato.get(c.id) ?? [];
                const disponiveis = listaEtiquetas.filter(
                  (t) => !etiquetasDoContato.some((e) => e.tagId === t.id),
                );

                return (
                  <tr key={c.id}>
                    <Td>
                      <span className="font-medium">{c.nome ?? "(sem nome)"}</span>
                      <p className="mt-0.5 font-mono text-xs text-muted">
                        {formatPhone(c.phone ?? c.jid.split("@")[0])}
                      </p>
                    </Td>

                    <Td>
                      <div className="flex flex-wrap items-center gap-1">
                        {etiquetasDoContato.map((e) => (
                          <div key={e.tagId} className="inline-flex items-center">
                            <Badge>
                              <span
                                className="size-2 rounded-full"
                                style={{ backgroundColor: e.cor }}
                                aria-hidden
                              />
                              {e.nome}
                            </Badge>
                            <form action={removerEtiqueta}>
                              <input type="hidden" name="voltar" value={voltar} />
                              <input type="hidden" name="contactId" value={c.id} />
                              <input type="hidden" name="tagId" value={e.tagId} />
                              <button
                                type="submit"
                                title="Remover etiqueta"
                                aria-label={`Remover etiqueta ${e.nome} de ${c.nome ?? "contato"}`}
                                className="px-1 text-xs text-muted transition hover:text-danger"
                              >
                                ×
                              </button>
                            </form>
                          </div>
                        ))}
                        {etiquetasDoContato.length === 0 && (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </div>

                      {disponiveis.length > 0 && (
                        <form action={aplicarEtiqueta} className="mt-2 flex items-center gap-1">
                          <input type="hidden" name="voltar" value={voltar} />
                          <input type="hidden" name="contactId" value={c.id} />
                          <div className="w-36">
                            <Select
                              name="tagId"
                              defaultValue=""
                              className="py-1 text-xs"
                              aria-label={`Etiquetar ${c.nome ?? "contato"}`}
                            >
                              <option value="">Etiquetar…</option>
                              {disponiveis.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.nome}
                                </option>
                              ))}
                            </Select>
                          </div>
                          <Button type="submit" variant="ghost" className="px-2 py-1 text-xs">
                            Aplicar
                          </Button>
                        </form>
                      )}
                    </Td>

                    <Td className="tabular-nums">{c.grupos}</Td>
                    <Td className="tabular-nums">{c.capturas}</Td>
                    <Td className="whitespace-nowrap text-muted">
                      {c.lastDmAt
                        ? c.lastDmAt.toLocaleString("pt-BR", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })
                        : "—"}
                    </Td>

                    <Td>
                      {c.optOut ? (
                        <Badge tone="danger">Opt-out</Badge>
                      ) : (
                        <Badge tone="accent">Recebe DM</Badge>
                      )}
                      {c.optOutAt && (
                        <p className="mt-0.5 text-xs text-muted">
                          {c.optOutAt.toLocaleString("pt-BR", { dateStyle: "short" })}
                        </p>
                      )}
                      <form action={alternarOptOut} className="mt-1">
                        <input type="hidden" name="voltar" value={voltar} />
                        <input type="hidden" name="contactId" value={c.id} />
                        <input type="hidden" name="marcar" value={c.optOut ? "0" : "1"} />
                        <Button
                          type="submit"
                          variant={c.optOut ? "secondary" : "danger"}
                          className="px-2 py-1 text-xs"
                        >
                          {c.optOut ? "Reativar DM" : "Marcar opt-out"}
                        </Button>
                      </form>
                    </Td>
                  </tr>
                );
              })}
            </Table>

            {totalPaginas > 1 && (
              <nav className="mt-4 flex items-center justify-between gap-3 text-sm">
                {pagina > 1 ? (
                  <Link href={linkPagina(pagina - 1)} className="text-accent hover:underline">
                    ← Anterior
                  </Link>
                ) : (
                  <span className="text-muted">← Anterior</span>
                )}
                <span className="text-xs text-muted">
                  Página {pagina} de {totalPaginas}
                </span>
                {pagina < totalPaginas ? (
                  <Link href={linkPagina(pagina + 1)} className="text-accent hover:underline">
                    Próxima →
                  </Link>
                ) : (
                  <span className="text-muted">Próxima →</span>
                )}
              </nav>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
