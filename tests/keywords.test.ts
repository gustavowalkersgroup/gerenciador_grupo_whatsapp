import assert from "node:assert/strict";
import { test } from "node:test";
import { canSendDm, isOptOutMessage, matchTriggers, type Trigger } from "../src/lib/domain/keywords";

const base: Omit<Trigger, "id" | "name" | "keywords"> = {
  requiredAll: [],
  negativeKeywords: [],
  mode: "contains",
  priority: 0,
  enabled: true,
  groupId: null,
};

const t = (id: string, name: string, keywords: string[], over: Partial<Trigger> = {}): Trigger => ({
  ...base,
  id,
  name,
  keywords,
  ...over,
});

test("caso do usuário: 'quero sapato x 44' puxa o gatilho de sapato 44", () => {
  const triggers = [t("1", "Sapato 44", ["44", "quarenta e quatro"], { requiredAll: ["sapato"] })];
  const m = matchTriggers(triggers, "quero sapato x 44");
  assert.equal(m.length, 1);
  assert.equal(m[0].trigger.id, "1");
  assert.equal(m[0].matchedTerm, "44");
});

test("requiredAll evita falso positivo", () => {
  const triggers = [t("1", "Sapato 44", ["44"], { requiredAll: ["sapato"] })];
  assert.equal(matchTriggers(triggers, "meu apartamento é 44").length, 0);
  assert.equal(matchTriggers(triggers, "tem sapato 44?").length, 1);
});

test("negativeKeywords descarta o gatilho", () => {
  const triggers = [t("1", "Compra", ["quero", "comprar"], { negativeKeywords: ["não quero"] })];
  assert.equal(matchTriggers(triggers, "não quero comprar nada").length, 0);
  assert.equal(matchTriggers(triggers, "quero comprar"). length, 1);
});

test("ordena por prioridade e depois por termo mais específico", () => {
  const triggers = [
    t("geral", "Geral", ["sapato"], { priority: 0 }),
    t("especifico", "Especifico", ["sapato 44"], { priority: 0 }),
    t("vip", "VIP", ["sapato"], { priority: 10 }),
  ];
  const m = matchTriggers(triggers, "procuro sapato 44");
  assert.equal(m[0].trigger.id, "vip");
  assert.equal(m[1].trigger.id, "especifico");
});

test("modo exact só bate a mensagem inteira", () => {
  const triggers = [t("1", "Exato", ["preço"], { mode: "exact" })];
  assert.equal(matchTriggers(triggers, "preço").length, 1);
  assert.equal(matchTriggers(triggers, "qual o preço?").length, 0);
});

test("modo starts_with", () => {
  const triggers = [t("1", "Comando", ["!info"], { mode: "starts_with" })];
  assert.equal(matchTriggers(triggers, "!info sapato").length, 1);
  assert.equal(matchTriggers(triggers, "manda !info").length, 0);
});

test("regex inválida não derruba o matcher", () => {
  const triggers = [t("1", "Quebrado", ["([a-z"], { mode: "regex" })];
  assert.doesNotThrow(() => matchTriggers(triggers, "qualquer coisa"));
  assert.equal(matchTriggers(triggers, "qualquer coisa").length, 0);
});

test("regex válida funciona", () => {
  const triggers = [t("1", "Tamanho", ["\\b(3[4-9]|4[0-6])\\b"], { mode: "regex" })];
  assert.equal(matchTriggers(triggers, "uso 44").length, 1);
  assert.equal(matchTriggers(triggers, "uso 99").length, 0);
});

test("gatilho desabilitado e mensagem vazia são ignorados", () => {
  assert.equal(matchTriggers([t("1", "Off", ["oi"], { enabled: false })], "oi").length, 0);
  assert.equal(matchTriggers([t("1", "On", ["oi"])], "   ").length, 0);
});

test("canSendDm: opt-out ganha de tudo", () => {
  const r = canSendDm({
    optOut: true,
    minutesSinceLastHit: null,
    cooldownMinutes: 0,
    hitsTodayForTrigger: 0,
    triggerDailyLimit: 100,
    dmsTodayForInstance: 0,
    instanceDailyLimit: 150,
  });
  assert.deepEqual(r, { allowed: false, reason: "opt_out" });
});

test("canSendDm: cooldown, teto do gatilho e teto da instância", () => {
  const g = {
    optOut: false,
    minutesSinceLastHit: null as number | null,
    cooldownMinutes: 60,
    hitsTodayForTrigger: 0,
    triggerDailyLimit: 10,
    dmsTodayForInstance: 0,
    instanceDailyLimit: 100,
  };
  assert.equal(canSendDm({ ...g, minutesSinceLastHit: 10 }).allowed, false);
  assert.equal(canSendDm({ ...g, minutesSinceLastHit: 90 }).allowed, true);
  assert.deepEqual(canSendDm({ ...g, hitsTodayForTrigger: 10 }), {
    allowed: false,
    reason: "trigger_daily_limit",
  });
  assert.deepEqual(canSendDm({ ...g, dmsTodayForInstance: 100 }), {
    allowed: false,
    reason: "instance_daily_limit",
  });
  assert.equal(canSendDm({ ...g, cooldownMinutes: 0, minutesSinceLastHit: 0 }).allowed, true);
});

test("isOptOutMessage reconhece pedidos de saída sem pegar frase longa", () => {
  assert.equal(isOptOutMessage("sair"), true);
  assert.equal(isOptOutMessage("PARAR"), true);
  assert.equal(isOptOutMessage("não quero mais"), true);
  assert.equal(isOptOutMessage("quero sair do sapato 44 e ver outro modelo maior por favor"), false);
  assert.equal(isOptOutMessage("bom dia"), false);
});
