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

// ---------- PEDRO_ATIVO=1: passa do gate de stand by (smoke) ----------
{
  process.env.PEDRO_ATIVO = "1";
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  // Sem VAPID configurado, o handler ORIGINAL (comportamento de antes desta
  // mudança, nada a ver com stand by) responde 500 — é só isso que este
  // smoke test confere: que o PEDRO_ATIVO=1 não ficou preso no gate de stand by.
  globalThis.fetch = throwingFetch("smoke PEDRO_ATIVO=1");
  const res = makeRes();
  await handler({ query: { secret: "segredo-de-teste" } }, res);
  assert.equal(res.statusCode, 500, "sem VAPID, o comportamento original (pré-existente) é 500");
  assert.notDeepEqual(res.body, { ok: true, standby: true }, "não pode ser a resposta de stand by");
  restoreFetch();
}
console.log("pedro-cron: PEDRO_ATIVO=1 passa do gate de stand by (smoke): OK");

restoreEnv();
restoreFetch();
console.log("_pedro-cron-standby.test.mjs: todos os testes passaram");
