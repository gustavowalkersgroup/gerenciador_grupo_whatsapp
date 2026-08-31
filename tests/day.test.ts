import assert from "node:assert/strict";
import { test } from "node:test";
import { localDay } from "../src/lib/domain/day";

test("localDay usa o fuso, não UTC", () => {
  // 23:30 de 15/03 em São Paulo (UTC-3) já é 02:30 de 16/03 em UTC.
  const noite = new Date("2026-03-16T02:30:00Z");
  assert.equal(localDay(noite, "America/Sao_Paulo"), "2026-03-15");
  assert.equal(localDay(noite, "UTC"), "2026-03-16");
});

test("localDay zero-padda mês e dia", () => {
  assert.equal(localDay(new Date("2026-01-05T15:00:00Z"), "America/Sao_Paulo"), "2026-01-05");
});

test("localDay atravessa a virada do ano corretamente", () => {
  // 21:00 de 31/12 em São Paulo é 00:00 de 01/01 em UTC.
  const reveillon = new Date("2027-01-01T00:00:00Z");
  assert.equal(localDay(reveillon, "America/Sao_Paulo"), "2026-12-31");
});
