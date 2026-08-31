/**
 * Teste de ponta a ponta do webhook contra um Postgres real e uma Evolution
 * API falsa. É o único lugar onde dá pra provar que a regra escrita no painel
 * vira, de fato, uma mensagem no privado da pessoa certa.
 *
 * Roda só quando TEST_DATABASE_URL está definida:
 *   TEST_DATABASE_URL=postgresql://dev@127.0.0.1:55432/ggw pnpm exec tsx --test tests/integration.test.ts
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";

const DB = process.env.TEST_DATABASE_URL;

interface Captured {
  path: string;
  body: Record<string, unknown>;
}

describe("webhook da Evolution", { skip: DB ? false : "defina TEST_DATABASE_URL" }, () => {
  let server: Server;
  let captured: Captured[] = [];
  let POST: (req: Request) => Promise<Response>;
  let db: typeof import("../src/lib/db").db;
  let schema: typeof import("../src/lib/db/schema");
  let drizzle: typeof import("drizzle-orm");

  const SECRET = "segredo-de-teste-com-32-caracteres";
  const INSTANCE = "loja-teste";
  const GROUP_JID = "120363000000000001@g.us";
  const MEMBER_JID = "5511988887777@s.whatsapp.net";

  before(async () => {
    // Evolution falsa: registra o que foi chamado e sempre responde ok.
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        captured.push({
          path: req.url ?? "",
          body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ key: { id: "FAKE", remoteJid: "x", fromMe: true } }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;

    process.env.DATABASE_URL = DB;
    process.env.EVOLUTION_API_URL = `http://127.0.0.1:${port}`;
    process.env.EVOLUTION_API_KEY = "chave-de-teste";
    process.env.WEBHOOK_SECRET = SECRET;
    process.env.CRON_SECRET = "cron-secreto-com-32-caracteres!!";
    process.env.AUTH_SECRET = "auth-secreto-com-32-caracteres!!";
    process.env.TZ_DEFAULT = "America/Sao_Paulo";

    drizzle = await import("drizzle-orm");
    ({ db } = await import("../src/lib/db"));
    schema = await import("../src/lib/db/schema");
    ({ POST } = await import("../src/app/api/webhooks/evolution/route"));

    await reset();
  });

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  async function reset() {
    // Ordem importa: filhos antes dos pais por causa das FKs.
    for (const t of [
      schema.keywordHits,
      schema.moderationEvents,
      schema.messageEvents,
      schema.dailyGroupStats,
      schema.broadcastTargets,
      schema.broadcasts,
      schema.keywordTriggers,
      schema.moderationRules,
      schema.welcomeConfigs,
      schema.groupMembers,
      schema.contactTags,
      schema.groupTags,
      schema.contacts,
      schema.groups,
      schema.tags,
      schema.instances,
      schema.webhookEvents,
    ]) {
      await db.delete(t);
    }
    captured = [];
  }

  async function seedInstanceAndGroup() {
    const [instance] = await db
      .insert(schema.instances)
      .values({ evolutionName: INSTANCE, label: "Loja", status: "connected", dailyDmLimit: 5 })
      .returning();
    const [group] = await db
      .insert(schema.groups)
      .values({
        instanceId: instance.id,
        jid: GROUP_JID,
        name: "Ofertas",
        managed: true,
        botIsAdmin: true,
      })
      .returning();
    return { instance, group };
  }

  function messagePayload(text: string, id = "MSG-1") {
    return {
      event: "messages.upsert",
      instance: INSTANCE,
      data: {
        key: { remoteJid: GROUP_JID, fromMe: false, id, participant: MEMBER_JID },
        pushName: "Ana",
        messageTimestamp: 1735689600,
        message: { conversation: text },
      },
    };
  }

  function post(body: unknown, secret = SECRET) {
    return POST(
      new Request("http://localhost/api/webhooks/evolution", {
        method: "POST",
        headers: { "content-type": "application/json", "x-webhook-secret": secret },
        body: JSON.stringify(body),
      }),
    );
  }

  it("rejeita webhook sem o segredo correto", async () => {
    const res = await post(messagePayload("oi"), "segredo-errado-de-32-caracteres!!");
    assert.equal(res.status, 401);
  });

  it("puxa a pessoa pro privado quando a palavra-chave bate", async () => {
    await reset();
    const { instance, group } = await seedInstanceAndGroup();

    await db.insert(schema.keywordTriggers).values({
      instanceId: instance.id,
      name: "Sapato 44",
      keywords: ["44"],
      requiredAll: ["sapato"],
      negativeKeywords: [],
      mode: "contains",
      dmTemplate: "Oi {{nome}}, vi que você quer {{match}} no grupo {{grupo}}!",
      cooldownMinutes: 60,
      dailyLimit: 10,
      replyInGroup: true,
      groupReplyTemplate: "{{nome}}, te chamei no PV!",
    });

    const res = await post(messagePayload("quero sapato x 44"));
    const json = (await res.json()) as { keyword?: { sent?: boolean; matchedTerm?: string } };

    assert.equal(res.status, 200);
    assert.equal(json.keyword?.sent, true, "o DM deveria ter sido enviado");
    assert.equal(json.keyword?.matchedTerm, "44");

    const dm = captured.find(
      (c) => c.path.includes("/message/sendText/") && c.body.number === MEMBER_JID,
    );
    assert.ok(dm, "nenhuma mensagem foi enviada para o autor");
    assert.equal(dm.body.text, "Oi Ana, vi que você quer 44 no grupo Ofertas!");

    const groupReply = captured.find(
      (c) => c.path.includes("/message/sendText/") && c.body.number === GROUP_JID,
    );
    assert.ok(groupReply, "a resposta no grupo não saiu");

    const hits = await db.select().from(schema.keywordHits);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].status, "sent");

    // O grupo e o contato precisam ter sido criados/atualizados pelo caminho.
    const members = await db
      .select()
      .from(schema.groupMembers)
      .where(drizzle.eq(schema.groupMembers.groupId, group.id));
    assert.equal(members.length, 1);
    assert.equal(members[0].messageCount, 1);
  });

  it("não manda duas vezes quando a Evolution reenvia o mesmo evento", async () => {
    await reset();
    const { instance } = await seedInstanceAndGroup();
    await db.insert(schema.keywordTriggers).values({
      instanceId: instance.id,
      name: "Sapato",
      keywords: ["sapato"],
      requiredAll: [],
      negativeKeywords: [],
      dmTemplate: "oi",
    });

    await post(messagePayload("quero sapato", "MSG-DUP"));
    const second = await post(messagePayload("quero sapato", "MSG-DUP"));
    const json = (await second.json()) as { deduped?: boolean };

    assert.equal(json.deduped, true);
    const dms = captured.filter((c) => c.body.number === MEMBER_JID);
    assert.equal(dms.length, 1, "mandou DM duplicado no reenvio");
  });

  it("respeita o cooldown do gatilho", async () => {
    await reset();
    const { instance } = await seedInstanceAndGroup();
    await db.insert(schema.keywordTriggers).values({
      instanceId: instance.id,
      name: "Sapato",
      keywords: ["sapato"],
      requiredAll: [],
      negativeKeywords: [],
      dmTemplate: "oi",
      cooldownMinutes: 1440,
    });

    await post(messagePayload("quero sapato", "C-1"));
    const res = await post(messagePayload("quero sapato de novo", "C-2"));
    const json = (await res.json()) as { keyword?: { sent?: boolean; reason?: string } };

    assert.equal(json.keyword?.sent, false);
    assert.equal(json.keyword?.reason, "cooldown");
    assert.equal(captured.filter((c) => c.body.number === MEMBER_JID).length, 1);
  });

  it("nunca manda DM para quem pediu para sair", async () => {
    await reset();
    const { instance } = await seedInstanceAndGroup();
    await db.insert(schema.keywordTriggers).values({
      instanceId: instance.id,
      name: "Sapato",
      keywords: ["sapato"],
      requiredAll: [],
      negativeKeywords: [],
      dmTemplate: "oi",
    });

    // A pessoa manda "sair" no privado do bot.
    await post({
      event: "messages.upsert",
      instance: INSTANCE,
      data: {
        key: { remoteJid: MEMBER_JID, fromMe: false, id: "PV-1" },
        pushName: "Ana",
        message: { conversation: "sair" },
      },
    });

    const [contact] = await db
      .select()
      .from(schema.contacts)
      .where(drizzle.eq(schema.contacts.jid, MEMBER_JID));
    assert.equal(contact.optOut, true, "o opt-out não foi registrado");

    const res = await post(messagePayload("quero sapato", "OPT-1"));
    const json = (await res.json()) as { keyword?: { sent?: boolean; reason?: string } };
    assert.equal(json.keyword?.sent, false);
    assert.equal(json.keyword?.reason, "opt_out");
    assert.equal(captured.filter((c) => c.body.number === MEMBER_JID).length, 0);
  });

  it("apaga a mensagem, avisa e remove no terceiro strike", async () => {
    await reset();
    const { instance } = await seedInstanceAndGroup();
    await db.insert(schema.moderationRules).values({
      instanceId: instance.id,
      kind: "anti_link",
      action: "delete_and_warn",
      removeAtStrikes: 3,
      config: { allowDomains: ["minhaloja.com.br"] },
    });

    // Domínio liberado não é infração.
    await post(messagePayload("olha minhaloja.com.br/promo", "L-0"));
    assert.equal(await countModeration(), 0);

    for (const id of ["L-1", "L-2"]) {
      const res = await post(messagePayload(`compre em spam.xyz/oferta ${id}`, id));
      const json = (await res.json()) as { moderated?: { removed?: boolean } };
      assert.equal(json.moderated?.removed, false);
    }

    const res = await post(messagePayload("de novo spam.xyz/oferta", "L-3"));
    const json = (await res.json()) as { moderated?: { removed?: boolean } };
    assert.equal(json.moderated?.removed, true, "deveria remover no terceiro strike");

    const removals = captured.filter(
      (c) => c.path.includes("/group/updateParticipant/") && c.body.action === "remove",
    );
    assert.equal(removals.length, 1);
    assert.deepEqual(removals[0].body.participants, [MEMBER_JID]);

    const deletions = captured.filter((c) => c.path.includes("/chat/deleteMessageForEveryone/"));
    assert.equal(deletions.length, 3, "as três mensagens com link deveriam ter sido apagadas");
  });

  it("não age em grupo que não está sob gerenciamento", async () => {
    await reset();
    const [instance] = await db
      .insert(schema.instances)
      .values({ evolutionName: INSTANCE, label: "Loja", status: "connected" })
      .returning();
    await db.insert(schema.keywordTriggers).values({
      instanceId: instance.id,
      name: "Sapato",
      keywords: ["sapato"],
      requiredAll: [],
      negativeKeywords: [],
      dmTemplate: "oi",
    });

    const res = await post(messagePayload("quero sapato", "NG-1"));
    const json = (await res.json()) as { skipped?: string };
    assert.match(json.skipped ?? "", /não gerenciado/);
    assert.equal(captured.filter((c) => c.body.number === MEMBER_JID).length, 0);

    // Mas o grupo foi registrado, pra aparecer no painel.
    const rows = await db.select().from(schema.groups);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].managed, false);
  });

  it("dá boas-vindas a quem entra e registra quem sai", async () => {
    await reset();
    const { instance, group } = await seedInstanceAndGroup();
    await db.insert(schema.welcomeConfigs).values({
      groupId: group.id,
      enabled: true,
      template: "Bem-vindo(a) {{nome}} ao {{grupo}}!",
      mentionMember: true,
    });

    await post({
      event: "group-participants.update",
      instance: INSTANCE,
      data: { id: GROUP_JID, action: "add", participants: [MEMBER_JID] },
    });

    const welcome = captured.find(
      (c) => c.path.includes("/message/sendText/") && c.body.number === GROUP_JID,
    );
    assert.ok(welcome, "a mensagem de boas-vindas não saiu");
    assert.match(String(welcome.body.text), /Bem-vindo\(a\) .* ao Ofertas!/);
    assert.deepEqual(welcome.body.mentioned, [MEMBER_JID]);

    await post({
      event: "group-participants.update",
      instance: INSTANCE,
      data: { id: GROUP_JID, action: "remove", participants: [MEMBER_JID] },
    });

    const [member] = await db
      .select()
      .from(schema.groupMembers)
      .where(drizzle.eq(schema.groupMembers.groupId, group.id));
    assert.ok(member.leftAt, "a saída não foi registrada");

    const [stat] = await db
      .select()
      .from(schema.dailyGroupStats)
      .where(drizzle.eq(schema.dailyGroupStats.groupId, group.id));
    assert.equal(stat.joins, 1);
    assert.equal(stat.leaves, 1);

    assert.equal(instance.evolutionName, INSTANCE);
  });

  it("atualiza o status do número quando a conexão cai", async () => {
    await reset();
    await seedInstanceAndGroup();

    await post({
      event: "connection.update",
      instance: INSTANCE,
      data: { state: "close" },
    });

    const [row] = await db.select().from(schema.instances);
    assert.equal(row.status, "disconnected");
    assert.ok(row.lastSeenAt);
  });

  async function countModeration() {
    const rows = await db.select().from(schema.moderationEvents);
    return rows.length;
  }
});
