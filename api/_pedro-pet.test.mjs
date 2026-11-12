import assert from "node:assert/strict";
import { handleChat } from "./pedro.js";
import {
  PEDRO_TOOLS, PEDRO_MANIAS_SEED, applyManiasSeed, addMemory, buildSystemPrompt, pickFallbackReply, PEDRO_FALLBACK_REPLIES,
} from "./_pedro-pet-lib.js";

const ORIGINAL_FETCH = globalThis.fetch;
const ENV_KEYS = ["GROQ_API_KEY", "OPENAI_API_KEY", "PEDRO_LLM_ORDER"];
function clearEnv() { for (const k of ENV_KEYS) delete process.env[k]; }

// sql falso (tagged template) só com o que o Pedro usa: sync_kv SELECT/INSERT. Registra as chaves tocadas.
function fakeSql(initial = {}) {
  const store = Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
  const touched = [];
  const sql = async (strings, ...values) => {
    const q = strings.join("?");
    if (/SELECT value FROM sync_kv/.test(q)) { touched.push(values[0]); return store[values[0]] !== undefined ? [{ value: store[values[0]] }] : []; }
    if (/INSERT INTO sync_kv/.test(q)) { touched.push(values[0]); store[values[0]] = values[1]; return []; }
    throw new Error(`SQL inesperado no Pedro: ${q}`);
  };
  sql.read = (k) => (store[k] === undefined ? undefined : JSON.parse(store[k]));
  sql.touched = touched;
  return sql;
}

// ---------- tools: só save_memory (nada de painel) ----------
{
  assert.deepEqual(PEDRO_TOOLS.map(t => t.function.name), ["save_memory"]);
  console.log("tools do Pedro: só save_memory: OK");
}

// ---------- seed de manias: idempotente e sem sobrescrever ----------
{
  const existentes = [{ id: 1, text: "O Gustavo tem uma esposa chamada Aline.", at: "2026-01-01T00:00:00.000Z" }];
  const r1 = applyManiasSeed(existentes, null, "2026-11-12T10:00:00.000Z");
  assert.equal(r1.changed, true);
  assert.equal(r1.memories.length, 1 + PEDRO_MANIAS_SEED.length);
  assert.ok(r1.memories.some(m => m.id === 1), "memória existente preservada");
  assert.ok(r1.memories.filter(m => m.seed).every(m => m.categoria === "mania_do_pedro" && m.origem === "gustavo"));
  assert.ok(r1.pet.seeds.manias_v1);
  // 2ª vez: não muda nada
  const r2 = applyManiasSeed(r1.memories, r1.pet);
  assert.equal(r2.changed, false);
  // se o Gustavo apagar uma mania, ela NÃO ressurge
  const semUma = r1.memories.filter(m => m.id !== "seed_mania_caixas");
  const r3 = applyManiasSeed(semUma, r1.pet);
  assert.equal(r3.changed, false);
  assert.equal(r3.memories.some(m => m.id === "seed_mania_caixas"), false);
  // preserva campos extras do pet existente
  const r4 = applyManiasSeed([], { versao: 1, humor: "calmo" });
  assert.equal(r4.pet.humor, "calmo");
  console.log("seed de manias (idempotente, sem sobrescrever): OK");
}

// ---------- addMemory: duplicata, categoria, teto preserva manias ----------
{
  let mem = applyManiasSeed([], null).memories;
  let r = addMemory(mem, "A Aline faz aniversário em 3 de setembro.", { categoria: "pessoa", id: 100 });
  assert.equal(r.added, true);
  assert.equal(r.memories.at(-1).categoria, "pessoa");
  assert.equal(addMemory(r.memories, "a aline faz aniversário em 3 de setembro", {}).added, false, "duplicada");
  assert.equal(addMemory(r.memories, "   ", {}).added, false);
  assert.equal(addMemory(r.memories, "fato", { categoria: "inventada" }).memories.at(-1).categoria, undefined, "categoria inválida ignorada");
  mem = r.memories;
  for (let i = 0; i < 120; i++) mem = addMemory(mem, `fato numero ${i} unico ${i * 7919}`, { id: 1000 + i }).memories;
  assert.ok(mem.length <= 80);
  assert.equal(mem.filter(m => m.categoria === "mania_do_pedro").length, PEDRO_MANIAS_SEED.length, "manias sobrevivem ao teto");
  console.log("addMemory: OK");
}

