import assert from "node:assert/strict";
import { test } from "node:test";
import { containsTerm, domainOf, excerpt, normalize, renderTemplate, scanLinks } from "../src/lib/domain/text";

test("normalize tira acento, caixa e pontuação", () => {
  assert.equal(normalize("Quero SAPATO x 44!"), "quero sapato x 44");
  assert.equal(normalize("Não é permitido, ok?"), "nao e permitido ok");
  assert.equal(normalize("  múltiplos   espaços  "), "multiplos espacos");
});

test("containsTerm respeita limite de palavra", () => {
  const n = normalize("quero sapato 44");
  assert.equal(containsTerm(n, "44"), true);
  assert.equal(containsTerm(n, "sapato"), true);
  assert.equal(containsTerm(n, "SAPATO"), true);
  // 44 não pode bater dentro de 444
  assert.equal(containsTerm(normalize("modelo 444"), "44"), false);
  assert.equal(containsTerm(normalize("sapatos"), "sapato"), false);
});

test("containsTerm casa termo com acento vindo da regra", () => {
  assert.equal(containsTerm(normalize("preciso de cracha"), "crachá"), true);
  assert.equal(containsTerm(normalize("preciso de crachá"), "cracha"), true);
});

test("containsTerm com caractere especial na regra não quebra", () => {
  assert.doesNotThrow(() => containsTerm(normalize("promo c++"), "c++"));
  assert.equal(containsTerm(normalize("desconto (50%)"), "50"), true);
});

test("scanLinks acha url, domínio nu e convite de grupo", () => {
  assert.equal(scanLinks("olha https://loja.com/x").hasLink, true);
  assert.equal(scanLinks("acessa www.loja.com.br").hasLink, true);
  assert.equal(scanLinks("entra em loja.com.br agora").hasLink, true);
  assert.equal(scanLinks("bom dia pessoal").hasLink, false);
  assert.equal(scanLinks("chat.whatsapp.com/AbCdEfGhIjKl").hasWhatsAppInvite, true);
});

test("domainOf normaliza host", () => {
  assert.equal(domainOf("https://www.Loja.com.br/promo"), "loja.com.br");
  assert.equal(domainOf("loja.com"), "loja.com");
});

test("renderTemplate troca variáveis e apaga as que faltam", () => {
  assert.equal(
    renderTemplate("Oi {{nome}}, bem-vindo ao {{grupo}}!", { nome: "Ana", grupo: "Ofertas" }),
    "Oi Ana, bem-vindo ao Ofertas!",
  );
  assert.equal(renderTemplate("Oi {{nome}}{{sobrenome}}", { nome: "Ana" }), "Oi Ana");
});

test("excerpt corta e normaliza espaço", () => {
  assert.equal(excerpt("a\n\nb   c"), "a b c");
  assert.equal(excerpt("x".repeat(300)).length, 181);
});
