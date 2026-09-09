export const config = { runtime: "edge" };
import { neon } from "@neondatabase/serverless";

// ─────────────────────────────────────────────────────────────────────────
// CHATGPT — Fase 1 da integração do ChatGPT externo com o Gus OS.
//
// Endpoint dedicado, independente do Pedro (api/pedro.js, api/pedro-cron.js)
// e do Jarbas (api/jarbas.js) — nenhum dos dois é alterado ou importado aqui.
//
// Lê/escreve as MESMAS chaves do sync_kv que o front-end usa via useKV
// (tasks_v1, ideas_v1, diary_v1), seguindo o mesmo padrão já usado pelo
// Jarbas: ler o array inteiro da key, alterar em memória, regravar o
// array inteiro. Não usa /api/db.js (nem o branch de tabelas linha-a-linha,
// nem sequer o branch sync_kv dele) — fala com o Postgres diretamente.
//
// Autenticação: Authorization: Bearer <CHATGPT_API_SECRET>, nunca exposto
// ao navegador. Somente as 6 ações abaixo são permitidas; qualquer outra
// é rejeitada. Sem edição e sem exclusão nesta fase.
//
// Concorrência: assim como o front-end (useKV) e o Jarbas, a escrita é
// "ler → modificar em memória → regravar array inteiro" via
// INSERT ... ON CONFLICT (key) DO UPDATE, sem lock otimista nem
// transação que cubra o ciclo leitura+escrita. Isso é o padrão real já
// em produção (nenhum dos consumidores atuais do sync_kv — painel, Pedro,
// Jarbas — implementa proteção contra escrita concorrente). Risco
// conhecido e documentado: duas escritas quase simultâneas na mesma key
// (ex.: ChatGPT e Jarbas criando tarefas ao mesmo tempo) podem, em teoria,
// fazer uma sobrescrever a outra. Na prática o volume de escrita é baixo
// e o próprio painel já opera assim; não foi introduzida nenhuma
// fragilidade nova em relação ao que já existe — apenas mantido o padrão.
// Se isso virar problema real, a solução (fora do escopo desta fase)
// seria mover para uma transação SQL com leitura+escrita atômica.
// ─────────────────────────────────────────────────────────────────────────

// CORS restrito: sem wildcard. As chamadas desta integração são
// servidor-a-servidor (OpenAI → Vercel), não vêm de um navegador de
// terceiros, então não há necessidade de liberar Access-Control-Allow-Origin
// para "*". Mantemos o cabeçalho apenas para permitir um eventual preflight,
// sem abrir a porta para chamadas de qualquer origem no browser.
const CORS = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

const PRIOS = ["alta", "normal", "baixa"];
const MOOD_MAP = { bom: "🙂", otimo: "😄", ótimo: "😄", ruim: "😔", pessimo: "😤", péssimo: "😤", neutro: "🙂" };

function nowISO() {
  return new Date().toISOString();
}

