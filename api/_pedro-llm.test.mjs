import assert from "node:assert/strict";
import {
  pedroLlmChain,
  pedroLlmIsPermanentStatus,
  pedroLlmCircuitIsOpen,
  pedroLlmCircuitReset,
  callLlmChain,
} from "./pedro.js";

const ORIGINAL_FETCH = globalThis.fetch;
const ENV_KEYS = ["GROQ_API_KEY", "OPENAI_API_KEY", "PEDRO_LLM_ORDER"];

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}
function restoreFetch() {
  globalThis.fetch = ORIGINAL_FETCH;
}
function resetCircuits() {
  pedroLlmCircuitReset("groq");
  pedroLlmCircuitReset("openai");
}

const fakeOk = () => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content: "oi" } }] }),
});
const fakeErr = (status, retryAfter) => ({
  ok: false,
  status,
  headers: { get: (h) => (h.toLowerCase() === "retry-after" && retryAfter != null ? String(retryAfter) : null) },
  text: async () => "erro simulado",
});

// ---------- classificação de erros ----------
{
  assert.equal(pedroLlmIsPermanentStatus(400), true);
  assert.equal(pedroLlmIsPermanentStatus(401), true);
  assert.equal(pedroLlmIsPermanentStatus(403), true);
  assert.equal(pedroLlmIsPermanentStatus(404), true);
  assert.equal(pedroLlmIsPermanentStatus(429), false);
  assert.equal(pedroLlmIsPermanentStatus(500), false);
  assert.equal(pedroLlmIsPermanentStatus(503), false);
  console.log("pedroLlmIsPermanentStatus: OK");
}

// ---------- ordem da cadeia ----------
{
  clearEnv();
  process.env.GROQ_API_KEY = "g";
  process.env.OPENAI_API_KEY = "o";
  let chain = pedroLlmChain();
  assert.deepEqual(chain.map((c) => c.name), ["groq", "openai"], "padrão groq,openai");

  process.env.PEDRO_LLM_ORDER = "openai,groq";
  chain = pedroLlmChain();
  assert.deepEqual(chain.map((c) => c.name), ["openai", "groq"], "respeita PEDRO_LLM_ORDER");

  delete process.env.OPENAI_API_KEY;
  chain = pedroLlmChain();
  assert.deepEqual(chain.map((c) => c.name), ["groq"], "só entra quem tem chave configurada");

  clearEnv();
  chain = pedroLlmChain();
  assert.deepEqual(chain, [], "sem nenhuma chave, cadeia vazia");
  console.log("pedroLlmChain: OK");
}

// ---------- sem_chave ----------
{
  clearEnv();
  resetCircuits();
  await assert.rejects(() => callLlmChain([], []), (e) => {
    assert.equal(e.motivo, "sem_chave");
    return true;
  });
  console.log("callLlmChain sem chave: OK");
}

// ---------- erro transiente (429) no 1º provedor passa pro 2º ----------
{
  clearEnv();
  resetCircuits();
  process.env.GROQ_API_KEY = "g";
  process.env.OPENAI_API_KEY = "o";
  let calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    if (url.includes("groq")) return fakeErr(429); // sem retry-after curto -> não repete, vai pro próximo
    return fakeOk();
  };
  const data = await callLlmChain([], []);
  assert.equal(data._provider, "openai", "falha na groq deve cair pra openai");
  assert.equal(calls.filter((u) => u.includes("groq")).length, 1, "groq chamada só 1x (sem retry-after curto)");
  restoreFetch();
  console.log("fallback groq->openai em 429: OK");
}

