export const config = { runtime: "edge" };
import { neon } from "@neondatabase/serverless";
import { getValidToken } from "./google-calendar.js";
import { getValidToken as getOutlookToken } from "./outlook-calendar.js";
import { requireSession } from "./_auth-lib.js";

// ─────────────────────────────────────────────────────────────────────────
// JARBAS — ponte entre o companheiro de voz (Jarbas, repo separado) e os
// dados reais do Painel de Controle Pessoal (agenda, tarefas, contas).
//
// Independente do api/pedro.js — não importa nada de lá — mas lê/escreve as
// mesmas chaves do sync_kv (tasks_v1, finance_v1, events_v1), porque essa é
// a fonte real dos dados do painel, a mesma que o Pedro e o front-end usam.
//
// Protegido por uma chave simples (JARBAS_API_KEY), enviada pelo Worker do
// Jarbas em cada chamada — nunca exposta ao navegador. A única exceção é
// log_read (ver handler abaixo): aceita a chave do Worker OU uma sessão
// válida do painel (é a aba "Diário do Jarbas", chamada pelo navegador).
//
// Sem Access-Control-Allow-Origin liberado: o Worker chama isso de servidor
// pra servidor (CORS não se aplica) e o painel chama da própria origem.
// ─────────────────────────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-jarbas-key",
  "Content-Type": "application/json",
};

function normalize(text) {
  return (text || "").toString().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function todayISO() {
  // Data de "hoje" no fuso de Brasília, independente do fuso do servidor da função edge.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function fetchWithTimeout(url, opts, ms){
  const controller = new AbortController();
  const t = setTimeout(()=>controller.abort(), ms);
  try{
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

// Um único orçamento de tempo pra token+chamada da agenda (em vez de 4s pro token +
// 4s pra chamada, empilhados = até 8s por provedor) — corta o pior caso pela metade.
async function withDeadline(fn, ms, fallback) {
  try {
    return await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("deadline_exceeded")), ms)),
    ]);
  } catch {
    return fallback;
  }
}

function addDaysISO(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

async function getGoogleEventosDia(sql, dateStr) {
  return withDeadline(async () => {
    const token = await getValidToken(sql);
    if (!token) return [];
    const timeMin = `${dateStr}T00:00:00-03:00`;
    const timeMax = `${dateStr}T23:59:59-03:00`;
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime&maxResults=20`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return [];
    const d = await r.json();
    return (d.items || []).map(ev => ({
      title: ev.summary || "(sem título)",
      time: ev.start?.dateTime ? ev.start.dateTime.slice(11, 16) : "",
    }));
  }, 4500, []);
}

async function getOutlookEventosDia(sql, dateStr) {
  const start = new Date(`${dateStr}T00:00:00-03:00`);
  const timeMin = start.toISOString();
  const timeMax = new Date(start.getTime() + 24 * 3600 * 1000 - 1000).toISOString();

  const contas = await Promise.all(["personal", "corporate"].map((account) => withDeadline(async () => {
    const token = await getOutlookToken(sql, account);
    if (!token) return [];
    const url = `https://graph.microsoft.com/v1.0/me/calendarview?startDateTime=${encodeURIComponent(timeMin)}&endDateTime=${encodeURIComponent(timeMax)}&$orderby=start/dateTime&$top=50`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="America/Sao_Paulo"' } });
    if (!r.ok) return [];
    const d = await r.json();
    return (d.value || []).map(ev => ({
      title: ev.subject || "(sem título)",
      time: ev.start?.dateTime ? ev.start.dateTime.slice(11, 16) : "",
    }));
  }, 4500, [])));
  return contas.flat();
}

async function getKvList(sql, key) {
  const rows = await sql`SELECT value FROM sync_kv WHERE key=${key}`;
  if (!rows[0]) return [];
  try { const v = JSON.parse(rows[0].value); return Array.isArray(v) ? v : []; } catch { return []; }
}

async function setKvList(sql, key, list) {
  const value = JSON.stringify(list);
  const ts = new Date().toISOString();
  await sql`INSERT INTO sync_kv (key, value, updated_at) VALUES (${key}, ${value}, ${ts})
            ON CONFLICT (key) DO UPDATE SET value=${value}, updated_at=${ts}`;
}

// Igual getKvList/setKvList, mas pra um valor JSON qualquer (não necessariamente array) —
// usado pra guardar a memória inteira do Jarbas (mem.knowledge/timeline/routines/location).
async function getKvJson(sql, key) {
  const rows = await sql`SELECT value FROM sync_kv WHERE key=${key}`;
  if (!rows[0]) return null;
  try { return JSON.parse(rows[0].value); } catch { return null; }
}

async function setKvJson(sql, key, obj) {
  const value = JSON.stringify(obj);
  const ts = new Date().toISOString();
  await sql`INSERT INTO sync_kv (key, value, updated_at) VALUES (${key}, ${value}, ${ts})
            ON CONFLICT (key) DO UPDATE SET value=${value}, updated_at=${ts}`;
}

const JARBAS_MEMORY_KEY = "jarbas_memory_v1";
const JARBAS_RECADOS_KEY = "jarbas_recados_v1";

const FIN_RECURRENT_TYPES = ["fixed", "subscription", "income"];
function finCurMonth() { return todayISO().slice(0, 7); }
function finIsPaid(e) { return e.recurrent ? (e.paidMonths || []).includes(finCurMonth()) : !!e.paid; }

