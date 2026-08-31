import Link from "next/link";
import { and, count, desc, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  contacts,
  groups,
  instances,
  keywordHits,
  keywordTriggers,
  moderationEvents,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/guard";
import { hoursAgo } from "@/lib/domain/day";
import { Alert, Badge, Card, Empty, Stat, Table, Td } from "@/components/ui";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; tone: "accent" | "warn" | "danger" | "neutral" }> = {
  connected: { label: "Conectado", tone: "accent" },
  connecting: { label: "Conectando", tone: "warn" },
  disconnected: { label: "Desconectado", tone: "danger" },
  banned: { label: "Banido", tone: "danger" },
};

export default async function VisaoGeralPage() {
  await requireUser();

  const since = hoursAgo(24);

  const [instanceRows, [groupCount], [managedCount], [dmToday], [modToday], [optOuts], recentHits] =
    await Promise.all([
      db.select().from(instances).orderBy(desc(instances.createdAt)),
      db.select({ n: count() }).from(groups),
      db.select({ n: count() }).from(groups).where(eq(groups.managed, true)),
      db
        .select({ n: count() })
        .from(keywordHits)
        .where(and(eq(keywordHits.status, "sent"), gte(keywordHits.createdAt, since))),
      db
        .select({ n: count() })
        .from(moderationEvents)
        .where(gte(moderationEvents.createdAt, since)),
      db.select({ n: count() }).from(contacts).where(eq(contacts.optOut, true)),
      db
        .select({
          id: keywordHits.id,
          createdAt: keywordHits.createdAt,
          matchedTerm: keywordHits.matchedTerm,
          excerpt: keywordHits.excerpt,
          status: keywordHits.status,
          reason: keywordHits.reason,
          trigger: keywordTriggers.name,
          contact: contacts.pushName,
          phone: contacts.phone,
          group: groups.name,
        })
        .from(keywordHits)
        .innerJoin(keywordTriggers, eq(keywordHits.triggerId, keywordTriggers.id))
        .innerJoin(contacts, eq(keywordHits.contactId, contacts.id))
        .leftJoin(groups, eq(keywordHits.groupId, groups.id))
        .orderBy(desc(keywordHits.createdAt))
        .limit(10),
    ]);

  const connected = instanceRows.filter((i) => i.status === "connected").length;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Visão geral</h1>
        <p className="mt-1 text-sm text-muted">Últimas 24 horas</p>
      </header>

      {instanceRows.length === 0 && (
        <Alert tone="warn" title="Nenhum número conectado">
          Cadastre e conecte um número em{" "}
          <Link href="/instancias" className="underline">
            Números
          </Link>{" "}
          para o sistema começar a receber eventos dos grupos.
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat
          label="Números"
          value={`${connected}/${instanceRows.length}`}
          hint="conectados"
          tone={connected > 0 ? "accent" : "danger"}
        />
        <Stat label="Grupos" value={managedCount?.n ?? 0} hint={`${groupCount?.n ?? 0} conhecidos`} />
        <Stat label="Leads no PV" value={dmToday?.n ?? 0} hint="DMs por palavra-chave" tone="accent" />
        <Stat label="Moderações" value={modToday?.n ?? 0} hint="ações aplicadas" tone="warn" />
        <Stat label="Opt-outs" value={optOuts?.n ?? 0} hint="não recebem DM" />
      </div>

      <Card title="Números" subtitle="Estado da conexão com o WhatsApp">
        {instanceRows.length === 0 ? (
          <Empty title="Nenhum número cadastrado" hint="Comece pela aba Números." />
        ) : (
          <Table head={["Rótulo", "Instância", "Status", "Visto por último"]}>
            {instanceRows.map((i) => {
              const s = STATUS[i.status] ?? STATUS.disconnected;
              return (
                <tr key={i.id}>
                  <Td className="font-medium">{i.label}</Td>
                  <Td className="font-mono text-xs text-muted">{i.evolutionName}</Td>
                  <Td>
                    <Badge tone={s.tone}>{s.label}</Badge>
                  </Td>
                  <Td className="text-muted">
                    {i.lastSeenAt ? i.lastSeenAt.toLocaleString("pt-BR") : "—"}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      <Card
        title="Últimas capturas por palavra-chave"
        subtitle="Quem falou a palavra e se o privado foi enviado"
      >
        {recentHits.length === 0 ? (
          <Empty
            title="Nenhuma captura ainda"
            hint="Crie um gatilho em Palavras-chave — ex.: 'sapato' + '44' manda mensagem no PV."
          />
        ) : (
          <Table head={["Quando", "Contato", "Grupo", "Gatilho", "Termo", "Resultado"]}>
            {recentHits.map((h) => (
              <tr key={h.id}>
                <Td className="whitespace-nowrap text-muted">
                  {h.createdAt.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                </Td>
                <Td>
                  <span className="font-medium">{h.contact ?? "—"}</span>
                  <span className="ml-2 font-mono text-xs text-muted">{h.phone ?? ""}</span>
                </Td>
                <Td className="text-muted">{h.group ?? "—"}</Td>
                <Td>{h.trigger}</Td>
                <Td>
                  <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">{h.matchedTerm}</code>
                </Td>
                <Td>
                  {h.status === "sent" ? (
                    <Badge tone="accent">enviado</Badge>
                  ) : (
                    <Badge tone={h.status === "failed" ? "danger" : "warn"}>
                      {h.reason ?? h.status}
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
