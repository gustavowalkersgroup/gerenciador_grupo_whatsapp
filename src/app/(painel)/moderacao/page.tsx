import Link from "next/link";
import { and, asc, count, desc, eq, gte } from "drizzle-orm";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import {
  contacts,
  groups,
  instances,
  moderationEvents,
  moderationRules,
} from "@/lib/db/schema";
import { formatPhone } from "@/lib/domain/jid";
import type { ModerationAction, ModerationKind, RuleConfig } from "@/lib/domain/moderation";
import { Alert, Badge, Card, Empty, Stat, Table, Td } from "@/components/ui";
import {
  AcoesRegra,
  BotaoVerificarAdmin,
  FormRegra,
  type GrupoOpcao,
  type RegraInicial,
} from "./regra-form";

export const dynamic = "force-dynamic";

const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const ultimas24h = () => new Date(Date.now() - 24 * 60 * 60 * 1000);

const KIND_LABEL: Record<ModerationKind, string> = {
  anti_link: "Anti-link",
  banned_words: "Palavras proibidas",
  anti_flood: "Anti-flood",
  anti_media: "Anti-mídia",
  only_admins: "Somente admins",
};

const ACTION_LABEL: Record<ModerationAction, string> = {
  warn: "Avisar",
  delete: "Apagar",
  delete_and_warn: "Apagar e avisar",
  remove: "Remover do grupo",
};

const ACTION_TONE: Record<ModerationAction, "neutral" | "info" | "warn" | "danger"> = {
  warn: "info",
  delete: "warn",
  delete_and_warn: "warn",
  remove: "danger",
};

const MIDIA_LABEL: Record<string, string> = {
  imageMessage: "imagem",
  videoMessage: "vídeo",
  audioMessage: "áudio",
  documentMessage: "documento",
  stickerMessage: "figurinha",
};

/** Resumo de uma linha pra operador entender a regra sem abrir o formulário. */
function resumoConfig(kind: ModerationKind, cfg: RuleConfig): string {
  switch (kind) {
    case "anti_link": {
      if (cfg.onlyWhatsAppInvites) return "Só convite de outro grupo";
      const n = cfg.allowDomains?.length ?? 0;
      return n === 0 ? "Nenhum domínio liberado" : `Liberados: ${cfg.allowDomains?.join(", ")}`;
    }
    case "banned_words": {
      const palavras = cfg.words ?? [];
      if (palavras.length === 0) return "Nenhuma palavra cadastrada";
      const amostra = palavras.slice(0, 4).join(", ");
      return palavras.length > 4
        ? `${palavras.length} palavras: ${amostra}…`
        : `${palavras.length} palavra(s): ${amostra}`;
    }
    case "anti_flood":
      return `Mais de ${cfg.maxMessages ?? 5} msgs em ${cfg.windowSeconds ?? 10}s`;
    case "anti_media": {
      const tipos = cfg.blockedTypes ?? [];
      if (tipos.length === 0) return "Toda mídia bloqueada";
      return `Bloqueia: ${tipos.map((t) => MIDIA_LABEL[t] ?? t).join(", ")}`;
    }
    case "only_admins":
      return cfg.quietFrom && cfg.quietTo
        ? `Fechado das ${cfg.quietFrom} às ${cfg.quietTo}`
        : "Fechado o tempo todo";
  }
}

function paraFormulario(row: {
  id: string;
  kind: ModerationKind;
  action: ModerationAction;
  removeAtStrikes: number;
  exemptAdmins: boolean;
  enabled: boolean;
  warnTemplate: string | null;
  groupId: string | null;
  config: RuleConfig;
}): RegraInicial {
  return {
    id: row.id,
    kind: row.kind,
    action: row.action,
    removeAtStrikes: row.removeAtStrikes,
    exemptAdmins: row.exemptAdmins,
    enabled: row.enabled,
    warnTemplate: row.warnTemplate ?? "",
    groupId: row.groupId ?? "",
    allowDomains: (row.config.allowDomains ?? []).join("\n"),
    onlyWhatsAppInvites: row.config.onlyWhatsAppInvites ?? false,
    words: (row.config.words ?? []).join("\n"),
    maxMessages: row.config.maxMessages ?? 5,
    windowSeconds: row.config.windowSeconds ?? 10,
    blockedTypes: row.config.blockedTypes ?? [],
    quietFrom: row.config.quietFrom ?? "",
    quietTo: row.config.quietTo ?? "",
  };
}