// ---------- Leitura (o que o Jarbas "sabe") ----------
// Item: "qual minha agenda" e "consultar_painel" precisavam ser separados — pedir só
// a agenda não devia vir empacotado com tarefas e contas (relatado como confuso/errado).
async function getAgendaDiaData(sql, dia) {
  const todayStr = todayISO();
  const targetStr = dia === "amanha" ? addDaysISO(todayStr, 1) : todayStr;
  const diaLabel = dia === "amanha" ? "amanhã" : "hoje";
  const [events, googleEventos, outlookEventos] = await Promise.all([
    getKvList(sql, "events_v1"),
    getGoogleEventosDia(sql, targetStr), getOutlookEventosDia(sql, targetStr),
  ]);
  const localDia = events.filter(e => e.date === targetStr).map(e => ({ title: e.title, time: e.time || "" }));
  const diaEventos = [...localDia, ...googleEventos, ...outlookEventos].sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  return { diaLabel, diaEventos };
}

function agendaLine(diaLabel, diaEventos) {
  return diaEventos.length
    ? `Agenda de ${diaLabel}: ${diaEventos.map(e => `${e.time ? e.time + " " : ""}${e.title}`).join("; ")}`
    : `Agenda de ${diaLabel}: livre, nenhum compromisso.`;
}

async function getAgendaOnlyText(sql, dia) {
  const { diaLabel, diaEventos } = await getAgendaDiaData(sql, dia);
  return agendaLine(diaLabel, diaEventos);
}

async function getSnapshotText(sql, dia) {
  const [{ diaLabel, diaEventos }, tasks, finance] = await Promise.all([
    getAgendaDiaData(sql, dia), getKvList(sql, "tasks_v1"), getKvList(sql, "finance_v1"),
  ]);
  const pendTasks = tasks.filter(t => (t.status || (t.done ? "done" : "todo")) !== "done");
  const pendBills = finance.filter(e => FIN_RECURRENT_TYPES.includes(e.type) && !finIsPaid(e));

  const partes = [];
  partes.push(agendaLine(diaLabel, diaEventos));
  partes.push(pendTasks.length
    ? `Tarefas pendentes (${pendTasks.length}): ${pendTasks.slice(0, 8).map(t => t.text + (t.prio === "alta" ? " [alta prioridade]" : "")).join("; ")}`
    : "Tarefas pendentes: nenhuma, tudo em dia.");
  if (pendBills.length) {
    const total = pendBills.reduce((s, e) => s + Number(e.value || 0), 0);
    const totalFmt = total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    partes.push(`Contas pendentes (${pendBills.length}, total ${totalFmt}): ` +
      pendBills.slice(0, 8).map(e => `${e.name} ${Number(e.value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}${e.dueDay ? ` (dia ${e.dueDay})` : ""}`).join("; "));
  } else {
    partes.push("Contas pendentes: nenhuma, tudo pago.");
  }
  return partes.join("\n");
}

// Item 12: filtro de tarefas por coluna real (o mesmo campo `status` usado nas colunas do painel).
const TASK_STATUS_LABELS = { now: "🔥 Para Agora", today: "🌟 De Hoje", todo: "📋 Pendente", doing: "⚡ Em Andamento", done: "✅ Concluído", standby: "⏸ Stand By" };
const TASK_FILTER_STATUSES = { agora: ["now"], hoje: ["now", "today"], pendentes: ["todo"], andamento: ["doing"] };
function getTaskStatus(t) { return t.status || (t.done ? "done" : "todo"); }

async function getTasksFilteredText(sql, filtro) {
  const tasks = await getKvList(sql, "tasks_v1");
  const wanted = TASK_FILTER_STATUSES[filtro];
  const list = wanted ? tasks.filter(t => wanted.includes(getTaskStatus(t))) : tasks.filter(t => getTaskStatus(t) !== "done");
  if (!list.length) return "Nenhuma tarefa encontrada com esse filtro.";
  return list.map(t => `- ${t.text}${t.prio === "alta" ? " [alta prioridade]" : ""} (${TASK_STATUS_LABELS[getTaskStatus(t)] || getTaskStatus(t)})`).join("\n");
}

// Item 5: Ideias, Lembretes e Listas — mesmas chaves sync_kv que as telas do painel usam.
async function getIdeasText(sql) {
  const ideas = await getKvList(sql, "ideas_v1");
  if (!ideas.length) return "Nenhuma ideia anotada ainda.";
  return ideas.slice(0, 10).map(i => `- ${i.text}${i.tag ? ` [${i.tag}]` : ""}`).join("\n");
}

async function getRemindersText(sql) {
  const list = await getKvList(sql, "reminders_v1");
  const pend = list.filter(r => !r.done);
  if (!pend.length) return "Nenhum lembrete pendente.";
  return pend.slice(0, 10).map(r => `- ${r.text}`).join("\n");
}

async function getListsText(sql) {
  const lists = await getKvList(sql, "lists_v1");
  if (!lists.length) return "Nenhuma lista criada ainda.";
  return lists.slice(0, 10).map(l => `- ${l.title} (${(l.items || []).length} itens)`).join("\n");
}

