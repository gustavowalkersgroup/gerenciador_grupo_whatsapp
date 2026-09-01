import assert from "node:assert/strict";
import { test } from "node:test";
import { deveMarcarSecure } from "../src/lib/auth/cookie";

test("sem configuração, liga em produção e desliga fora dela", () => {
  assert.equal(deveMarcarSecure(undefined, "production"), true);
  assert.equal(deveMarcarSecure(undefined, "development"), false);
  assert.equal(deveMarcarSecure(undefined, undefined), false);
});

test('"false" desliga mesmo em produção — é o caso do servidor local por IP', () => {
  assert.equal(deveMarcarSecure("false", "production"), false);
});

test('"true" liga mesmo fora de produção', () => {
  assert.equal(deveMarcarSecure("true", "development"), true);
});

test("string vazia conta como não configurada", () => {
  // Um `COOKIE_SECURE=` solto no .env não deve desligar a proteção por
  // acidente: só o literal "false" desliga.
  assert.equal(deveMarcarSecure("", "production"), true);
});
