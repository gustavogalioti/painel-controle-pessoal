import { neon } from "@neondatabase/serverless";

// ─────────────────────────────────────────────────────────────────────────
// Biblioteca compartilhada do Gus OS — usada pelo endpoint genérico
// (api/chatgpt.js, mantido por compatibilidade) e pelos 6 endpoints
// dedicados em api/chatgpt/*.js (usados pelo Custom GPT, para permitir
// classificação de risco por operação via x-openai-isConsequential).
//
// Arquivos com "_" no início do nome (como este) não viram rotas na
// Vercel — é só um módulo importado pelos outros.
// ─────────────────────────────────────────────────────────────────────────

export const CORS = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

const PRIOS = ["alta", "normal", "baixa"];
const MOOD_MAP = { bom: "🙂", otimo: "😄", ótimo: "😄", ruim: "😔", pessimo: "😤", péssimo: "😤", neutro: "🙂" };
const DIARY_TYPES = ["pensamento", "acontecimento", "ideia", "conquista", "viagem", "trabalho", "link", "nota_tecnica"];

// Janela de deduplicação: se a mesma ação de criação for chamada de novo
// com o mesmo texto (normalizado) dentro desse intervalo, devolve o item
// já existente em vez de criar um duplicado. Cobre o caso do modelo
// repetir uma chamada (ex.: retry por timeout) sem inventar um sistema
// de idempotency key à parte.
const DEDUPE_WINDOW_MS = 20000;

// Log de auditoria — guardado no próprio sync_kv (sem tabela nova),
// lista com cap para não crescer indefinidamente.
const AUDIT_KEY = "chatgpt_audit_log_v1";
const AUDIT_CAP = 300;

export function nowISO() {
  return new Date().toISOString();
}