// ---------- prompt: pet, sem assistente ----------
{
  const memories = applyManiasSeed([{ id: 1, text: "O Gustavo foi à Money Week.", at: "2026-11-10T12:00:00.000Z" }], null).memories;
  const p = buildSystemPrompt({ memories, learned: [{ text: "Sempre me chame de chefe" }], now: new Date("2026-11-12T15:00:00Z") });
  assert.match(p, /o gato do Gustavo/);
  assert.match(p, /dono e seu melhor amigo/);
  assert.match(p, /Manias e jeitos do Pedro/);
  assert.match(p, /mala aberta/);
  assert.match(p, /há 2 dias\) O Gustavo foi à Money Week/);
  assert.match(p, /Sempre me chame de chefe/);
  assert.match(p, /isso é com o Jarbas/);
  assert.match(p, /nunca finge|NUNCA finge/i);
  assert.match(p, /não finge ser a alma|encena morte/);
  assert.match(p, /Nunca cobre/);
  assert.doesNotMatch(p, /get_agenda|get_weather|add_task|pay_bill|add_event/);
  assert.doesNotMatch(p, /Painel de Controle/);
  // estado/diário vazios: nenhum bloco
  assert.doesNotMatch(p, /Seu estado agora|diário recente/);
  const comEstado = buildSystemPrompt({ memories: [], petState: { humor: "sonolento", atividade: { tipo: "dormir" } }, diary: [{ texto: "Dormi na mala." }] });
  assert.match(comEstado, /humor: sonolento/);
  assert.match(comEstado, /Dormi na mala/);
  console.log("prompt do pet: OK");
}

// ---------- chat: aprenda continua ----------
{
  clearEnv();
  globalThis.fetch = async () => { throw new Error("aprenda não pode chamar LLM"); };
  const sql = fakeSql();
  const r = await handleChat(sql, { message: "aprenda: quando eu disser boa noite, ronrone" });
  assert.equal(r.status, 200);
  assert.match(r.body.reply, /Anotado/);
  assert.equal(sql.read("pedro_learned_v1")[0].text, "quando eu disser boa noite, ronrone");
  assert.equal((await handleChat(sql, { message: "  " })).status, 400);
  globalThis.fetch = ORIGINAL_FETCH;
  console.log("chat: aprenda continua: OK");
}

// ---------- chat: fallback sem chaves de LLM (sem keywords, sem intents) ----------
{
  clearEnv();
  globalThis.fetch = async () => { throw new Error("sem chave, não deveria chamar fetch"); };
  const sql = fakeSql();
  const r = await handleChat(sql, { message: "qual minha agenda de hoje?", history: [] });
  assert.equal(r.status, 200);
  assert.equal(r.body.engine, "fallback");
  assert.equal(r.body.fallbackMotivo, "sem_chave");
  assert.ok(PEDRO_FALLBACK_REPLIES.includes(r.body.reply));
  assert.doesNotMatch(r.body.reply, /agenda|tarefa|conta/i);
  assert.equal(pickFallbackReply(() => 0), PEDRO_FALLBACK_REPLIES[0]);
  globalThis.fetch = ORIGINAL_FETCH;
  console.log("chat: fallback sem Groq/OpenAI: OK");
}

// ---------- chat: caminho LLM com save_memory; só chaves pedro_* ----------
{
  clearEnv();
  process.env.GROQ_API_KEY = "g";
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    if (calls.length === 1) {
      return { ok: true, json: async () => ({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "save_memory", arguments: JSON.stringify({ fact: "O Gustavo vai viajar para Floripa em 20 de dezembro.", categoria: "plano" }) } }] } }] }) };
    }
    return { ok: true, json: async () => ({ choices: [{ message: { role: "assistant", content: "Floripa! *balança o rabo* 🐾" } }] }) };
  };
  const sql = fakeSql({ pedro_learned_v1: [{ id: 1, text: "me chame de Pedrão" }] });
  const r = await handleChat(sql, { message: "Vou viajar pra Floripa dia 20 de dezembro!", history: [{ from: "user", text: "oi", at: Date.now() - 3600_000 }] });
  assert.equal(r.status, 200);
  assert.equal(r.body.reply, "Floripa! *balança o rabo* 🐾");
  assert.equal(r.body.engine, "groq");
  assert.deepEqual(calls[0].tools.map(t => t.function.name), ["save_memory"]);
  assert.match(calls[0].messages[0].content, /o gato do Gustavo/);
  assert.match(calls[0].messages[0].content, /me chame de Pedrão/);
  assert.match(calls[0].messages[0].content, /Manias e jeitos do Pedro/, "manias semeadas entram no prompt");
  const mem = sql.read("pedro_memory_v1");
  assert.ok(mem.some(m => /Floripa/.test(m.text) && m.categoria === "plano"), "save_memory gravou com categoria");
  assert.ok(mem.some(m => m.seed), "seed gravado");
  assert.ok(sql.touched.length > 0 && sql.touched.every(k => k.startsWith("pedro_")), `só chaves pedro_*: ${[...new Set(sql.touched)]}`);
  globalThis.fetch = ORIGINAL_FETCH;
  clearEnv();
  console.log("chat: LLM + save_memory, só chaves pedro_*: OK");
}

console.log("_pedro-pet.test.mjs: todos os testes passaram");
