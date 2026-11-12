import assert from "node:assert/strict";
import handler from "./pedro-cron.js";

const ORIGINAL_FETCH = globalThis.fetch;
const ENV_KEYS = ["PEDRO_ATIVO", "CRON_SECRET", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "DATABASE_URL"];
const ORIGINAL_ENV = {};
for (const k of ENV_KEYS) ORIGINAL_ENV[k] = process.env[k];
function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (ORIGINAL_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL_ENV[k];
  }
}
function restoreFetch() { globalThis.fetch = ORIGINAL_FETCH; }
function throwingFetch(label) {
  return async () => { throw new Error(`fetch não deveria ser chamado (${label})`); };
}
function makeRes() {
  const res = {};
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

process.env.CRON_SECRET = "segredo-de-teste";

// ---------- secret errado: 401, independente do stand by ----------
{
  delete process.env.PEDRO_ATIVO;
  globalThis.fetch = throwingFetch("secret errado");
  const res = makeRes();
  await handler({ query: { secret: "errado" } }, res);
  assert.equal(res.statusCode, 401, "secret errado deve dar 401");
  restoreFetch();
}
console.log("pedro-cron: secret errado -> 401: OK");

// ---------- stand by (padrão, PEDRO_ATIVO ausente): 200 standby, sem tocar em fetch/sql ----------
{
  delete process.env.PEDRO_ATIVO;
  process.env.DATABASE_URL = "postgres://fake-user:fake-pass@ep-fake-000000.us-east-2.aws.neon.tech/neondb";
  globalThis.fetch = throwingFetch("stand by");
  const res = makeRes();
  await handler({ query: { secret: "segredo-de-teste" } }, res);
  assert.equal(res.statusCode, 200, "stand by deve responder 200");
  assert.deepEqual(res.body, { ok: true, standby: true }, "corpo deve ser {ok:true, standby:true}");
  restoreFetch();
}
console.log("pedro-cron: stand by responde 200 {ok:true,standby:true} sem chamar fetch/sql: OK");

// ---------- PEDRO_ATIVO=1: passa do gate de stand by; Fase 1 não envia nada, não toca fetch/sql ----------
{
  process.env.PEDRO_ATIVO = "1";
  globalThis.fetch = throwingFetch("PEDRO_ATIVO=1 (cron da Fase 1 não faz nada)");
  const res = makeRes();
  await handler({ query: { secret: "segredo-de-teste" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.notEqual(res.body.standby, true, "não pode ser a resposta de stand by");
  assert.equal(res.body.sent, 0, "Fase 1: nenhum push é enviado (sem agenda, sem check-in)");
  restoreFetch();
}
console.log("pedro-cron: PEDRO_ATIVO=1 não envia push nem toca fetch/sql (Fase 1): OK");

restoreEnv();
restoreFetch();
console.log("_pedro-cron-standby.test.mjs: todos os testes passaram");
