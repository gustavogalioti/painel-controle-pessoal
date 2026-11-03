// PAINEL-3: ponte painel -> Worker (barra de comando @jarbas) — cmdChat/cmdDesfazer.
// Mesmo mock mínimo de `sql` dos outros testes de jarbas.js (api/_jarbas-diario.test.mjs).
import assert from "node:assert/strict";
import { cmdChat, cmdDesfazer, buildCompanionStateFromMem } from "./jarbas.js";

function makeMockSql() {
  const store = new Map();
  const sql = (strings, ...values) => {
    const text = strings.join(" ");
    if (text.includes("SELECT value FROM sync_kv")) {
      const key = values[0];
      return Promise.resolve(store.has(key) ? [{ value: store.get(key) }] : []);
    }
    if (text.includes("COALESCE(sync_kv.value::jsonb")) {
      const [key, value] = values;
      const existing = store.has(key) ? JSON.parse(store.get(key)) : [];
      const incoming = JSON.parse(value);
      store.set(key, JSON.stringify([...existing, ...incoming]));
      return Promise.resolve([]);
    }
    if (text.includes("INSERT INTO sync_kv")) {
      const [key, value] = values;
      store.set(key, value);
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  };
  return { sql, store };
}
const getList = (store, key) => JSON.parse(store.get(key) || "[]");
const getJson = (store, key) => (store.has(key) ? JSON.parse(store.get(key)) : null);

function withWorkerEnv(fn) {
  return async () => {
    const prevUrl = process.env.WORKER_URL, prevKey = process.env.JARBAS_WORKER_SYNC_KEY;
    process.env.WORKER_URL = "https://worker.test";
    process.env.JARBAS_WORKER_SYNC_KEY = "segredo-worker";
    try { await fn(); } finally {
      if (prevUrl === undefined) delete process.env.WORKER_URL; else process.env.WORKER_URL = prevUrl;
      if (prevKey === undefined) delete process.env.JARBAS_WORKER_SYNC_KEY; else process.env.JARBAS_WORKER_SYNC_KEY = prevKey;
    }
  };
}

// ---------- validação de entrada (antes de qualquer chamada de rede) ----------
{
  const { sql } = makeMockSql();
  assert.equal((await cmdChat(sql, {}, "1.2.3.4")).status, 400, "sem messages -> 400");
  assert.equal((await cmdChat(sql, { messages: [{ role: "user", content: "   " }] }, "1.2.3.4")).status, 400, "mensagem vazia -> 400");
  const longo = "x".repeat(2001);
  assert.equal((await cmdChat(sql, { messages: [{ role: "user", content: longo }] }, "1.2.3.4")).status, 400, "mensagem > 2000 caracteres -> 400");
}
console.log("cmdChat (validação de entrada): OK");

// ---------- sem WORKER_URL/JARBAS_WORKER_SYNC_KEY configurados -> 500, nunca trava ----------
{
  const { sql } = makeMockSql();
  const r = await cmdChat(sql, { messages: [{ role: "user", content: "oi" }] }, "1.2.3.4");
  assert.equal(r.status, 500);
  assert.equal(r.data.error, "worker_not_configured");
}
console.log("cmdChat (Worker não configurado -> 500 claro): OK");

// ---------- rate limit: 30 mensagens/10min por IP, a 31ª é bloqueada ----------
await withWorkerEnv(async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ reply: "ok", emotion: "neutro" }) });
  try {
    const { sql } = makeMockSql();
    for (let i = 0; i < 30; i++) {
      const r = await cmdChat(sql, { messages: [{ role: "user", content: `msg ${i}` }] }, "9.9.9.9");
      assert.equal(r.status, 200, `mensagem ${i + 1}/30 deveria passar`);
    }
    const r31 = await cmdChat(sql, { messages: [{ role: "user", content: "mais uma" }] }, "9.9.9.9");
    assert.equal(r31.status, 429, "31ª mensagem no mesmo IP/janela -> bloqueada");
    assert.equal(r31.data.error, "rate_limited");
    assert.ok(r31.data.retryAfterSeconds > 0);

    // IP diferente não é afetado pelo limite do outro
    const outroIp = await cmdChat(sql, { messages: [{ role: "user", content: "oi" }] }, "1.1.1.1");
    assert.equal(outroIp.status, 200, "outro IP tem sua própria janela, independente");
  } finally {
    globalThis.fetch = originalFetch;
  }
})();
console.log("cmdChat (rate limit 30/10min por IP): OK");

// ---------- Worker HTTP erro / inalcançável / resposta inválida -> 502, nunca trava ----------
await withWorkerEnv(async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: false, status: 500 });
    const { sql } = makeMockSql();
    assert.equal((await cmdChat(sql, { messages: [{ role: "user", content: "oi" }] }, "2.2.2.2")).status, 502, "Worker respondeu erro HTTP -> 502");

    globalThis.fetch = async () => { throw new Error("network down"); };
    assert.equal((await cmdChat(sql, { messages: [{ role: "user", content: "oi" }] }, "2.2.2.3")).status, 502, "Worker inalcançável -> 502");

    globalThis.fetch = async () => ({ ok: true, json: async () => ({ semReply: true }) });
    assert.equal((await cmdChat(sql, { messages: [{ role: "user", content: "oi" }] }, "2.2.2.4")).status, 502, "resposta sem campo reply -> 502");
  } finally {
    globalThis.fetch = originalFetch;
  }
})();
console.log("cmdChat (Worker erro/inalcançável/resposta inválida -> 502): OK");

