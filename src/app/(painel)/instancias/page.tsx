import { desc } from "drizzle-orm";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { instances } from "@/lib/db/schema";
import { formatPhone } from "@/lib/domain/jid";
import { env } from "@/lib/env";
import { Alert, Card, Empty } from "@/components/ui";
import { LimitesForm, ListaNumeros, NovoNumeroForm, type InstanceView } from "./qr-panel";

export const dynamic = "force-dynamic";

/** APP_URL vazia impede cadastrar número: sem ela não há webhook pra apontar. */
function appUrl(): string | null {
  try {
    return env().APP_URL?.replace(/\/+$/, "") ?? null;
  } catch {
    return null;
  }
}

export default async function InstanciasPage() {
  await requireUser();

  const rows = await db.select().from(instances).orderBy(desc(instances.createdAt));
  const base = appUrl();

  const items: InstanceView[] = rows.map((row) => ({
    id: row.id,
    label: row.label,
    evolutionName: row.evolutionName,
    phone: formatPhone(row.phone),
    status: row.status,
    dailyDmLimit: row.dailyDmLimit,
    minSendDelayMs: row.minSendDelayMs,
    maxSendDelayMs: row.maxSendDelayMs,
    lastSeen: row.lastSeenAt ? row.lastSeenAt.toLocaleString("pt-BR") : "—",
  }));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Números</h1>
        <p className="mt-1 text-sm text-muted">
          Cada número é uma instância da Evolution API rodando no VPS.
        </p>
      </header>

      {!base && (
        <Alert tone="danger" title="APP_URL não configurada">
          Defina <code className="font-mono">APP_URL</code> com a URL pública do painel antes de
          cadastrar um número. É esse endereço que a Evolution usa para entregar os eventos dos
          grupos em <code className="font-mono">/api/webhooks/evolution</code>.
        </Alert>
      )}

      <Card
        title="Números cadastrados"
        subtitle={
          base ? `Webhook apontando para ${base}/api/webhooks/evolution` : "Webhook não configurado"
        }
      >
        {items.length === 0 ? (
          <Empty
            title="Nenhum número cadastrado"
            hint="Cadastre abaixo e conecte lendo o QR Code no celular."
          />
        ) : (
          <ListaNumeros items={items} />
        )}
      </Card>

      <Card
        title="Cadastrar número"
        subtitle="A instância é criada na Evolution primeiro; só depois entra no painel."
      >
        <NovoNumeroForm />
      </Card>

      {items.length > 0 && (
        <Card
          title="Limites de segurança"
          subtitle="Ritmo de envio de cada número"
        >
          <div className="space-y-6">
            <p className="text-sm text-muted">
              O WhatsApp bane número que dispara mensagem rápido demais ou fala com muita gente
              desconhecida no mesmo dia. O limite diário corta as DMs de palavra-chave quando o teto
              é atingido, e o intervalo mínimo/máximo sorteia uma espera aleatória entre um envio e
              outro — ritmo irregular parece gente, ritmo cravado parece robô. Números novos ou
              recém-aquecidos pedem limites mais baixos.
            </p>

            {items.map((item) => (
              <LimitesForm key={item.id} item={item} />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
