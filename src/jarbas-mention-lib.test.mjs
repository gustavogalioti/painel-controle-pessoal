import assert from "node:assert/strict";
import { temMencaoJarbas, montarRecadoDeMencao } from "./jarbas-mention-lib.js";

// ---------- temMencaoJarbas ----------
assert.equal(temMencaoJarbas("@jarbas lembra de ligar pro Oscar"), true, "menção no começo");
assert.equal(temMencaoJarbas("preciso falar com @jarbas sobre isso"), true, "menção no meio");
assert.equal(temMencaoJarbas("@Jarbas bom dia"), true, "case-insensitive");
assert.equal(temMencaoJarbas("@JARBAS"), true);
assert.equal(temMencaoJarbas("nada a ver aqui"), false, "sem menção -> false");
assert.equal(temMencaoJarbas("jarbas sem arroba não conta"), false, "sem o @ -> false, não é só a palavra");
assert.equal(temMencaoJarbas("email@jarbasempresa.com"), false, "\\b depois de 'jarbas' corta no meio de outra palavra");
assert.equal(temMencaoJarbas(""), false);
assert.equal(temMencaoJarbas(null), false, "nunca quebra com null");
assert.equal(temMencaoJarbas(undefined), false, "nunca quebra com undefined");
console.log("temMencaoJarbas: OK");

// ---------- montarRecadoDeMencao ----------
{
  const r = montarRecadoDeMencao("@jarbas lembra de ligar pro Oscar", { pagina: "diary", itemId: 42 }, { id: 1, at: "2026-11-04T10:00:00.000Z" });
  assert.deepEqual(r, { id: 1, text: "@jarbas lembra de ligar pro Oscar", at: "2026-11-04T10:00:00.000Z", done: false, origem: { pagina: "diary", itemId: 42 } });
}
{
  // sem origem -> recado não ganha o campo (nunca muda o formato existente à toa)
  const r = montarRecadoDeMencao("@jarbas oi", null, { id: 2, at: "x" });
  assert.deepEqual(r, { id: 2, text: "@jarbas oi", at: "x", done: false });
  assert.ok(!("origem" in r), "sem origem passada, o campo nem aparece no objeto");
}
{
  // texto é aparado (trim) antes de virar recado
  const r = montarRecadoDeMencao("   @jarbas com espaço   ", null, { id: 3, at: "x" });
  assert.equal(r.text, "@jarbas com espaço");
}
assert.equal(montarRecadoDeMencao("sem menção nenhuma", null), null, "sem @jarbas no texto -> não vira recado (null)");
assert.equal(montarRecadoDeMencao("", null), null);
assert.equal(montarRecadoDeMencao(null, null), null, "nunca quebra com null");
console.log("montarRecadoDeMencao: OK");

console.log("jarbas-mention-lib.test.mjs: todos os testes passaram");