// ---------- 429 com Retry-After curto: espera e tenta de novo o MESMO provedor ----------
{
  clearEnv();
  resetCircuits();
  process.env.GROQ_API_KEY = "g";
  let attempt = 0;
  globalThis.fetch = async () => {
    attempt++;
    if (attempt === 1) return fakeErr(429, 1); // retry-after 1s (<=2s)
    return fakeOk();
  };
  const data = await callLlmChain([], []);
  assert.equal(data._provider, "groq");
  assert.equal(attempt, 2, "deveria ter tentado a groq de novo após o retry-after curto");
  restoreFetch();
  console.log("429 com retry-after curto repete o mesmo provedor: OK");
}

// ---------- erro permanente (401) também passa pro próximo, sem repetir ----------
{
  clearEnv();
  resetCircuits();
  process.env.GROQ_API_KEY = "g";
  process.env.OPENAI_API_KEY = "o";
  let groqCalls = 0;
  globalThis.fetch = async (url) => {
    if (url.includes("groq")) { groqCalls++; return fakeErr(401); }
    return fakeOk();
  };
  const data = await callLlmChain([], []);
  assert.equal(data._provider, "openai");
  assert.equal(groqCalls, 1, "erro permanente não deve repetir no mesmo provedor");
  restoreFetch();
  console.log("erro permanente (401) cai pro próximo provedor: OK");
}

// ---------- circuit breaker: 2 falhas transientes seguidas abrem o circuito ----------
{
  clearEnv();
  resetCircuits();
  process.env.GROQ_API_KEY = "g";
  process.env.OPENAI_API_KEY = "o";
  let groqCalls = 0;
  globalThis.fetch = async (url) => {
    if (url.includes("groq")) { groqCalls++; return fakeErr(500); }
    return fakeOk();
  };
  assert.equal(pedroLlmCircuitIsOpen("groq"), false);
  await callLlmChain([], []); // 1ª falha transiente da groq
  assert.equal(pedroLlmCircuitIsOpen("groq"), false, "1 falha ainda não abre o circuito (limite é 2)");
  await callLlmChain([], []); // 2ª falha transiente da groq
  assert.equal(pedroLlmCircuitIsOpen("groq"), true, "2 falhas seguidas devem abrir o circuito");
  assert.equal(groqCalls, 2, "groq só foi chamada nas 2 primeiras vezes");

  // Com o circuito aberto, uma nova chamada não deve nem tentar a groq
  const data = await callLlmChain([], []);
  assert.equal(data._provider, "openai");
  assert.equal(groqCalls, 2, "circuito aberto: groq não foi chamada de novo");
  restoreFetch();
  resetCircuits();
  console.log("circuit breaker: OK");
}

// ---------- timeout (AbortError) é tratado como transiente ----------
{
  clearEnv();
  resetCircuits();
  process.env.GROQ_API_KEY = "g";
  process.env.OPENAI_API_KEY = "o";
  globalThis.fetch = async (url) => {
    if (url.includes("groq")) { const e = new Error("aborted"); e.name = "AbortError"; throw e; }
    return fakeOk();
  };
  const data = await callLlmChain([], []);
  assert.equal(data._provider, "openai", "timeout na groq deve cair pra openai");
  restoreFetch();
  resetCircuits();
  console.log("timeout (AbortError) tratado como transiente: OK");
}

// ---------- todos falham: lança com .motivo (quem chama cai nas palavras-chave) ----------
{
  clearEnv();
  resetCircuits();
  process.env.GROQ_API_KEY = "g";
  process.env.OPENAI_API_KEY = "o";
  globalThis.fetch = async (url) => (url.includes("groq") ? fakeErr(500) : fakeErr(401));
  await assert.rejects(() => callLlmChain([], []), (e) => {
    assert.ok(e.motivo, "deve ter um motivo curto");
    assert.ok(e.motivo.startsWith("openai_"), "motivo deve refletir o último provedor tentado");
    return true;
  });
  restoreFetch();
  resetCircuits();
  console.log("todos os provedores falham -> lança com .motivo: OK");
}

clearEnv();
restoreFetch();
resetCircuits();
console.log("_pedro-llm.test.mjs: todos os testes passaram");