// ---------- Item 6: e-mail, só leitura (Gmail + Outlook Pessoal/Corporativo) ----------
// Nunca busca corpo completo nem anexos — só metadados (remetente, assunto, data, trecho).
async function getGoogleEmailsResumo(sql, filtro, remetente, assunto) {
  try {
    const token = await Promise.race([
      getValidToken(sql),
      new Promise((_, reject) => setTimeout(() => reject(new Error("google_token_timeout")), 4000)),
    ]);
    if (!token) return [];
    let q = filtro === "nao_lidos" ? "is:unread" : "in:inbox";
    if (remetente) q += ` from:${remetente}`;
    if (assunto) q += ` subject:${assunto}`;
    const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=8&q=${encodeURIComponent(q)}`;
    const listRes = await fetchWithTimeout(listUrl, { headers: { Authorization: `Bearer ${token}` } }, 4000);
    if (!listRes.ok) return [];
    const listData = await listRes.json();
    const ids = (listData.messages || []).map(m => m.id);
    const msgs = await Promise.all(ids.map(async id => {
      const r = await fetchWithTimeout(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${token}` } }, 4000
      );
      if (!r.ok) return null;
      const d = await r.json();
      const h = Object.fromEntries((d.payload?.headers || []).map(x => [x.name, x.value]));
      return {
        fonte: "Gmail",
        de: h.From || "",
        assunto: h.Subject || "",
        data: h.Date ? new Date(h.Date).toISOString() : "",
        trecho: d.snippet || "",
        lido: !(d.labelIds || []).includes("UNREAD"),
      };
    }));
    return msgs.filter(Boolean);
  } catch {
    return [];
  }
}

async function getOutlookEmailsResumo(sql, account, filtro, remetente, assunto) {
  try {
    const token = await Promise.race([
      getOutlookToken(sql, account),
      new Promise((_, reject) => setTimeout(() => reject(new Error("outlook_token_timeout")), 4000)),
    ]);
    if (!token) return [];
    const filters = [];
    if (filtro === "nao_lidos") filters.push("isRead eq false");
    if (remetente) filters.push(`contains(from/emailAddress/address,'${remetente.replace(/'/g, "")}')`);
    if (assunto) filters.push(`contains(subject,'${assunto.replace(/'/g, "")}')`);
    const filterQ = filters.length ? `&$filter=${encodeURIComponent(filters.join(" and "))}` : "";
    const url = `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=8&$orderby=receivedDateTime desc&$select=subject,from,receivedDateTime,bodyPreview,isRead${filterQ}`;
    const r = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } }, 4000);
    if (!r.ok) return [];
    const d = await r.json();
    return (d.value || []).map(m => ({
      fonte: account === "corporate" ? "Outlook Corporativo" : "Outlook Pessoal",
      de: m.from?.emailAddress?.address || m.from?.emailAddress?.name || "",
      assunto: m.subject || "",
      data: m.receivedDateTime || "",
      trecho: m.bodyPreview || "",
      lido: !!m.isRead,
    }));
  } catch {
    return [];
  }
}

async function getEmailsText(sql, filtro, remetente, assunto) {
  const [gmail, outlookPessoal, outlookCorp] = await Promise.all([
    getGoogleEmailsResumo(sql, filtro, remetente, assunto),
    getOutlookEmailsResumo(sql, "personal", filtro, remetente, assunto),
    getOutlookEmailsResumo(sql, "corporate", filtro, remetente, assunto),
  ]);
  const all = [...gmail, ...outlookPessoal, ...outlookCorp]
    .sort((a, b) => new Date(b.data) - new Date(a.data))
    .slice(0, 10);
  if (!all.length) return filtro === "nao_lidos" ? "Nenhum e-mail não lido." : "Nenhum e-mail encontrado com esse filtro.";
  return all.map(m => `- [${m.fonte}]${m.lido ? "" : " (não lido)"} de ${m.de} — "${m.assunto}": ${m.trecho}`).join("\n");
}

