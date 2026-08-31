/**
 * O disparo é a parte que mais depende de estado no banco: a função morre no
 * timeout e a próxima execução do cron precisa continuar exatamente de onde
 * parou. Estes testes provam essa retomada.
 *
 *   TEST_DATABASE_URL=postgresql://dev@127.0.0.1:55432/ggw pnpm exec tsx --test tests/broadcast.test.ts
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";

const DB = process.env.TEST_DATABASE_URL;

describe("disparo em lotes", { skip: DB ? false : "defina TEST_DATABASE_URL" }, () => {
  let server: Server;
  let sends: Array<{ number: string; text?: string }> = [];
  let failFor = new Set<string>();
  let mod: typeof import("../src/lib/services/broadcast");
  let db: typeof import("../src/lib/db").db;
  let schema: typeof import("../src/lib/db/schema");
  let drizzle: typeof import("drizzle-orm");

  before(async () => {
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = raw ? (JSON.parse(raw) as { number: string; text?: string }) : { number: "" };
        sends.push(body);
        if (failFor.has(body.number)) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ message: "grupo indisponível" }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ key: { id: "OK" } }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;

    process.env.DATABASE_URL = DB;
    process.env.EVOLUTION_API_URL = `http://127.0.0.1:${port}`;
    process.env.EVOLUTION_API_KEY = "chave";
    process.env.WEBHOOK_SECRET = "segredo-de-teste-com-32-caracteres";
    process.env.CRON_SECRET = "cron-secreto-com-32-caracteres!!";
    process.env.AUTH_SECRET = "auth-secreto-com-32-caracteres!!";

    drizzle = await import("drizzle-orm");
    ({ db } = await import("../src/lib/db"));
    schema = await import("../src/lib/db/schema");
    mod = await import("../src/lib/services/broadcast");
  });

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  async function seed(groupCount: number) {
    for (const t of [
      schema.broadcastTargets,
      schema.broadcasts,
      schema.groupTags,
      schema.groups,
      schema.tags,
      schema.instances,
    ]) {
      await db.delete(t);
    }
    sends = [];
    failFor = new Set();

    const [instance] = await db
      .insert(schema.instances)
      .values({ evolutionName: "loja", label: "Loja", status: "connected" })
      .returning();

    const groups = await db
      .insert(schema.groups)
      .values(
        Array.from({ length: groupCount }, (_, i) => ({
          instanceId: instance.id,
          jid: `12036300000000000${i}@g.us`,
          name: `Grupo ${i}`,
          managed: true,
        })),
      )
      .returning();

    return { instance, groups };
  }

  it("envia para todos os grupos selecionados", async () => {
    const { instance, groups } = await seed(3);

    const { targetCount } = await mod.createBroadcast({
      instanceId: instance.id,
      name: "Promo",
      payload: { type: "text", text: "Oferta no {{grupo}}" },
      groupIds: groups.map((g) => g.id),
      scheduledAt: null,
      minDelayMs: 0,
      maxDelayMs: 0,
    });
    assert.equal(targetCount, 3);

    const report = await mod.dispatchDue({ deadlineMs: Date.now() + 20_000 });
    assert.equal(report.sent, 3);
    assert.equal(report.failed, 0);
    assert.equal(sends.length, 3);
    // {{grupo}} é resolvido por destino, não uma vez só para a campanha.
    assert.deepEqual(
      sends.map((s) => s.text).sort(),
      ["Oferta no Grupo 0", "Oferta no Grupo 1", "Oferta no Grupo 2"],
    );

    // Sem alvo pendente, a rodada seguinte fecha a campanha.
    await mod.dispatchDue({ deadlineMs: Date.now() + 20_000 });
    const [b] = await db.select().from(schema.broadcasts);
    assert.equal(b.status, "done");
    assert.ok(b.finishedAt);
  });

  it("retoma de onde parou quando o tempo acaba no meio", async () => {
    const { instance, groups } = await seed(4);
    await mod.createBroadcast({
      instanceId: instance.id,
      name: "Longa",
      payload: { type: "text", text: "oi" },
      groupIds: groups.map((g) => g.id),
      scheduledAt: null,
      // Pausa de 1,2s entre envios: a primeira rodada não cabe inteira.
      minDelayMs: 1200,
      maxDelayMs: 1200,
    });

    const first = await mod.dispatchDue({ deadlineMs: Date.now() + 2_500 });
    assert.ok(first.ranOutOfTime, "deveria ter parado por falta de tempo");
    assert.ok(first.sent >= 1 && first.sent < 4, `enviou ${first.sent}, esperado entre 1 e 3`);

    const pendingAfterFirst = await db
      .select()
      .from(schema.broadcastTargets)
      .where(drizzle.eq(schema.broadcastTargets.status, "pending"));
    assert.equal(pendingAfterFirst.length, 4 - first.sent);

    const second = await mod.dispatchDue({ deadlineMs: Date.now() + 20_000 });
    assert.equal(first.sent + second.sent, 4, "a retomada não completou o envio");
    assert.equal(sends.length, 4);
  });

  it("tenta três vezes antes de marcar o grupo como falho", async () => {
    const { instance, groups } = await seed(1);
    failFor = new Set([groups[0].jid]);

    await mod.createBroadcast({
      instanceId: instance.id,
      name: "Vai falhar",
      payload: { type: "text", text: "oi" },
      groupIds: [groups[0].id],
      scheduledAt: null,
      minDelayMs: 0,
      maxDelayMs: 0,
    });

    for (let i = 0; i < 2; i++) {
      await mod.dispatchDue({ deadlineMs: Date.now() + 20_000 });
      const [t] = await db.select().from(schema.broadcastTargets);
      assert.equal(t.status, "pending", `deveria seguir pendente na tentativa ${i + 1}`);
    }

    await mod.dispatchDue({ deadlineMs: Date.now() + 20_000 });
    const [target] = await db.select().from(schema.broadcastTargets);
    assert.equal(target.status, "failed");
    assert.equal(target.attempts, 3);
    assert.match(target.error ?? "", /400/);
  });

  it("só promove o agendamento depois da hora marcada", async () => {
    const { instance, groups } = await seed(1);
    const futuro = new Date(Date.now() + 60 * 60 * 1000);

    await mod.createBroadcast({
      instanceId: instance.id,
      name: "Amanhã",
      payload: { type: "text", text: "oi" },
      groupIds: [groups[0].id],
      scheduledAt: futuro,
      minDelayMs: 0,
      maxDelayMs: 0,
    });

    const antes = await mod.dispatchDue({ deadlineMs: Date.now() + 10_000 });
    assert.equal(antes.promoted, 0);
    assert.equal(antes.sent, 0);
    assert.equal(sends.length, 0);

    const depois = await mod.dispatchDue({
      deadlineMs: Date.now() + 10_000,
      now: new Date(futuro.getTime() + 1000),
    });
    assert.equal(depois.promoted, 1);
    assert.equal(depois.sent, 1);
  });

  it("resolve alvos por etiqueta sem duplicar grupo selecionado nos dois caminhos", async () => {
    const { instance, groups } = await seed(3);
    const [tag] = await db.insert(schema.tags).values({ name: "VIP" }).returning();
    await db.insert(schema.groupTags).values([
      { groupId: groups[0].id, tagId: tag.id },
      { groupId: groups[1].id, tagId: tag.id },
    ]);

    const ids = await mod.resolveTargetGroupIds({
      instanceId: instance.id,
      groupIds: [groups[0].id],
      tagIds: [tag.id],
    });
    assert.equal(ids.length, 2, "grupo em ambos os critérios deveria contar uma vez só");
    assert.ok(ids.includes(groups[0].id) && ids.includes(groups[1].id));
  });

  it("recusa campanha sem nenhum grupo correspondente", async () => {
    const { instance } = await seed(1);
    await assert.rejects(
      () =>
        mod.createBroadcast({
          instanceId: instance.id,
          name: "Vazia",
          payload: { type: "text", text: "oi" },
          groupIds: [],
          tagIds: [],
          scheduledAt: null,
        }),
      /Nenhum grupo/,
    );
  });

  it("não envia texto vazio", async () => {
    const { instance, groups } = await seed(1);
    await mod.createBroadcast({
      instanceId: instance.id,
      name: "Sem texto",
      payload: { type: "text", text: "   " },
      groupIds: [groups[0].id],
      scheduledAt: null,
      minDelayMs: 0,
      maxDelayMs: 0,
    });

    const report = await mod.dispatchDue({ deadlineMs: Date.now() + 10_000 });
    assert.equal(report.sent, 0);
    assert.equal(report.failed, 1);
    assert.equal(sends.length, 0, "não deveria ter chamado a Evolution");
  });
  it("dois disparadores simultâneos não enviam a mesma mensagem duas vezes", async () => {
    // Este é o cenário real: o cron da Vercel e o cron do VPS chamando o
    // mesmo endpoint no mesmo minuto. Sem reserva atômica, cada grupo recebe
    // a campanha duas vezes — e o cliente vê spam do próprio fornecedor.
    const { instance, groups } = await seed(6);
    await mod.createBroadcast({
      instanceId: instance.id,
      name: "Corrida",
      payload: { type: "text", text: "oi" },
      groupIds: groups.map((g) => g.id),
      scheduledAt: null,
      minDelayMs: 0,
      maxDelayMs: 0,
    });

    const deadline = Date.now() + 20_000;
    const [a, b] = await Promise.all([
      mod.dispatchDue({ deadlineMs: deadline }),
      mod.dispatchDue({ deadlineMs: deadline }),
    ]);

    assert.equal(a.sent + b.sent, 6, `enviou ${a.sent + b.sent}, esperado 6`);
    assert.equal(sends.length, 6, "algum grupo recebeu a mensagem mais de uma vez");

    const destinos = sends.map((s) => s.number).sort();
    assert.equal(new Set(destinos).size, 6, "houve destino duplicado");
  });

  it("destrava alvo reservado por execução que morreu no meio", async () => {
    const { instance, groups } = await seed(1);
    await mod.createBroadcast({
      instanceId: instance.id,
      name: "Órfã",
      payload: { type: "text", text: "oi" },
      groupIds: [groups[0].id],
      scheduledAt: null,
      minDelayMs: 0,
      maxDelayMs: 0,
    });

    // Simula a função morta: alvo reservado há 10 minutos e nunca concluído.
    await db
      .update(schema.broadcastTargets)
      .set({ status: "sending", claimedAt: new Date(Date.now() - 10 * 60 * 1000) });

    const report = await mod.dispatchDue({ deadlineMs: Date.now() + 20_000 });
    assert.equal(report.released, 1, "o alvo órfão deveria ter sido destravado");
    assert.equal(report.sent, 1);
  });

  it("não fecha a campanha enquanto outro disparador ainda segura alvos", async () => {
    const { instance, groups } = await seed(2);
    const { broadcast } = await mod.createBroadcast({
      instanceId: instance.id,
      name: "Meio do caminho",
      payload: { type: "text", text: "oi" },
      groupIds: groups.map((g) => g.id),
      scheduledAt: null,
      minDelayMs: 0,
      maxDelayMs: 0,
    });

    // Um alvo já foi, o outro está reservado por outra execução agora mesmo.
    const alvos = await db.select().from(schema.broadcastTargets);
    await db
      .update(schema.broadcastTargets)
      .set({ status: "sent", sentAt: new Date() })
      .where(drizzle.eq(schema.broadcastTargets.id, alvos[0].id));
    await db
      .update(schema.broadcastTargets)
      .set({ status: "sending", claimedAt: new Date() })
      .where(drizzle.eq(schema.broadcastTargets.id, alvos[1].id));

    await mod.dispatchDue({ deadlineMs: Date.now() + 10_000 });

    const [b] = await db
      .select()
      .from(schema.broadcasts)
      .where(drizzle.eq(schema.broadcasts.id, broadcast.id));
    assert.equal(b.status, "running", "fechou a campanha com trabalho em andamento");
  });
});