export function normalize(text) {
  return (text || "").toString().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function err(status, message) {
  return new Response(JSON.stringify({ ok: false, error: message }), { status, headers: CORS });
}

export function ok(payload) {
  return new Response(JSON.stringify({ ok: true, ...payload }), { headers: CORS });
}

export async function getKvList(sql, key) {
  const rows = await sql`SELECT value FROM sync_kv WHERE key=${key}`;
  if (!rows[0]) return [];
  try {
    const v = JSON.parse(rows[0].value);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export async function setKvList(sql, key, list) {
  const value = JSON.stringify(list);
  const ts = nowISO();
  await sql`INSERT INTO sync_kv (key, value, updated_at) VALUES (${key}, ${value}, ${ts})
            ON CONFLICT (key) DO UPDATE SET value=${value}, updated_at=${ts}`;
}

async function logAudit(sql, entry) {
  try {
    const log = await getKvList(sql, AUDIT_KEY);
    log.unshift({ ts: nowISO(), ...entry });
    await setKvList(sql, AUDIT_KEY, log.slice(0, AUDIT_CAP));
  } catch {
    // Log é best-effort — uma falha aqui nunca deve derrubar a ação real.
  }
}

// Procura, no topo da lista (mais recente), um item com texto igual
// (normalizado) criado há menos de DEDUPE_WINDOW_MS. Usado pelas 3 ações
// de criação para evitar duplicata em caso de chamada repetida.
function findRecentDuplicate(list, text) {
  const nText = normalize(text);
  const cutoff = Date.now() - DEDUPE_WINDOW_MS;
  for (const item of list.slice(0, 5)) {
    const itemTime = new Date(item.date).getTime();
    if (itemTime >= cutoff && normalize(item.text) === nText) return item;
  }
  return null;
}

export function requireAuth(req) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return !!process.env.CHATGPT_API_SECRET && token === process.env.CHATGPT_API_SECRET;
}

// Envelope comum para os 6 endpoints dedicados: cuida de método, auth,
// parse do body, chama a função da ação, formata resposta e loga.
export function makeHandler(actionName, fn) {
  return async function handler(req) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (req.method !== "POST") return err(405, "method_not_allowed");
    if (!requireAuth(req)) return err(401, "unauthorized");

    let body;
    try {
      body = await req.json();
    } catch {
      return err(400, "invalid_json_body");
    }

    const params = (body && typeof body === "object" && body.params) || body || {};

    try {
      const sql = neon(process.env.DATABASE_URL);
      const result = await fn(sql, params);
      if (result.fieldError) {
        await logAudit(sql, { action: actionName, params, result: "error", error: result.fieldError });
        return err(400, result.fieldError);
      }
      await logAudit(sql, {
        action: actionName,
        params,
        result: "ok",
        summary: result.item ? { id: result.item.id } : { count: result.count },
      });
      if (result.items !== undefined) return ok({ action: actionName, count: result.count, items: result.items });
      return ok({ action: actionName, item: result.item, deduplicated: !!result.deduplicated });
    } catch (e) {
      try {
        const sql = neon(process.env.DATABASE_URL);
        await logAudit(sql, { action: actionName, params, result: "error", error: "internal_error" });
      } catch {}
      return err(500, "internal_error");
    }
  };
}

// ---------- Leitura ----------

export async function lerTarefas(sql, params = {}) {
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
  return { items: tasks, count: tasks.length };
}

export async function lerIdeias(sql, params = {}) {
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
  return { items: ideas, count: ideas.length };
}

export async function lerDiario(sql, params = {}) {
  let entries = await getKvList(sql, "diary_v1");
  const { data_inicio, data_fim, busca, tag, type } = params;
  if (data_inicio) entries = entries.filter(e => (e.date || "").slice(0, 10) >= data_inicio);
  if (data_fim) entries = entries.filter(e => (e.date || "").slice(0, 10) <= data_fim);
  if (tag) {
    const nq = normalize(tag);
    entries = entries.filter(e => normalize(e.tag).includes(nq));
  }
  if (type && DIARY_TYPES.includes(type)) entries = entries.filter(e => e.type === type);
  if (busca) {
    const nq = normalize(busca);
    entries = entries.filter(e => normalize(e.text).includes(nq));
  }
  return { items: entries, count: entries.length };
}

// ---------- Escrita (com deduplicação) ----------

export async function criarTarefa(sql, params = {}) {
  const text = (params.text || "").toString().trim();
  if (!text) return { fieldError: "Campo obrigatório ausente: text" };
  const tasks = await getKvList(sql, "tasks_v1");
  const dup = findRecentDuplicate(tasks, text);
  if (dup) return { item: dup, deduplicated: true };

  const prio = PRIOS.includes(params.prio) ? params.prio : "normal";
  const tags = Array.isArray(params.tags) ? params.tags.filter(t => typeof t === "string") : [];
  let dueDate = null;
  if (params.dueDate) {
    const d = new Date(params.dueDate);
    if (!isNaN(d.getTime())) dueDate = d.toISOString();
  }
  const item = {
    id: Date.now(), // gerado sempre no servidor — nunca aceito do cliente
    text, prio, status: "todo", done: false, date: nowISO(),
    notes: [], updates: [], tags, dueDate,
  };
  await setKvList(sql, "tasks_v1", [item, ...tasks]);
  return { item };
}

export async function criarIdeia(sql, params = {}) {
  const text = (params.text || "").toString().trim();
  if (!text) return { fieldError: "Campo obrigatório ausente: text" };
  const ideas = await getKvList(sql, "ideas_v1");
  const dup = findRecentDuplicate(ideas, text);
  if (dup) return { item: dup, deduplicated: true };

  const tag = typeof params.tag === "string" ? params.tag : "";
  const item = {
    id: Date.now(), // gerado sempre no servidor
    text, tag, mood: "💡", date: nowISO(),
  };
  await setKvList(sql, "ideas_v1", [item, ...ideas]);
  return { item };
}

export async function anotarDiario(sql, params = {}) {
  const text = (params.text || "").toString().trim();
  if (!text) return { fieldError: "Campo obrigatório ausente: text" };
  const entries = await getKvList(sql, "diary_v1");
  const dup = findRecentDuplicate(entries, text);
  if (dup) return { item: dup, deduplicated: true };

  const mood = MOOD_MAP[normalize(params.mood || "")] || "🙂";
  const tag = typeof params.tag === "string" && params.tag.trim() ? params.tag.trim() : undefined;
  const type = DIARY_TYPES.includes(params.type) ? params.type : undefined;
  const item = {
    id: Date.now(), // gerado sempre no servidor
    text, mood, date: nowISO(),
    ...(tag ? { tag } : {}),
    ...(type ? { type } : {}),
  };
  await setKvList(sql, "diary_v1", [item, ...entries]);
  return { item };
}
