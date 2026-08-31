import assert from "node:assert/strict";
import { test } from "node:test";
import { formatPhone, isGroupJid, jidToPhone, normalizeJid, phoneToJid, senderJid } from "../src/lib/domain/jid";

test("normalizeJid tira sufixo de device e unifica domínio", () => {
  assert.equal(normalizeJid("5511999998888:12@s.whatsapp.net"), "5511999998888@s.whatsapp.net");
  assert.equal(normalizeJid("5511999998888@c.us"), "5511999998888@s.whatsapp.net");
  assert.equal(normalizeJid("120363000000000000@g.us"), "120363000000000000@g.us");
});

test("isGroupJid distingue grupo de contato", () => {
  assert.equal(isGroupJid("120363000000000000@g.us"), true);
  assert.equal(isGroupJid("5511999998888@s.whatsapp.net"), false);
});

test("senderJid pega o participante em grupo e o remoteJid no privado", () => {
  assert.equal(
    senderJid({ remoteJid: "120363000000000000@g.us", participant: "5511999998888:3@s.whatsapp.net" }),
    "5511999998888@s.whatsapp.net",
  );
  assert.equal(senderJid({ remoteJid: "5511999998888@s.whatsapp.net" }), "5511999998888@s.whatsapp.net");
  // Em grupo sem participant não dá pra saber quem falou — melhor nulo do que chutar.
  assert.equal(senderJid({ remoteJid: "120363000000000000@g.us" }), null);
});

test("jidToPhone e phoneToJid são simétricos", () => {
  assert.equal(jidToPhone("5511999998888@s.whatsapp.net"), "5511999998888");
  assert.equal(phoneToJid("+55 (11) 99999-8888"), "5511999998888@s.whatsapp.net");
  assert.equal(jidToPhone("123@s.whatsapp.net"), null);
});

test("formatPhone monta o formato BR", () => {
  assert.equal(formatPhone("5511999998888"), "+55 11 99999-8888");
  assert.equal(formatPhone("551133334444"), "+55 11 3333-4444");
  assert.equal(formatPhone(null), "—");
});