export default async function ModeracaoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();

  const sp = await searchParams;

  const listaInstancias = await db
    .select({ id: instances.id, label: instances.label })
    .from(instances)
    .orderBy(asc(instances.createdAt));

  if (listaInstancias.length === 0) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-xl font-semibold">Moderação</h1>
        </header>
        <Alert tone="warn" title="Nenhum número cadastrado">
          Conecte um número em{" "}
          <Link href="/instancias" className="underline">
            Números
          </Link>{" "}
          antes de criar regras de moderação.
        </Alert>
      </div>
    );
  }

  const pedida = primeiro(sp.instancia);
  const instancia = listaInstancias.find((i) => i.id === pedida) ?? listaInstancias[0];
  const desde = ultimas24h();

  const [listaGrupos, linhasRegras, eventos, [eventos24h]] = await Promise.all([
    db
      .select({
        id: groups.id,
        nome: groups.name,
        gerenciado: groups.managed,
        botIsAdmin: groups.botIsAdmin,
      })
      .from(groups)
      .where(eq(groups.instanceId, instancia.id))
      .orderBy(asc(groups.name)),
    db
      .select({
        id: moderationRules.id,
        kind: moderationRules.kind,
        action: moderationRules.action,
        removeAtStrikes: moderationRules.removeAtStrikes,
        config: moderationRules.config,
        warnTemplate: moderationRules.warnTemplate,
        exemptAdmins: moderationRules.exemptAdmins,
        enabled: moderationRules.enabled,
        groupId: moderationRules.groupId,
        grupoNome: groups.name,
      })
      .from(moderationRules)
      .leftJoin(groups, eq(moderationRules.groupId, groups.id))
      .where(eq(moderationRules.instanceId, instancia.id))
      .orderBy(asc(moderationRules.kind), desc(moderationRules.createdAt)),
    db
      .select({
        id: moderationEvents.id,
        createdAt: moderationEvents.createdAt,
        kind: moderationEvents.kind,
        action: moderationEvents.action,
        strikesAfter: moderationEvents.strikesAfter,
        trecho: moderationEvents.excerpt,
        grupo: groups.name,
        contato: contacts.pushName,
        telefone: contacts.phone,
      })
      .from(moderationEvents)
      .innerJoin(groups, eq(moderationEvents.groupId, groups.id))
      .leftJoin(contacts, eq(moderationEvents.contactId, contacts.id))
      .where(eq(groups.instanceId, instancia.id))
      .orderBy(desc(moderationEvents.createdAt))
      .limit(50),
    db
      .select({ n: count() })
      .from(moderationEvents)
      .innerJoin(groups, eq(moderationEvents.groupId, groups.id))
      .where(and(eq(groups.instanceId, instancia.id), gte(moderationEvents.createdAt, desde))),
  ]);

  const regras = linhasRegras.map((r) => ({ ...r, config: (r.config ?? {}) as RuleConfig }));
  const globais = regras.filter((r) => !r.groupId);
  const deGrupo = regras.filter((r) => r.groupId);

  // Só regra ativa entra no motor — a desativada não sobrescreve a global.
  const sobrescritasPorTipo = new Map<ModerationKind, number>();
  for (const r of deGrupo) {
    if (!r.enabled) continue;
    sobrescritasPorTipo.set(r.kind, (sobrescritasPorTipo.get(r.kind) ?? 0) + 1);
  }
  const tiposGlobais = new Set(globais.filter((r) => r.enabled).map((r) => r.kind));

  const porGrupo = new Map<string, { nome: string; regras: typeof deGrupo }>();
  for (const r of deGrupo) {
    const chave = r.groupId ?? "";
    const atual = porGrupo.get(chave) ?? { nome: r.grupoNome ?? "(grupo removido)", regras: [] };
    atual.regras.push(r);
    porGrupo.set(chave, atual);
  }

  const regraPedida = primeiro(sp.regra);
  const regraEditada = regraPedida ? (regras.find((r) => r.id === regraPedida) ?? null) : null;

  const opcoesGrupo: GrupoOpcao[] = listaGrupos.map((g) => ({
    id: g.id,
    nome: g.nome,
    gerenciado: g.gerenciado,
  }));

  const semAdmin = listaGrupos.filter((g) => g.gerenciado && !g.botIsAdmin);
  const ativas = regras.filter((r) => r.enabled).length;

  const linkInstancia = (id: string) => `/moderacao?instancia=${id}`;
  const linkEdicao = (ruleId: string) => `/moderacao?instancia=${instancia.id}&regra=${ruleId}#regra`;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Moderação</h1>
          <p className="mt-1 text-sm text-muted">
            Regras aplicadas às mensagens dos grupos gerenciados de {instancia.label}.
          </p>
        </div>
        {listaInstancias.length > 1 && (
          <nav className="flex flex-wrap gap-1">
            {listaInstancias.map((i) => (
              <Link
                key={i.id}
                href={linkInstancia(i.id)}
                className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                  i.id === instancia.id
                    ? "border-accent/40 bg-accent/10 text-accent"
                    : "border-border bg-surface-2 text-muted hover:text-text"
                }`}
              >
                {i.label}
              </Link>
            ))}
          </nav>
        )}
      </header>

      <Alert tone="warn" title="Sem admin, só o aviso sai">
        Apagar mensagem e remover membro exigem que o número seja administrador do grupo. Sem essa
        permissão o motor registra o evento e envia só o aviso — a mensagem continua no grupo e
        ninguém é removido.
      </Alert>

      {semAdmin.length > 0 && (
        <Card
          title={`${semAdmin.length} grupo(s) gerenciado(s) sem admin`}
          subtitle="Promova o número no WhatsApp e reconfira aqui."
        >
          <div className="space-y-2">
            {semAdmin.slice(0, 8).map((g) => (
              <BotaoVerificarAdmin key={g.id} groupId={g.id} nome={g.nome} />
            ))}
            {semAdmin.length > 8 && (
              <p className="text-xs text-muted">e mais {semAdmin.length - 8} grupo(s).</p>
            )}
          </div>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Regras ativas" value={ativas} hint={`${regras.length} cadastradas`} tone="accent" />
        <Stat label="Globais" value={globais.length} hint="valem em todo grupo gerenciado" />
        <Stat label="Por grupo" value={deGrupo.length} hint="sobrescrevem a global" />
        <Stat label="Ações em 24h" value={eventos24h?.n ?? 0} hint="eventos de moderação" tone="warn" />
      </div>

      <Card
        title="Regras globais da instância"
        subtitle="Valem em todos os grupos gerenciados, exceto onde houver regra específica do mesmo tipo."
      >
        {globais.length === 0 ? (
          <Empty
            title="Nenhuma regra global"
            hint="Comece por uma: anti-link global costuma ser a primeira."
          />
        ) : (
          <Table
            head={["Tipo", "Configuração", "Ação", "Strikes", "Admins", "Status", "Ações"]}
          >
            {globais.map((r) => {
              const sobrescritas = sobrescritasPorTipo.get(r.kind) ?? 0;
              return (
                <tr key={r.id}>
                  <Td className="font-medium">
                    <div className="flex flex-wrap items-center gap-2">
                      {KIND_LABEL[r.kind]}
                      {sobrescritas > 0 && (
                        <Badge tone="info">sobrescrita em {sobrescritas} grupo(s)</Badge>
                      )}
                    </div>
                  </Td>
                  <Td className="text-muted">{resumoConfig(r.kind, r.config)}</Td>
                  <Td>
                    <Badge tone={ACTION_TONE[r.action]}>{ACTION_LABEL[r.action]}</Badge>
                  </Td>
                  <Td className="tabular-nums text-muted">
                    {r.removeAtStrikes === 0 ? "nunca" : r.removeAtStrikes}
                  </Td>
                  <Td className="text-muted">{r.exemptAdmins ? "isentos" : "moderados"}</Td>
                  <Td>
                    {r.enabled ? (
                      <Badge tone="accent">ativa</Badge>
                    ) : (
                      <Badge tone="neutral">desativada</Badge>
                    )}
                  </Td>
                  <Td>
                    <AcoesRegra
                      ruleId={r.id}
                      ativa={r.enabled}
                      descricao={`global de ${KIND_LABEL[r.kind]}`}
                      editarHref={linkEdicao(r.id)}
                    />
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      <Card
        title="Regras por grupo"
        subtitle="Uma regra de grupo substitui por completo a global do mesmo tipo naquele grupo — as duas não se somam."
      >
        {porGrupo.size === 0 ? (
          <Empty
            title="Nenhuma regra específica de grupo"
            hint="Use quando um grupo precisa de tratamento diferente do padrão da instância."
          />
        ) : (
          <div className="space-y-6">
            {[...porGrupo.entries()].map(([chave, bloco]) => (
              <div key={chave} className="space-y-2">
                <h3 className="text-sm font-medium">{bloco.nome || "(sem nome)"}</h3>
                <Table
                  head={["Tipo", "Configuração", "Ação", "Strikes", "Admins", "Status", "Ações"]}
                >
                  {bloco.regras.map((r) => (
                    <tr key={r.id}>
                      <Td className="font-medium">
                        <div className="flex flex-wrap items-center gap-2">
                          {KIND_LABEL[r.kind]}
                          {tiposGlobais.has(r.kind) &&
                            (r.enabled ? (
                              <Badge tone="info">sobrescreve a global</Badge>
                            ) : (
                              <Badge tone="neutral">desativada: a global volta a valer</Badge>
                            ))}
                        </div>
                      </Td>
                      <Td className="text-muted">{resumoConfig(r.kind, r.config)}</Td>
                      <Td>
                        <Badge tone={ACTION_TONE[r.action]}>{ACTION_LABEL[r.action]}</Badge>
                      </Td>
                      <Td className="tabular-nums text-muted">
                        {r.removeAtStrikes === 0 ? "nunca" : r.removeAtStrikes}
                      </Td>
                      <Td className="text-muted">{r.exemptAdmins ? "isentos" : "moderados"}</Td>
                      <Td>
                        {r.enabled ? (
                          <Badge tone="accent">ativa</Badge>
                        ) : (
                          <Badge tone="neutral">desativada</Badge>
                        )}
                      </Td>
                      <Td>
                        <AcoesRegra
                          ruleId={r.id}
                          ativa={r.enabled}
                          descricao={`${KIND_LABEL[r.kind]} de ${bloco.nome}`}
                          editarHref={linkEdicao(r.id)}
                        />
                      </Td>
                    </tr>
                  ))}
                </Table>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div id="regra" className="scroll-mt-6">
        <Card
          title={regraEditada ? "Editar regra" : "Nova regra"}
          subtitle={
            regraEditada
              ? `${KIND_LABEL[regraEditada.kind]} — ${regraEditada.grupoNome ?? "instância inteira"}`
              : "Escolha o tipo: os campos abaixo mudam conforme a regra."
          }
        >
          <FormRegra
            key={regraEditada?.id ?? "nova"}
            instanceId={instancia.id}
            grupos={opcoesGrupo}
            inicial={regraEditada ? paraFormulario(regraEditada) : null}
          />
        </Card>
      </div>

      <Card
        title="Últimos eventos"
        subtitle="As 50 ações mais recentes aplicadas nos grupos deste número."
      >
        {eventos.length === 0 ? (
          <Empty
            title="Nenhuma moderação registrada"
            hint="Os eventos aparecem aqui assim que o webhook receber uma mensagem que viole alguma regra."
          />
        ) : (
          <Table head={["Quando", "Grupo", "Contato", "Tipo", "Ação", "Strikes", "Trecho"]}>
            {eventos.map((e) => (
              <tr key={e.id}>
                <Td className="whitespace-nowrap text-muted">
                  {e.createdAt.toLocaleString("pt-BR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </Td>
                <Td className="text-muted">{e.grupo || "—"}</Td>
                <Td>
                  <span className="font-medium">{e.contato ?? "—"}</span>
                  <span className="ml-2 whitespace-nowrap font-mono text-xs text-muted">
                    {formatPhone(e.telefone)}
                  </span>
                </Td>
                <Td>{KIND_LABEL[e.kind]}</Td>
                <Td>
                  <Badge tone={ACTION_TONE[e.action]}>{ACTION_LABEL[e.action]}</Badge>
                </Td>
                <Td className="tabular-nums text-muted">{e.strikesAfter}</Td>
                <Td className="text-muted">
                  <span className="block max-w-xs truncate" title={e.trecho ?? ""}>
                    {e.trecho ?? "—"}
                  </span>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
