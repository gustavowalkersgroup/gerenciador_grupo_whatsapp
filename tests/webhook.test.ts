import assert from "node:assert/strict";
import { test } from "node:test";
import { dedupeKey, secretMatches } from "../src/lib/webhook/verify";
import { extractText, hasMedia, messageTimestampMs, messageType } from "../src/lib/evolution/message";
import type { IncomingMessage } from "../src/lib/evolution/types";

test("secretMatches aceita só o segredo exato", () => {
  assert.equal(secretMatches("abc123", "abc123"), true);
  assert.equal(secretMatches("abc124", "abc123"), false);
  assert.equal(secretMatches(null, "abc123"), false);
  assert.equal(secretMatches("", "abc123"), false);
  // Tamanhos diferentes não podem estourar o timingSafeEqual.
  assert.doesNotThrow(() => secretMatches("x", "segredo-bem-mais-longo"));
  assert.equal(secretMatches("x", "segredo-bem-mais-longo"), false);
});

test("dedupeKey é estável pro mesmo evento e distinto entre eventos", () => {
  const data = { key: { id: "MSG1", remoteJid: "123@g.us" } };
  assert.equal(dedupeKey("messages.upsert", "loja", data), dedupeKey("messages.upsert", "loja", data));
  assert.notEqual(
    dedupeKey("messages.upsert", "loja", data),
    dedupeKey("messages.upsert", "loja", { key: { id: "MSG2" } }),
  );
  assert.notEqual(
    dedupeKey("messages.upsert", "loja", data),
    dedupeKey("messages.upsert", "outra", data),
  );
});

test("dedupeKey lê o id dentro de messages[]", () => {
  const a = dedupeKey("messages.upsert", "loja", { messages: [{ key: { id: "M9" } }] });
  const b = dedupeKey("messages.upsert", "loja", { key: { id: "M9" } });
  assert.equal(a, b);
});

test("dedupeKey separa entrada de saída dos mesmos participantes", () => {
  const add = { id: "1@g.us", action: "add", participants: ["55119@s.whatsapp.net"] };
  const rem = { ...add, action: "remove" };
  assert.notEqual(
    dedupeKey("group-participants.update", "loja", add, "2026-08-31T12:00:00Z"),
    dedupeKey("group-participants.update", "loja", rem, "2026-08-31T12:00:00Z"),
  );
});

test("reenvio do mesmo evento de participante gera a mesma chave", () => {
  const add = { id: "1@g.us", action: "add", participants: ["55119@s.whatsapp.net"] };
  const t = "2026-08-31T12:00:00Z";
  assert.equal(
    dedupeKey("group-participants.update", "loja", add, t),
    dedupeKey("group-participants.update", "loja", add, t),
  );
});

test("quem sai e volta recebe boas-vindas de novo: a chave muda com o horário", () => {
  // Era um bug silencioso: sem o horário na chave, a segunda entrada da mesma
  // pessoa no mesmo grupo era descartada como duplicata para sempre.
  const add = { id: "1@g.us", action: "add", participants: ["55119@s.whatsapp.net"] };
  assert.notEqual(
    dedupeKey("group-participants.update", "loja", add, "2026-08-31T12:00:00Z"),
    dedupeKey("group-participants.update", "loja", add, "2026-08-31T14:30:00Z"),
  );
});

test("id de mensagem dispensa o horário — ele já identifica o evento", () => {
  const data = { key: { id: "MSG9" } };
  assert.equal(
    dedupeKey("messages.upsert", "loja", data, "2026-08-31T12:00:00Z"),
    dedupeKey("messages.upsert", "loja", data, "2026-08-31T18:00:00Z"),
  );
});

test("dedupeKey cai no hash quando o evento não tem identificador", () => {
  const t = "2026-08-31T12:00:00Z";
  const k = dedupeKey("connection.update", "loja", { state: "open" }, t);
  assert.match(k, /^connection\.update:loja:[0-9a-f]{32}:/);
  assert.notEqual(k, dedupeKey("connection.update", "loja", { state: "close" }, t));
});

const msg = (message: IncomingMessage["message"]): IncomingMessage => ({
  key: { remoteJid: "1@g.us", fromMe: false, id: "X" },
  message,
});

test("extractText pega texto simples, estendido e legenda", () => {
  assert.equal(extractText(msg({ conversation: "quero sapato 44" })), "quero sapato 44");
  assert.equal(extractText(msg({ extendedTextMessage: { text: "oi" } })), "oi");
  assert.equal(extractText(msg({ imageMessage: { caption: "olha esse" } })), "olha esse");
  assert.equal(extractText(msg(undefined)), "");
});

test("extractText desembrulha mensagem efêmera e ver-uma-vez", () => {
  assert.equal(extractText(msg({ ephemeralMessage: { message: { conversation: "some" } } })), "some");
  assert.equal(
    extractText(msg({ viewOnceMessageV2: { message: { imageMessage: { caption: "foto" } } } })),
    "foto",
  );
});

test("messageType e hasMedia classificam corretamente", () => {
  assert.equal(messageType(msg({ conversation: "oi" })), "conversation");
  assert.equal(messageType(msg({ videoMessage: { caption: "x" } })), "videoMessage");
  assert.equal(hasMedia(msg({ videoMessage: {} })), true);
  assert.equal(hasMedia(msg({ conversation: "oi" })), false);
});

test("messageTimestampMs aceita segundos, string e ms", () => {
  assert.equal(messageTimestampMs({ ...msg({}), messageTimestamp: 1735689600 }), 1735689600000);
  assert.equal(messageTimestampMs({ ...msg({}), messageTimestamp: "1735689600" }), 1735689600000);
  assert.equal(messageTimestampMs({ ...msg({}), messageTimestamp: 1735689600000 }), 1735689600000);
  assert.equal(messageTimestampMs({ ...msg({}), messageTimestamp: 0 }), null);
  assert.equal(messageTimestampMs(msg({})), null);
});
