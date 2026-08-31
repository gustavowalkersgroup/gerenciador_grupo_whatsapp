/**
 * Cria um conjunto inicial de regras e um gatilho de exemplo para uma
 * instância já cadastrada. Rode com:
 *
 *   DATABASE_URL=... pnpm seed <nome-da-instancia>
 */
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { instances, keywordTriggers, moderationRules, tags } from "../src/lib/db/schema";

async function main() {
  const name = process.argv[2];
  if (!name) {
    console.error("Uso: pnpm seed <nome-da-instancia-na-evolution>");
    process.exit(1);
  }

  const [instance] = await db
    .select()
    .from(instances)
    .where(eq(instances.evolutionName, name))
    .limit(1);

  if (!instance) {
    console.error(`Instância "${name}" não encontrada. Cadastre pelo painel primeiro.`);
    process.exit(1);
  }

  const [leadTag] = await db
    .insert(tags)
    .values({ name: "Lead", color: "#25D366" })
    .onConflictDoNothing()
    .returning();

  await db
    .insert(moderationRules)
    .values([
      {
        instanceId: instance.id,
        kind: "anti_link",
        action: "delete_and_warn",
        removeAtStrikes: 3,
        config: { allowDomains: [], onlyWhatsAppInvites: false },
        exemptAdmins: true,
      },
      {
        instanceId: instance.id,
        kind: "anti_flood",
        action: "delete_and_warn",
        removeAtStrikes: 4,
        config: { maxMessages: 6, windowSeconds: 15 },
        exemptAdmins: true,
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(keywordTriggers)
    .values({
      instanceId: instance.id,
      name: "Sapato 44",
      keywords: ["44", "quarenta e quatro"],
      requiredAll: ["sapato"],
      negativeKeywords: ["nao quero", "não quero"],
      mode: "contains",
      dmTemplate:
        "Oi {{nome}}! Vi no grupo *{{grupo}}* que você procura sapato 44. " +
        "Tenho os modelos disponíveis nesse tamanho — quer que eu te mande as fotos?",
      replyInGroup: true,
      groupReplyTemplate: "{{nome}}, te chamei no privado! 📩",
      cooldownMinutes: 1440,
      dailyLimit: 50,
      applyTagId: leadTag?.id ?? null,
      priority: 10,
    })
    .onConflictDoNothing();

  console.log(`Regras e gatilho de exemplo criados para "${name}".`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
