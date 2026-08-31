import Link from "next/link";
import { notFound } from "next/navigation";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { contacts, groupMembers, groups, instances, welcomeConfigs } from "@/lib/db/schema";
import { formatPhone } from "@/lib/domain/jid";
import { Alert, Badge, Card, Empty, Stat, Table, Td } from "@/components/ui";
import {
  AcoesMembro,
  ConfiguracoesGrupo,
  FormBoasVindas,
  PainelConvite,
  ToggleGerenciado,
} from "../filtros";

export const dynamic = "force-dynamic";

/** Tabela grande trava a página e ninguém rola 3 mil linhas. */
const LIMITE_MEMBROS = 200;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function GrupoDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();

  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const [linha] = await db
    .select({ grupo: groups, instancia: instances })
    .from(groups)
    .innerJoin(instances, eq(groups.instanceId, instances.id))
    .where(eq(groups.id, id))
    .limit(1);
  if (!linha) notFound();

  const { grupo, instancia } = linha;

  const [[welcome], [ativos], membros] = await Promise.all([
    db.select().from(welcomeConfigs).where(eq(welcomeConfigs.groupId, grupo.id)).limit(1),
    db
      .select({ n: count() })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, grupo.id), isNull(groupMembers.leftAt))),
    db
      .select({
        id: groupMembers.id,
        isAdmin: groupMembers.isAdmin,
        strikes: groupMembers.strikes,
        messageCount: groupMembers.messageCount,
        lastMessageAt: groupMembers.lastMessageAt,
        joinedAt: groupMembers.joinedAt,
        nome: contacts.pushName,
        phone: contacts.phone,
        optOut: contacts.optOut,
      })
      .from(groupMembers)
      .innerJoin(contacts, eq(groupMembers.contactId, contacts.id))
      .where(and(eq(groupMembers.groupId, grupo.id), isNull(groupMembers.leftAt)))
      .orderBy(desc(groupMembers.messageCount), desc(groupMembers.lastMessageAt))
      .limit(LIMITE_MEMBROS),
  ]);

  const totalAtivos = ativos?.n ?? 0;
  const escondidos = Math.max(totalAtivos - membros.length, 0);

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <Link href="/grupos" className="text-xs text-muted hover:text-text">
          ← Voltar para grupos
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{grupo.name || "(sem nome)"}</h1>
            <p className="mt-1 font-mono text-xs text-muted">{grupo.jid}</p>
          </div>
          <div className="flex items-center gap-3">
            <ToggleGerenciado groupId={grupo.id} gerenciado={grupo.managed} nome={grupo.name} />
            <span className="text-xs text-muted">Gerenciado</span>
          </div>
        </div>
        {grupo.description && <p className="max-w-2xl text-sm text-muted">{grupo.description}</p>}
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Membros" value={grupo.participantsCount} hint={`${totalAtivos} no banco`} />
        <Stat
          label="Bot é admin?"
          value={grupo.botIsAdmin ? "Sim" : "Não"}
          hint={grupo.botIsAdmin ? "pode moderar" : "sem admin não modera"}
          tone={grupo.botIsAdmin ? "accent" : "danger"}
        />
        <Stat label="Número" value={instancia.label} hint={instancia.evolutionName} />
        <Stat
          label="Última sincronização"
          value={grupo.lastSyncedAt ? grupo.lastSyncedAt.toLocaleString("pt-BR") : "—"}
          hint="atualize pela lista de grupos"
        />
      </div>

      {!grupo.botIsAdmin && (
        <Alert tone="warn" title="O número não é admin deste grupo">
          Sem admin não dá para apagar mensagem, remover membro nem fechar o grupo. Promova o
          número dentro do WhatsApp e sincronize os grupos de novo.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Link de convite" subtitle="Revogar invalida o link antigo na hora.">
          <PainelConvite groupId={grupo.id} inviteCode={grupo.inviteCode} />
        </Card>

        <Card
          title="Configurações do grupo"
          subtitle="Aplicado direto no WhatsApp — precisa do número como admin."
        >
          <ConfiguracoesGrupo groupId={grupo.id} />
        </Card>
      </div>

      <Card
        title="Boas-vindas"
        subtitle="Mensagem enviada quando alguém entra. Variáveis: {{nome}}, {{grupo}}, {{numero}}."
      >
        <FormBoasVindas
          groupId={grupo.id}
          inicial={{
            enabled: welcome?.enabled ?? true,
            template: welcome?.template ?? "",
            sendAsDm: welcome?.sendAsDm ?? false,
            mentionMember: welcome?.mentionMember ?? true,
            delaySeconds: welcome?.delaySeconds ?? 3,
            farewellTemplate: welcome?.farewellTemplate ?? "",
            mediaUrl: welcome?.mediaUrl ?? "",
          }}
        />
      </Card>

      <Card
        title="Membros"
        subtitle={`Ordenados por mensagens. Quem já saiu não aparece.${
          escondidos > 0 ? ` Mostrando ${membros.length} de ${totalAtivos}.` : ""
        }`}
      >
        {escondidos > 0 && (
          <div className="mb-4">
            <Alert tone="info">
              Mais {escondidos} membro(s) não estão na lista — só os {LIMITE_MEMBROS} mais ativos
              são exibidos.
            </Alert>
          </div>
        )}

        {membros.length === 0 ? (
          <Empty
            title="Nenhum membro registrado"
            hint="Os membros aparecem conforme as mensagens chegam pelo webhook."
          />
        ) : (
          <Table
            head={[
              "Membro",
              "Telefone",
              "Admin",
              "Strikes",
              "Mensagens",
              "Última mensagem",
              "Entrou em",
              "Ações",
            ]}
          >
            {membros.map((m) => (
              <tr key={m.id}>
                <Td>
                  <span className="font-medium">{m.nome ?? "—"}</span>
                  {m.optOut && (
                    <span className="ml-2">
                      <Badge tone="warn">opt-out</Badge>
                    </span>
                  )}
                </Td>
                <Td className="whitespace-nowrap font-mono text-xs text-muted">
                  {formatPhone(m.phone)}
                </Td>
                <Td>{m.isAdmin ? <Badge tone="accent">admin</Badge> : <span className="text-muted">—</span>}</Td>
                <Td className="tabular-nums">
                  {m.strikes > 0 ? <span className="text-danger">{m.strikes}</span> : m.strikes}
                </Td>
                <Td className="tabular-nums">{m.messageCount}</Td>
                <Td className="whitespace-nowrap text-muted">
                  {m.lastMessageAt
                    ? m.lastMessageAt.toLocaleString("pt-BR", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })
                    : "—"}
                </Td>
                <Td className="whitespace-nowrap text-muted">
                  {m.joinedAt.toLocaleString("pt-BR", { dateStyle: "short" })}
                </Td>
                <Td>
                  <AcoesMembro
                    groupId={grupo.id}
                    memberId={m.id}
                    nome={m.nome ?? formatPhone(m.phone)}
                    isAdmin={m.isAdmin}
                  />
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
