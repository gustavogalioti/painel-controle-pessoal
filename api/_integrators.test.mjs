// Confirma que os mecanismos próprios dos integradores (Worker do Jarbas via
// x-jarbas-key, cron do Pedro via ?secret=, Custom GPT via Bearer) continuam
// funcionando do mesmo jeito independente do AUTH_ENFORCE/sessão do painel —
// e que o novo gate de sessão protege o que deve proteger (log_read sem chave).
import assert from "node:assert/strict";
import { requireAuth } from "./_gusos-lib.js";
import jarbasHandler from "./jarbas.js";
import cronHandler from "./pedro-cron.js";
import { createSessionCookie } from "./_auth-lib.js";

const SECRET = "test-secret-nao-usar-em-producao";
const fakeReq = (method, url, { headers = {}, } = {}) =>
  new Request(url, { method, headers });

// ---------- ChatGPT: requireAuth (Bearer CHATGPT_API_SECRET) ----------
{
  process.env.CHATGPT_API_SECRET = "gpt-secret";
  const ok = { headers: { get: (n) => (n === "authorization" ? "Bearer gpt-secret" : null) } };
  const bad = { headers: { get: (n) => (n === "authorization" ? "Bearer errado" : null) } };
  const none = { headers: { get: () => null } };
  assert.equal(requireAuth(ok), true, "Bearer correto deve autenticar");
  assert.equal(requireAuth(bad), false, "Bearer errado deve falhar");
  assert.equal(requireAuth(none), false, "sem header deve falhar");
  delete process.env.CHATGPT_API_SECRET;
}

// ---------- jarbas.js: x-jarbas-key sempre funciona, com AUTH_ENFORCE ligado ou não ----------
{
  process.env.JARBAS_API_KEY = "worker-key";

  for (const enforce of ["1", undefined]) {
    if (enforce) process.env.AUTH_ENFORCE = enforce; else delete process.env.AUTH_ENFORCE;

    const r1 = await jarbasHandler(fakeReq("GET", "https://x/api/jarbas?action=log_read", { headers: { "x-jarbas-key": "worker-key" } }));
    assert.notEqual(r1.status, 401, `x-jarbas-key válido não deve dar 401 (AUTH_ENFORCE=${enforce})`);

    const r2 = await jarbasHandler(fakeReq("GET", "https://x/api/jarbas?action=log_read", { headers: { "x-jarbas-key": "chave-errada" } }));
    // Sem sessão e sem chave certa: só passa se log_read E AUTH_ENFORCE estiver OFF
    if (enforce) assert.equal(r2.status, 401, `chave errada sem sessão deve dar 401 (AUTH_ENFORCE=${enforce})`);
    else assert.notEqual(r2.status, 401, `AUTH_ENFORCE off: log_read sem chave/sessão ainda passa (comportamento atual preservado)`);
  }

  delete process.env.AUTH_ENFORCE;
  delete process.env.JARBAS_API_KEY;
}

// ---------- jarbas.js: log_read aceita sessão válida do painel (sem chave do Worker) ----------
{
  process.env.JARBAS_API_KEY = "worker-key";
  process.env.AUTH_ENFORCE = "1";
  process.env.SESSION_SECRET = SECRET;

  const cookie = await createSessionCookie(SECRET);
  const token = cookie.match(/painel_session=([^;]+)/)[1];

  const rRead = await jarbasHandler(fakeReq("GET", "https://x/api/jarbas?action=log_read", { headers: { cookie: `painel_session=${token}` } }));
  assert.notEqual(rRead.status, 401, "log_read com sessão válida (sem x-jarbas-key) não deve dar 401");

  // Ação de ESCRITA (não é log_read) continua exigindo a chave do Worker, sessão não basta
  const rWrite = await jarbasHandler(fakeReq("POST", "https://x/api/jarbas?action=log_append", { headers: { cookie: `painel_session=${token}` } }));
  assert.equal(rWrite.status, 401, "log_append com só sessão (sem x-jarbas-key) deve continuar dando 401");

  delete process.env.AUTH_ENFORCE;
  delete process.env.SESSION_SECRET;
  delete process.env.JARBAS_API_KEY;
}

// ---------- pedro-cron.js: ?secret= (CRON_SECRET) independe de AUTH_ENFORCE/sessão ----------
{
  const mockRes = () => {
    const r = { _status: null, _body: null };
    r.status = (s) => { r._status = s; return r; };
    r.json = (b) => { r._body = b; return r; };
    return r;
  };

  process.env.CRON_SECRET = "cron-secret";
  for (const enforce of ["1", undefined]) {
    if (enforce) process.env.AUTH_ENFORCE = enforce; else delete process.env.AUTH_ENFORCE;

    const resBad = mockRes();
    await cronHandler({ query: { secret: "errado" } }, resBad);
    assert.equal(resBad._status, 401, `secret errado deve dar 401 (AUTH_ENFORCE=${enforce})`);

    const resOk = mockRes();
    await cronHandler({ query: { secret: "cron-secret" } }, resOk);
    assert.notEqual(resOk._status, 401, `secret correto não deve dar 401 (AUTH_ENFORCE=${enforce})`);
  }
  delete process.env.AUTH_ENFORCE;
  delete process.env.CRON_SECRET;
}

console.log("_integrators.test.mjs: todos os testes passaram");