// Item 5 (comentário espontâneo): itens mais recentes de Ideias/Compromissos, com id/data
// crus (não texto formatado), pro Worker comparar com o que já viu e não repetir aviso.
async function getNovidades(sql) {
  const [ideas, events] = await Promise.all([getKvList(sql, "ideas_v1"), getKvList(sql, "events_v1")]);
  return {
    ideas: ideas.slice(0, 5).map(i => ({ id: i.id, text: i.text, date: i.date })),
    events: events.slice(0, 5).map(e => ({ id: e.id, title: e.title, date: e.date })),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Fase 2 (F2-0) — "Diário do Jarbas": registro permanente de tudo que o
// Jarbas ouviu, fez e viu. Guardado em sync_kv, uma chave por dia
// (jarbas_log_YYYY-MM-DD, fuso America/Sao_Paulo), valor = array JSON de
// eventos. Nunca apagado automaticamente (ver estimativa de crescimento no PR).
// ─────────────────────────────────────────────────────────────────────────
const LOG_TIPOS = new Set(["conversa", "acao_pedida", "acao_espontanea", "observacao_painel", "leitura", "aviso_enviado", "erro"]);
const LOG_ORIGENS = new Set(["usuario", "jarbas", "cron", "painel"]);
const LOG_MAX_EVENTOS_POR_CHAMADA = 50;
const LOG_RESUMO_MAX = 500;
const LOG_DETALHES_MAX_JSON = 1024; // ~1 KB serializado
const LOG_READ_LIMIT_DEFAULT = 200;
const LOG_READ_LIMIT_MAX = 1000;
const LOG_READ_MAX_DIAS = 180; // guarda contra um intervalo gigante gerar centenas de leituras no sync_kv

function diaKeySaoPaulo(iso) {
  const d = iso ? new Date(iso) : new Date();
  const base = isNaN(d) ? new Date() : d;
  const dateStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(base);
  return `jarbas_log_${dateStr}`;
}

function newLogId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// Valida e normaliza um evento cru vindo do Worker — nunca confia no shape recebido,
// descarta campos extras (só reconstrói com os campos esperados) e nunca deixa um
// evento sem tipo/origem válidos ou sem resumo entrar no log.
function clampLogEvento(raw) {
  if (!raw || typeof raw !== "object") return null;
  const tipo = LOG_TIPOS.has(raw.tipo) ? raw.tipo : null;
  const origem = LOG_ORIGENS.has(raw.origem) ? raw.origem : null;
  if (!tipo || !origem) return null;
  const resumo = String(raw.resumo || "").slice(0, LOG_RESUMO_MAX).trim();
  if (!resumo) return null;
  const atDate = raw.at ? new Date(raw.at) : new Date();
  const at = isNaN(atDate) ? new Date().toISOString() : atDate.toISOString();
  let detalhes = {};
  if (raw.detalhes && typeof raw.detalhes === "object") {
    try {
      const json = JSON.stringify(raw.detalhes);
      detalhes = json.length <= LOG_DETALHES_MAX_JSON ? raw.detalhes : { _truncado: true };
    } catch { detalhes = {}; }
  }
  return { id: newLogId(), at, tipo, origem, resumo, detalhes };
}

// Append atômico: a concatenação jsonb acontece dentro do próprio UPSERT, então duas
// chamadas simultâneas pro mesmo dia nunca perdem eventos uma da outra (Postgres
// serializa via lock de linha; a segunda espera a primeira e enxerga o valor já somado).
async function appendLogDia(sql, key, eventos) {
  const value = JSON.stringify(eventos);
  const ts = new Date().toISOString();
  await sql`
    INSERT INTO sync_kv (key, value, updated_at)
    VALUES (${key}, ${value}, ${ts})
    ON CONFLICT (key) DO UPDATE
    SET value = (COALESCE(sync_kv.value::jsonb, '[]'::jsonb) || ${value}::jsonb)::text,
        updated_at = ${ts}
  `;
}

async function cmdLogAppend(sql, eventosRaw) {
  if (!Array.isArray(eventosRaw) || !eventosRaw.length) return { ok: false, erro: "eventos_vazio" };
  const cleaned = eventosRaw.slice(0, LOG_MAX_EVENTOS_POR_CHAMADA).map(clampLogEvento).filter(Boolean);
  if (!cleaned.length) return { ok: false, erro: "nenhum_evento_valido" };

  const porDia = new Map();
  for (const ev of cleaned) {
    const key = diaKeySaoPaulo(ev.at);
    if (!porDia.has(key)) porDia.set(key, []);
    porDia.get(key).push(ev);
  }
  for (const [key, evs] of porDia) await appendLogDia(sql, key, evs);
  return { ok: true, gravados: cleaned.length };
}

function diaStrRange(desdeStr, ateStr) {
  const dias = [];
  let cur = desdeStr;
  let guard = 0;
  while (cur <= ateStr && guard < LOG_READ_MAX_DIAS) {
    dias.push(cur);
    cur = addDaysISO(cur, 1);
    guard++;
  }
  return dias;
}

// Sem `desde`/`ate`, lê os últimos 7 dias por padrão — evita varrer o log inteiro
// numa leitura simples; a aba do painel pode pedir um intervalo maior explicitamente.
async function getLogEventos(sql, { desde, ate, tipo, q, limite }) {
  const todayStr = todayISO();
  const desdeStr = (desde || "").slice(0, 10) || addDaysISO(todayStr, -7);
  const ateStr = (ate || "").slice(0, 10) || todayStr;
  const dayKeys = diaStrRange(desdeStr, ateStr).map(d => `jarbas_log_${d}`);
  if (!dayKeys.length) return [];

  const rows = await sql`SELECT value FROM sync_kv WHERE key = ANY(${dayKeys}::text[])`;
  let eventos = [];
  for (const row of rows) {
    try {
      const list = JSON.parse(row.value);
      if (Array.isArray(list)) eventos.push(...list);
    } catch { /* dia com valor corrompido — ignora só esse dia */ }
  }

  if (tipo) {
    const tipos = tipo.split(",").map(t => t.trim()).filter(Boolean);
    if (tipos.length) eventos = eventos.filter(e => tipos.includes(e.tipo));
  }
  if (q) {
    const nq = normalize(q);
    eventos = eventos.filter(e => normalize(e.resumo).includes(nq));
  }

  eventos.sort((a, b) => new Date(b.at) - new Date(a.at));
  const lim = Math.min(Math.max(parseInt(limite, 10) || LOG_READ_LIMIT_DEFAULT, 1), LOG_READ_LIMIT_MAX);
  return eventos.slice(0, lim);
}

// ---------- "mudancas": snapshot compacto de cada fonte, com hash por item ----------
// O Worker compara o hash de cada item com o que já viu da última vez, pra saber o que
// mudou sem precisar carregar (nem registrar no log) os dados completos de novo.
async function sha256Short(text) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

async function getKvListWithMeta(sql, key) {
  const rows = await sql`SELECT value, updated_at FROM sync_kv WHERE key=${key}`;
  if (!rows[0]) return { list: [], updated_at: null };
  let list = [];
  try { const v = JSON.parse(rows[0].value); list = Array.isArray(v) ? v : []; } catch { /* valor inválido vira lista vazia */ }
  return { list, updated_at: rows[0].updated_at };
}

async function compactSource(sql, key, mapItem) {
  const { list, updated_at } = await getKvListWithMeta(sql, key);
  const itens = await Promise.all(list.map(async (item) => {
    const mapped = mapItem(item);
    const hash = await sha256Short(JSON.stringify({ titulo: mapped.titulo, status: mapped.status, data: mapped.data }));
    return { ...mapped, hash };
  }));
  return { updated_at, itens };
}

async function getMudancas(sql) {
  const [tarefas, contas, agenda, ideias, lembretes, listas, diario, recados] = await Promise.all([
    compactSource(sql, "tasks_v1", t => ({ id: t.id, titulo: String(t.text || "").slice(0, 120), status: getTaskStatus(t), data: t.date || null })),
    compactSource(sql, "finance_v1", e => ({ id: e.id, titulo: String(e.name || "").slice(0, 120), status: FIN_RECURRENT_TYPES.includes(e.type) ? (finIsPaid(e) ? "paga" : "pendente") : null, data: e.dueDay != null ? String(e.dueDay) : null })),
    compactSource(sql, "events_v1", e => ({ id: e.id, titulo: String(e.title || "").slice(0, 120), status: e.cat || null, data: e.date || null })),
    compactSource(sql, "ideas_v1", i => ({ id: i.id, titulo: String(i.text || "").slice(0, 120), status: null, data: i.date || null })),
    compactSource(sql, "reminders_v1", r => ({ id: r.id, titulo: String(r.text || "").slice(0, 120), status: r.done ? "feito" : "pendente", data: r.date || null })),
    compactSource(sql, "lists_v1", l => ({ id: l.id, titulo: String(l.title || "").slice(0, 120), status: null, data: l.created || null })),
    compactSource(sql, "diary_v1", d => ({ id: d.id, titulo: String(d.text || "").slice(0, 80), status: null, data: d.date || null })),
    compactSource(sql, JARBAS_RECADOS_KEY, r => ({ id: r.id, titulo: String(r.text || "").slice(0, 120), status: r.done ? "tratado" : "pendente", data: r.at || null })),
  ]);
  return { tarefas, contas, agenda, ideias, lembretes, listas, diario, recados };
}

// ---------- Ações (o que o Jarbas pode "fazer") ----------
async function cmdAddTask(sql, texto) {
  if (!texto) return { reply: "Faltou dizer o texto da tarefa." };
  const tasks = await getKvList(sql, "tasks_v1");
  const t = { id: Date.now(), text: texto, prio: "normal", status: "todo", done: false, date: new Date().toISOString(), notes: [], updates: [], inbox: true };
  await setKvList(sql, "tasks_v1", [t, ...tasks]);
  return { reply: `Criei a tarefa "${texto}".` };
}

async function cmdCompleteTask(sql, texto) {
  const tasks = await getKvList(sql, "tasks_v1");
  const nq = normalize(texto);
  const match = tasks.find(t => normalize(t.text).includes(nq) && (t.status || (t.done ? "done" : "todo")) !== "done");
  if (!match) return { reply: `Não achei nenhuma tarefa pendente parecida com "${texto}".` };
  const updated = tasks.map(t => t.id === match.id ? { ...t, status: "done", done: true } : t);
  await setKvList(sql, "tasks_v1", updated);
  return { reply: `Marquei "${match.text}" como concluída.` };
}

async function cmdDeleteTask(sql, texto) {
  const tasks = await getKvList(sql, "tasks_v1");
  const nq = normalize(texto);
  const match = tasks.find(t => normalize(t.text).includes(nq));
  if (!match) return { reply: `Não achei nenhuma tarefa parecida com "${texto}".` };
  await setKvList(sql, "tasks_v1", tasks.filter(t => t.id !== match.id));
  return { reply: `Apaguei a tarefa "${match.text}".` };
}

async function cmdPayBill(sql, nome) {
  const list = await getKvList(sql, "finance_v1");
  const nq = normalize(nome);
  const match = list.find(e => FIN_RECURRENT_TYPES.includes(e.type) && normalize(e.name).includes(nq) && !finIsPaid(e));
  if (!match) return { reply: `Não achei nenhuma conta pendente parecida com "${nome}".` };
  const month = finCurMonth();
  const updated = list.map(e => e.id !== match.id ? e : (e.recurrent ? { ...e, paidMonths: [...(e.paidMonths || []), month] } : { ...e, paid: true }));
  await setKvList(sql, "finance_v1", updated);
  return { reply: `Marquei "${match.name}" como paga.` };
}

async function cmdDeleteBill(sql, nome) {
  const list = await getKvList(sql, "finance_v1");
  const nq = normalize(nome);
  const match = list.find(e => normalize(e.name).includes(nq));
  if (!match) return { reply: `Não achei nada nas finanças parecido com "${nome}".` };
  await setKvList(sql, "finance_v1", list.filter(e => e.id !== match.id));
  return { reply: `Apaguei "${match.name}" das finanças.` };
}

async function cmdAddEvent(sql, { titulo, data, hora }) {
  if (!titulo || !data) return { reply: "Faltou o título ou a data pra criar o compromisso." };
  const events = await getKvList(sql, "events_v1");
  const ev = { id: Date.now(), title: titulo, date: data, time: hora || "", local: "", cat: "Pessoal", notes: "" };
  await setKvList(sql, "events_v1", [ev, ...events]);
  const [, m, d] = data.split("-");
  return { reply: `Criei o compromisso "${titulo}" pra ${d}/${m}${hora ? ` às ${hora}` : ""}.` };
}

async function cmdDeleteEvent(sql, titulo) {
  const events = await getKvList(sql, "events_v1");
  const nq = normalize(titulo);
  const match = events.find(e => normalize(e.title).includes(nq));
  if (!match) return { reply: `Não achei nenhum compromisso parecido com "${titulo}".` };
  await setKvList(sql, "events_v1", events.filter(e => e.id !== match.id));
  return { reply: `Cancelei "${match.title}" da agenda.` };
}

export async function cmdAnotarDiario(sql, { texto, humor }) {
  if (!texto || !texto.trim()) return { reply: "" };
  const moodMap = { bom: "🙂", otimo: "😄", ruim: "😔", pessimo: "😤", neutro: "🙂" };
  const mood = moodMap[normalize(humor || "")] || "🙂";
  const entries = await getKvList(sql, "diary_v1");
  const id = Date.now();
  // origem: "jarbas" marca que ESTA entrada pode ser desfeita/corrigida depois pelo
  // próprio Jarbas (ver cmdDesfazerDiario/cmdCorrigirDiario) — entradas escritas pelo
  // Gustavo direto no painel nunca têm esse campo, então nunca são elegíveis.
  const entry = { id, text: texto.trim(), mood, date: new Date().toISOString(), origem: "jarbas" };
  await setKvList(sql, "diary_v1", [entry, ...entries]);
  return { reply: "", id }; // ação de bastidor, não vira fala; id devolvido pro Worker, se precisar
}

// Janela de segurança pra desfazer/corrigir: só entradas criadas pelo próprio Jarbas
// (nunca pelo Gustavo) e só dentro das últimas 24h — depois disso, vira "corrija com uma
// entrada nova", nunca mais mexe na antiga.
const DIARY_UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isEligibleJarbasEntry(entry, nowMs) {
  if (!entry || entry.origem !== "jarbas") return false;
  const created = new Date(entry.date).getTime();
  if (isNaN(created)) return false;
  return (nowMs - created) <= DIARY_UNDO_WINDOW_MS;
}

export function findEligibleDiaryEntry(entries, id, nowMs) {
  // entries já vem ordenado do mais recente pro mais antigo (toda escrita faz
  // [entry, ...entries]) — sem id, o primeiro match é automaticamente o mais recente.
  if (id != null) {
    const target = entries.find(e => e.id === id);
    return isEligibleJarbasEntry(target, nowMs) ? target : null;
  }
  return entries.find(e => isEligibleJarbasEntry(e, nowMs)) || null;
}

export async function cmdDesfazerDiario(sql, { id } = {}) {
  const entries = await getKvList(sql, "diary_v1");
  const target = findEligibleDiaryEntry(entries, id, Date.now());
  if (!target) return { reply: "", ok: false, motivo: "Não achei anotação minha recente para desfazer." };

  // Nunca apaga de vez — move pra lixeira, recuperável manualmente se precisar.
  const trash = await getKvList(sql, "diary_trash_v1");
  await setKvList(sql, "diary_trash_v1", [{ ...target, deletedAt: new Date().toISOString() }, ...trash]);
  await setKvList(sql, "diary_v1", entries.filter(e => e.id !== target.id));

  await cmdLogAppend(sql, [{
    tipo: "acao_pedida", origem: "jarbas",
    resumo: `Desfez a própria anotação no diário: "${String(target.text || "").slice(0, 120)}".`,
    detalhes: { ferramenta: "desfazer_diario", ok: true, id: target.id },
  }]);

  return { reply: "", ok: true, texto: target.text };
}

export async function cmdCorrigirDiario(sql, { novoTexto, id } = {}) {
  if (!novoTexto || !novoTexto.trim()) return { reply: "", ok: false, motivo: "Faltou o novo texto da correção." };
  const entries = await getKvList(sql, "diary_v1");
  const target = findEligibleDiaryEntry(entries, id, Date.now());
  if (!target) return { reply: "", ok: false, motivo: "Não achei anotação minha recente para corrigir." };

  const textoAnterior = target.text;
  const edicoes = Array.isArray(target.edicoes) ? target.edicoes : [];
  const updatedEntry = {
    ...target,
    text: novoTexto.trim(),
    edicoes: [...edicoes, { textoAnterior, em: new Date().toISOString() }],
  };
  await setKvList(sql, "diary_v1", entries.map(e => e.id === target.id ? updatedEntry : e));

  await cmdLogAppend(sql, [{
    tipo: "acao_pedida", origem: "jarbas",
    resumo: `Corrigiu a própria anotação no diário, de "${String(textoAnterior || "").slice(0, 80)}" para "${String(updatedEntry.text || "").slice(0, 80)}".`,
    detalhes: { ferramenta: "corrigir_diario", ok: true, id: target.id },
  }]);

  return { reply: "", ok: true, texto: updatedEntry.text, textoAnterior };
}

// ---------- Item 5: Ideias, Lembretes, Listas ----------
async function cmdAddIdea(sql, texto) {
  if (!texto) return { reply: "Faltou o texto da ideia." };
  const ideas = await getKvList(sql, "ideas_v1");
  const idea = { id: Date.now(), text: texto, tag: "", mood: "💡", date: new Date().toISOString() };
  await setKvList(sql, "ideas_v1", [idea, ...ideas]);
  return { reply: `Anotei a ideia: "${texto}".` };
}

async function cmdDeleteIdea(sql, texto) {
  const ideas = await getKvList(sql, "ideas_v1");
  const nq = normalize(texto);
  const match = ideas.find(i => normalize(i.text).includes(nq));
  if (!match) return { reply: `Não achei nenhuma ideia parecida com "${texto}".` };
  await setKvList(sql, "ideas_v1", ideas.filter(i => i.id !== match.id));
  return { reply: `Apaguei a ideia "${match.text}".` };
}

async function cmdAddReminder(sql, texto) {
  if (!texto) return { reply: "Faltou o texto do lembrete." };
  const list = await getKvList(sql, "reminders_v1");
  const item = { id: Date.now(), text: texto, mood: "🔔", done: false, date: new Date().toISOString() };
  await setKvList(sql, "reminders_v1", [item, ...list]);
  return { reply: `Criei o lembrete "${texto}".` };
}

async function cmdCompleteReminder(sql, texto) {
  const list = await getKvList(sql, "reminders_v1");
  const nq = normalize(texto);
  const match = list.find(r => !r.done && normalize(r.text).includes(nq));
  if (!match) return { reply: `Não achei nenhum lembrete pendente parecido com "${texto}".` };
  const updated = list.map(r => r.id === match.id ? { ...r, done: true } : r);
  await setKvList(sql, "reminders_v1", updated);
  return { reply: `Marquei o lembrete "${match.text}" como feito.` };
}

async function cmdDeleteReminder(sql, texto) {
  const list = await getKvList(sql, "reminders_v1");
  const nq = normalize(texto);
  const match = list.find(r => normalize(r.text).includes(nq));
  if (!match) return { reply: `Não achei nenhum lembrete parecido com "${texto}".` };
  await setKvList(sql, "reminders_v1", list.filter(r => r.id !== match.id));
  return { reply: `Apaguei o lembrete "${match.text}".` };
}

async function cmdAddList(sql, titulo) {
  if (!titulo) return { reply: "Faltou o título da lista." };
  const lists = await getKvList(sql, "lists_v1");
  const l = { id: Date.now(), title: titulo, text: "", items: [], created: new Date().toLocaleString("pt-BR") };
  await setKvList(sql, "lists_v1", [l, ...lists]);
  return { reply: `Criei a lista "${titulo}".` };
}

async function cmdDeleteList(sql, titulo) {
  const lists = await getKvList(sql, "lists_v1");
  const nq = normalize(titulo);
  const match = lists.find(l => normalize(l.title).includes(nq));
  if (!match) return { reply: `Não achei nenhuma lista parecida com "${titulo}".` };
  await setKvList(sql, "lists_v1", lists.filter(l => l.id !== match.id));
  return { reply: `Apaguei a lista "${match.title}".` };
}

// ---------- Item 10: Recados pro Jarbas tratar depois ----------
async function cmdConcluirRecado(sql, texto) {
  const recados = await getKvList(sql, JARBAS_RECADOS_KEY);
  const nq = normalize(texto || "");
  const match = recados.find(r => !r.done && normalize(r.text).includes(nq));
  if (!match) return { reply: "" };
  const updated = recados.map(r => r.id === match.id ? { ...r, done: true } : r);
  await setKvList(sql, JARBAS_RECADOS_KEY, updated);
  return { reply: "" }; // ação de bastidor, não vira fala
}

// ---------- Migração de armazenamento: memória do Jarbas (Cloudflare KV -> Postgres) ----------
async function cmdSaveJarbasMemory(sql, data) {
  if (!data) return { reply: "" };
  await setKvJson(sql, JARBAS_MEMORY_KEY, data);
  return { reply: "" };
}

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action");

  const key = req.headers.get("x-jarbas-key") || searchParams.get("key");
  const hasJarbasKey = !!process.env.JARBAS_API_KEY && key === process.env.JARBAS_API_KEY;

  // log_read é a única ação de LEITURA que a própria aba "Diário do Jarbas" no painel
  // chama direto do navegador (sem a JARBAS_API_KEY, que é segredo só do Worker) —
  // por isso aceita TAMBÉM uma sessão válida do painel, nunca mais fica público sem
  // nenhuma das duas. Toda ação de ESCRITA (log_append e os demais comandos) continua
  // exigindo só a chave do Worker, como sempre.
  const isLogRead = req.method === "GET" && action === "log_read";

  if (!hasJarbasKey) {
    if (!isLogRead || !(await requireSession(req))) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: CORS });
    }
  }

  try {
    const sql = neon(process.env.DATABASE_URL);

    if (req.method === "GET" && searchParams.get("action") === "snapshot") {
      const texto = await getSnapshotText(sql, searchParams.get("dia") || "");
      return new Response(JSON.stringify({ texto }), { headers: CORS });
    }
    if (req.method === "GET" && searchParams.get("action") === "agenda") {
      const texto = await getAgendaOnlyText(sql, searchParams.get("dia") || "");
      return new Response(JSON.stringify({ texto }), { headers: CORS });
    }
    if (req.method === "GET" && searchParams.get("action") === "tasks") {
      const texto = await getTasksFilteredText(sql, searchParams.get("filtro") || "");
      return new Response(JSON.stringify({ texto }), { headers: CORS });
    }
    if (req.method === "GET" && searchParams.get("action") === "ideias") {
      return new Response(JSON.stringify({ texto: await getIdeasText(sql) }), { headers: CORS });
    }
    if (req.method === "GET" && searchParams.get("action") === "lembretes") {
      return new Response(JSON.stringify({ texto: await getRemindersText(sql) }), { headers: CORS });
    }
    if (req.method === "GET" && searchParams.get("action") === "listas") {
      return new Response(JSON.stringify({ texto: await getListsText(sql) }), { headers: CORS });
    }
    if (req.method === "GET" && searchParams.get("action") === "recados") {
      const recados = await getKvList(sql, JARBAS_RECADOS_KEY);
      return new Response(JSON.stringify({ recados: recados.filter(r => !r.done) }), { headers: CORS });
    }
    if (req.method === "GET" && searchParams.get("action") === "novidades") {
      return new Response(JSON.stringify(await getNovidades(sql)), { headers: CORS });
    }
    if (req.method === "GET" && searchParams.get("action") === "jarbas_memory") {
      const data = await getKvJson(sql, JARBAS_MEMORY_KEY);
      return new Response(JSON.stringify({ data }), { headers: CORS });
    }
    if (req.method === "GET" && searchParams.get("action") === "emails") {
      const texto = await getEmailsText(
        sql,
        searchParams.get("filtro") || "",
        searchParams.get("remetente") || "",
        searchParams.get("assunto") || ""
      );
      return new Response(JSON.stringify({ texto }), { headers: CORS });
    }
    if (req.method === "GET" && action === "log_read") {
      const eventos = await getLogEventos(sql, {
        desde: searchParams.get("desde") || "",
        ate: searchParams.get("ate") || "",
        tipo: searchParams.get("tipo") || "",
        q: searchParams.get("q") || "",
        limite: searchParams.get("limite") || "",
      });
      return new Response(JSON.stringify({ eventos }), { headers: CORS });
    }
    if (req.method === "GET" && action === "mudancas") {
      return new Response(JSON.stringify(await getMudancas(sql)), { headers: CORS });
    }

    if (req.method === "POST" && action === "log_append") {
      const body = await req.json();
      const result = await cmdLogAppend(sql, body?.eventos);
      return new Response(JSON.stringify(result), { status: result.ok ? 200 : 400, headers: CORS });
    }

    if (req.method === "POST") {
      const { comando, arg } = await req.json();
      let result;
      if (comando === "criar_tarefa") result = await cmdAddTask(sql, arg?.texto);
      else if (comando === "concluir_tarefa") result = await cmdCompleteTask(sql, arg?.texto);
      else if (comando === "apagar_tarefa") result = await cmdDeleteTask(sql, arg?.texto);
      else if (comando === "pagar_conta") result = await cmdPayBill(sql, arg?.nome);
      else if (comando === "apagar_conta") result = await cmdDeleteBill(sql, arg?.nome);
      else if (comando === "criar_compromisso") result = await cmdAddEvent(sql, arg || {});
      else if (comando === "apagar_compromisso") result = await cmdDeleteEvent(sql, arg?.titulo);
      else if (comando === "anotar_diario") result = await cmdAnotarDiario(sql, arg || {});
      else if (comando === "desfazer_diario") result = await cmdDesfazerDiario(sql, arg || {});
      else if (comando === "corrigir_diario") result = await cmdCorrigirDiario(sql, arg || {});
      else if (comando === "criar_ideia") result = await cmdAddIdea(sql, arg?.texto);
      else if (comando === "apagar_ideia") result = await cmdDeleteIdea(sql, arg?.texto);
      else if (comando === "criar_lembrete") result = await cmdAddReminder(sql, arg?.texto);
      else if (comando === "concluir_lembrete") result = await cmdCompleteReminder(sql, arg?.texto);
      else if (comando === "apagar_lembrete") result = await cmdDeleteReminder(sql, arg?.texto);
      else if (comando === "criar_lista") result = await cmdAddList(sql, arg?.titulo);
      else if (comando === "apagar_lista") result = await cmdDeleteList(sql, arg?.titulo);
      else if (comando === "concluir_recado") result = await cmdConcluirRecado(sql, arg?.texto);
      else if (comando === "jarbas_memory_save") result = await cmdSaveJarbasMemory(sql, arg?.data);
      else result = { reply: "Comando desconhecido." };
      return new Response(JSON.stringify(result), { headers: CORS });
    }

    return new Response(JSON.stringify({ error: "invalid_request" }), { status: 400, headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