// ---------- caminho feliz: manda a mensagem, recebe a resposta, guarda snapshot pra Desfazer ----------
await withWorkerEnv(async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody = null;
  globalThis.fetch = async (url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return {
      ok: true,
      json: async () => ({ reply: "Pronto, criei a tarefa.", emotion: "confirmado", cards: null, tools_used: ["gerenciar_tarefa"] }),
    };
  };
  try {
    const { sql, store } = makeMockSql();
    store.set("tasks_v1", JSON.stringify([{ id: 1, text: "tarefa antiga" }]));
    store.set(
      "jarbas_memory_v1",
      JSON.stringify({ memory: "gosta de café", items: [{ id: "a" }], shortcuts: [{ gatilho: "oi" }] })
    );

    const r = await cmdChat(sql, { messages: [{ role: "user", content: "@jarbas cria a tarefa comprar tinta em De Hoje" }] }, "3.3.3.3");
    assert.equal(r.status, 200);
    assert.equal(r.data.reply, "Pronto, criei a tarefa.");
    assert.equal(r.data.emotion, "confirmado");
    assert.equal(r.data.undo.length, 1, "uma ferramenta de escrita rodou -> um item de desfazer");
    assert.equal(r.data.undo[0].label, "tarefa");

    // manda companionState.origem="painel" e a chave do Worker, nunca a JARBAS_API_KEY
    assert.equal(capturedBody.mode, "companion");
    assert.equal(capturedBody.key, "segredo-worker");
    assert.equal(capturedBody.companionState.origem, "painel");
    assert.equal(capturedBody.companionState.memory, "gosta de café");
    assert.deepEqual(capturedBody.companionState.items, [{ id: "a" }]);

    // o snapshot guardado é o estado de ANTES da chamada (tasks_v1 tinha só "tarefa antiga")
    const undoId = r.data.undo[0].id;
    const record = getJson(store, "jarbas_undo:" + undoId);
    assert.ok(record, "guardou o registro de desfazer");
    assert.equal(record.collection, "tasks_v1");
    assert.deepEqual(record.before, [{ id: 1, text: "tarefa antiga" }]);
    assert.equal(record.used, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
})();
console.log("cmdChat (caminho feliz: resposta + snapshot de desfazer): OK");

// ---------- sem tools_used -> sem item de desfazer ----------
await withWorkerEnv(async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ reply: "Você tem 2 reuniões hoje.", emotion: "neutro" }) });
  try {
    const { sql } = makeMockSql();
    const r = await cmdChat(sql, { messages: [{ role: "user", content: "o que eu tenho hoje?" }] }, "4.4.4.4");
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.undo, [], "pergunta sem ação de escrita -> nada pra desfazer");
  } finally {
    globalThis.fetch = originalFetch;
  }
})();
console.log("cmdChat (sem ferramenta de escrita -> undo vazio): OK");

// ---------- cmdDesfazer: restaura a coleção, marca usado, loga no Diário com canal painel ----------
{
  const { sql, store } = makeMockSql();
  store.set("tasks_v1", JSON.stringify([{ id: 1, text: "comprar tinta" }, { id: 2, text: "nova" }]));
  store.set("jarbas_undo:abc", JSON.stringify({ collection: "tasks_v1", before: [{ id: 1, text: "comprar tinta" }], createdAt: Date.now(), used: false }));

  const r = await cmdDesfazer(sql, "abc");
  assert.equal(r.status, 200);
  assert.deepEqual(getList(store, "tasks_v1"), [{ id: 1, text: "comprar tinta" }], "restaurou a coleção pro estado de antes");
  const record = getJson(store, "jarbas_undo:abc");
  assert.equal(record.used, true, "marca usado (não dá pra desfazer duas vezes)");

  // logou no Diário
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const log = getList(store, `jarbas_log_${hoje}`);
  assert.equal(log.length, 1);
  assert.equal(log[0].origem, "painel");
  assert.equal(log[0].detalhes.canal, "painel");
}
console.log("cmdDesfazer (restaura + marca usado + loga no Diário): OK");

// ---------- cmdDesfazer: não encontrado, já usado, expirado ----------
{
  const { sql, store } = makeMockSql();
  assert.equal((await cmdDesfazer(sql, "nao-existe")).status, 404);

  store.set("jarbas_undo:usado", JSON.stringify({ collection: "tasks_v1", before: [], createdAt: Date.now(), used: true }));
  assert.equal((await cmdDesfazer(sql, "usado")).status, 410, "já usado -> não desfaz de novo");

  store.set("jarbas_undo:velho", JSON.stringify({ collection: "tasks_v1", before: [], createdAt: Date.now() - 11 * 60 * 1000, used: false }));
  assert.equal((await cmdDesfazer(sql, "velho")).status, 410, "mais de 10 minutos -> expirado");

  assert.equal((await cmdDesfazer(sql, "")).status, 400, "sem id -> 400");
}
console.log("cmdDesfazer (não encontrado/já usado/expirado): OK");

// ---------- buildCompanionStateFromMem: shape e defaults ----------
{
  const vazio = buildCompanionStateFromMem(null);
  assert.equal(vazio.origem, "painel");
  assert.equal(vazio.podeMaterializarEspontaneo, false, "sem rosto no painel pra materializar algo nele");
  assert.deepEqual(vazio.items, []);
  assert.deepEqual(vazio.shortcuts, []);
  assert.ok(vazio.hojeISO);

  const cheio = buildCompanionStateFromMem({ memory: "x", items: [{ id: 1 }], perfil: { pessoal: ["y"] } });
  assert.equal(cheio.memory, "x");
  assert.deepEqual(cheio.items, [{ id: 1 }]);
  assert.deepEqual(cheio.perfil, { pessoal: ["y"] });
}
console.log("buildCompanionStateFromMem (shape e defaults): OK");

console.log("_jarbas-ponte.test.mjs: todos os testes passaram");