function normalize(text) {
  return (text || "").toString().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function err(status, message) {
  return new Response(JSON.stringify({ ok: false, error: message }), { status, headers: CORS });
}

function ok(payload) {
  return new Response(JSON.stringify({ ok: true, ...payload }), { headers: CORS });
}

async function getKvList(sql, key) {
  const rows = await sql`SELECT value FROM sync_kv WHERE key=${key}`;
  if (!rows[0]) return [];
  try {
    const v = JSON.parse(rows[0].value);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function setKvList(sql, key, list) {
  const value = JSON.stringify(list);
  const ts = nowISO();
  await sql`INSERT INTO sync_kv (key, value, updated_at) VALUES (${key}, ${value}, ${ts})
            ON CONFLICT (key) DO UPDATE SET value=${value}, updated_at=${ts}`;
}

// ---------- Leitura ----------

async function lerTarefas(sql, params = {}) {
  let tasks = await getKvList(sql, "tasks_v1");
  const { status, prio, tag, busca } = params;
  if (status) tasks = tasks.filter(t => (t.status || (t.done ? "done" : "todo")) === status);
  if (prio) tasks = tasks.filter(t => t.prio === prio);
  if (tag) {
    const nq = normalize(tag);
    tasks = tasks.filter(t => (t.tags || []).some(x => normalize(x).includes(nq)));
  }
  if (busca) {
    const nq = normalize(busca);
    tasks = tasks.filter(t => normalize(t.text).includes(nq));
  }
  return tasks;
}

async function lerIdeias(sql, params = {}) {
  let ideas = await getKvList(sql, "ideas_v1");
  const { tag, busca } = params;
  if (tag) {
    const nq = normalize(tag);
    ideas = ideas.filter(e => normalize(e.tag).includes(nq));
  }
  if (busca) {
    const nq = normalize(busca);
    ideas = ideas.filter(e => normalize(e.text).includes(nq));
  }
  return ideas;
}

async function lerDiario(sql, params = {}) {
  let entries = await getKvList(sql, "diary_v1");
  const { data_inicio, data_fim, busca } = params;
  if (data_inicio) entries = entries.filter(e => (e.date || "").slice(0, 10) >= data_inicio);
  if (data_fim) entries = entries.filter(e => (e.date || "").slice(0, 10) <= data_fim);
  if (busca) {
    const nq = normalize(busca);
    entries = entries.filter(e => normalize(e.text).includes(nq));
  }
  return entries;
}

// ---------- Escrita ----------

async function criarTarefa(sql, params = {}) {
  const text = (params.text || "").toString().trim();
  if (!text) return { fieldError: "Campo obrigatório ausente: text" };
  const prio = PRIOS.includes(params.prio) ? params.prio : "normal";
  const tags = Array.isArray(params.tags) ? params.tags.filter(t => typeof t === "string") : [];
  let dueDate = null;
  if (params.dueDate) {
    const d = new Date(params.dueDate);
    if (!isNaN(d.getTime())) dueDate = d.toISOString();
  }
  const tasks = await getKvList(sql, "tasks_v1");
  const item = {
    id: Date.now(), // gerado sempre no servidor — nunca aceito do cliente
    text, prio, status: "todo", done: false, date: nowISO(),
    notes: [], updates: [], tags, dueDate,
  };
  await setKvList(sql, "tasks_v1", [item, ...tasks]);
  return { item };
}

async function criarIdeia(sql, params = {}) {
  const text = (params.text || "").toString().trim();
  if (!text) return { fieldError: "Campo obrigatório ausente: text" };
  const tag = typeof params.tag === "string" ? params.tag : "";
  const ideas = await getKvList(sql, "ideas_v1");
  const item = {
    id: Date.now(), // gerado sempre no servidor
    text, tag, mood: "💡", date: nowISO(),
  };
  await setKvList(sql, "ideas_v1", [item, ...ideas]);
  return { item };
}

async function anotarDiario(sql, params = {}) {
  const text = (params.text || "").toString().trim();
  if (!text) return { fieldError: "Campo obrigatório ausente: text" };
  const mood = MOOD_MAP[normalize(params.mood || "")] || "🙂";
  const entries = await getKvList(sql, "diary_v1");
  const item = {
    id: Date.now(), // gerado sempre no servidor
    text, mood, done: false, date: nowISO(),
  };
  await setKvList(sql, "diary_v1", [item, ...entries]);
  return { item };
}

const ACTIONS = new Set(["ler_tarefas", "criar_tarefa", "ler_ideias", "criar_ideia", "ler_diario", "anotar_diario"]);

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return err(405, "method_not_allowed");

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!process.env.CHATGPT_API_SECRET || token !== process.env.CHATGPT_API_SECRET) {
    return err(401, "unauthorized");
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return err(400, "invalid_json_body");
  }

  const { action, params } = body || {};
  if (!action || !ACTIONS.has(action)) {
    return err(400, "unknown_action");
  }

  try {
    const sql = neon(process.env.DATABASE_URL);

    if (action === "ler_tarefas") {
      const items = await lerTarefas(sql, params);
      return ok({ action, count: items.length, items });
    }
    if (action === "ler_ideias") {
      const items = await lerIdeias(sql, params);
      return ok({ action, count: items.length, items });
    }
    if (action === "ler_diario") {
      const items = await lerDiario(sql, params);
      return ok({ action, count: items.length, items });
    }
    if (action === "criar_tarefa") {
      const { item, fieldError } = await criarTarefa(sql, params);
      if (fieldError) return err(400, fieldError);
      return ok({ action, item });
    }
    if (action === "criar_ideia") {
      const { item, fieldError } = await criarIdeia(sql, params);
      if (fieldError) return err(400, fieldError);
      return ok({ action, item });
    }
    if (action === "anotar_diario") {
      const { item, fieldError } = await anotarDiario(sql, params);
      if (fieldError) return err(400, fieldError);
      return ok({ action, item });
    }
  } catch (e) {
    // Nunca vaza secrets nem stack trace em produção
    return err(500, "internal_error");
  }
}
