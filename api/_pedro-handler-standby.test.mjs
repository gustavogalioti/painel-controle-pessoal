import assert from "node:assert/strict";
import handler from "./pedro.js";

const ORIGINAL_FETCH = globalThis.fetch;
const ENV_KEYS = ["PEDRO_ATIVO", "AUTH_ENFORCE", "DATABASE_URL"];
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

function makeReq(action, { method = "GET", body } = {}) {
  const url = `https://painel.example/api/pedro?action=${action}`;
  const init = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  return new Request(url, init);
}

// requireSession() só exige sessão de verdade com AUTH_ENFORCE=1 — deixando
// ausente, o handler libera sem precisar de cookie/token real neste teste.
delete process.env.AUTH_ENFORCE;
process.env.DATABASE_URL = "postgres://fake-user:fake-pass@ep-fake-000000.us-east-2.aws.neon.tech/neondb";

const ACTIONS = [
  { action: "chat", method: "POST", body: { message: "oi" } },
  { action: "push_subscribe", method: "POST", body: { subscription: { endpoint: "https://exemplo/sub" } } },
  { action: "push_unsubscribe", method: "POST", body: { endpoint: "https://exemplo/sub" } },
  { action: "admin_intents", method: "GET" },
  { action: "admin_memory", method: "GET" },
];

// ---------- stand by (padrão): toda action responde standby, sem tocar em fetch/sql ----------
for (const a of ACTIONS) {
  delete process.env.PEDRO_ATIVO;
  globalThis.fetch = throwingFetch(`stand by, action=${a.action}`);
  const res = await handler(makeReq(a.action, a));
  const data = await res.json();
  assert.equal(res.status, 200, `action=${a.action} deve responder 200`);
  assert.equal(data.standby, true, `action=${a.action} deve ter standby:true`);
  assert.equal(typeof data.reply, "string", `action=${a.action} deve ter reply de string (não quebra o front)`);
  restoreFetch();
}
console.log("pedro.js: toda action em stand by responde sem chamar fetch/sql: OK");

// ---------- PEDRO_ATIVO=1: passa do gate de stand by (smoke) ----------
{
  process.env.PEDRO_ATIVO = "1";
  // A lib @neondatabase/serverless usa fetch por baixo dos panos pra falar com
  // o Neon — sem rede de verdade neste teste, qualquer tentativa real de
  // consultar o banco cai nesse mock e lança. O handler original (de antes
  // desta mudança) tem um try/catch que captura isso e responde 500 — o que
  // importa aqui é só confirmar que NÃO foi a resposta de stand by, ou seja,
  // que o PEDRO_ATIVO=1 realmente deixa passar pro comportamento de sempre.
  globalThis.fetch = throwingFetch("smoke PEDRO_ATIVO=1");
  const res = await handler(makeReq("admin_intents", { method: "GET" }));
  const data = await res.json();
  assert.equal(res.status, 500, "sem rede/DB de verdade, cai no catch original (500) — não relacionado ao stand by");
  assert.notEqual(data.standby, true, "não pode ser a resposta de stand by");
  restoreFetch();
}
console.log("pedro.js: PEDRO_ATIVO=1 passa do gate de stand by (smoke): OK");

restoreEnv();
restoreFetch();
console.log("_pedro-handler-standby.test.mjs: todos os testes passaram");
