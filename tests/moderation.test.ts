import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate, type MessageContext, type Rule } from "../src/lib/domain/moderation";

const rule = (over: Partial<Rule> & Pick<Rule, "kind">): Rule => ({
  id: over.kind,
  action: "delete_and_warn",
  removeAtStrikes: 3,
  config: {},
  warnTemplate: null,
  exemptAdmins: true,
  enabled: true,
  ...over,
});

const ctx = (over: Partial<MessageContext> = {}): MessageContext => ({
  rawText: "",
  messageType: "conversation",
  hasMedia: false,
  senderIsAdmin: false,
  senderIsBot: false,
  recentCount: 1,
  minutesOfDay: 12 * 60,
  ...over,
});

test("anti_link pega link e libera domínio da allowlist", () => {
  const r = [rule({ kind: "anti_link", config: { allowDomains: ["minhaloja.com.br"] } })];
  assert.equal(evaluate(r, ctx({ rawText: "compra em spam.xyz/oferta" })).length, 1);
  assert.equal(evaluate(r, ctx({ rawText: "veja minhaloja.com.br/promo" })).length, 0);
  assert.equal(evaluate(r, ctx({ rawText: "veja loja.minhaloja.com.br/x" })).length, 0);
  assert.equal(evaluate(r, ctx({ rawText: "bom dia" })).length, 0);
});

test("anti_link em modo onlyWhatsAppInvites deixa link normal passar", () => {
  const r = [rule({ kind: "anti_link", config: { onlyWhatsAppInvites: true } })];
  assert.equal(evaluate(r, ctx({ rawText: "olha g1.com.br/noticia" })).length, 0);
  assert.equal(evaluate(r, ctx({ rawText: "entra chat.whatsapp.com/AbCdEfGhIjKl" })).length, 1);
});

test("admin é isento quando exemptAdmins está ligado", () => {
  const r = [rule({ kind: "anti_link", exemptAdmins: true })];
  assert.equal(evaluate(r, ctx({ rawText: "spam.xyz", senderIsAdmin: true })).length, 0);
  const r2 = [rule({ kind: "anti_link", exemptAdmins: false })];
  assert.equal(evaluate(r2, ctx({ rawText: "spam.xyz", senderIsAdmin: true })).length, 1);
});

test("o próprio bot nunca é moderado", () => {
  const r = [rule({ kind: "anti_link" })];
  assert.equal(evaluate(r, ctx({ rawText: "spam.xyz", senderIsBot: true })).length, 0);
});

test("banned_words casa sem acento e com caixa diferente", () => {
  const r = [rule({ kind: "banned_words", config: { words: ["golpe", "pirâmide"] } })];
  assert.equal(evaluate(r, ctx({ rawText: "isso é GOLPE" })).length, 1);
  assert.equal(evaluate(r, ctx({ rawText: "esquema de piramide" })).length, 1);
  assert.equal(evaluate(r, ctx({ rawText: "produto original" })).length, 0);
});

test("anti_flood só dispara acima do máximo", () => {
  const r = [rule({ kind: "anti_flood", config: { maxMessages: 5, windowSeconds: 10 } })];
  assert.equal(evaluate(r, ctx({ recentCount: 5 })).length, 0);
  assert.equal(evaluate(r, ctx({ recentCount: 6 })).length, 1);
});

test("anti_media respeita lista de tipos bloqueados", () => {
  const r = [rule({ kind: "anti_media", config: { blockedTypes: ["videoMessage"] } })];
  assert.equal(evaluate(r, ctx({ hasMedia: true, messageType: "videoMessage" })).length, 1);
  assert.equal(evaluate(r, ctx({ hasMedia: true, messageType: "imageMessage" })).length, 0);
  assert.equal(evaluate(r, ctx({ hasMedia: false, messageType: "videoMessage" })).length, 0);
});

test("only_admins com janela normal e janela que cruza a meia-noite", () => {
  const dia = [rule({ kind: "only_admins", config: { quietFrom: "09:00", quietTo: "12:00" } })];
  assert.equal(evaluate(dia, ctx({ minutesOfDay: 10 * 60 })).length, 1);
  assert.equal(evaluate(dia, ctx({ minutesOfDay: 13 * 60 })).length, 0);

  const noite = [rule({ kind: "only_admins", config: { quietFrom: "22:00", quietTo: "07:00" } })];
  assert.equal(evaluate(noite, ctx({ minutesOfDay: 23 * 60 })).length, 1);
  assert.equal(evaluate(noite, ctx({ minutesOfDay: 3 * 60 })).length, 1);
  assert.equal(evaluate(noite, ctx({ minutesOfDay: 12 * 60 })).length, 0);
});

test("only_admins sem janela fecha o grupo o tempo todo", () => {
  const r = [rule({ kind: "only_admins", config: {} })];
  assert.equal(evaluate(r, ctx({ minutesOfDay: 3 * 60 })).length, 1);
  assert.equal(evaluate(r, ctx({ minutesOfDay: 3 * 60, senderIsAdmin: true })).length, 0);
});

test("violações vêm da mais severa para a menos severa", () => {
  const r = [
    rule({ kind: "banned_words", action: "warn", config: { words: ["golpe"] } }),
    rule({ kind: "anti_link", action: "remove" }),
  ];
  const v = evaluate(r, ctx({ rawText: "golpe em spam.xyz" }));
  assert.equal(v.length, 2);
  assert.equal(v[0].action, "remove");
  assert.equal(v[1].action, "warn");
});

test("regra desabilitada é ignorada e template padrão é preenchido", () => {
  assert.equal(evaluate([rule({ kind: "anti_link", enabled: false })], ctx({ rawText: "spam.xyz" })).length, 0);
  const v = evaluate([rule({ kind: "anti_link" })], ctx({ rawText: "spam.xyz" }));
  assert.match(v[0].warnTemplate ?? "", /\{\{nome\}\}/);
});
