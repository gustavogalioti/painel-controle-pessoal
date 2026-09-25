export const config = { runtime: "edge" };
import { neon } from "@neondatabase/serverless";
import { getValidToken } from "./google-calendar.js";
import { getValidToken as getOutlookToken } from "./outlook-calendar.js";

// ─────────────────────────────────────────────────────────────────────────
// JARBAS — ponte entre o companheiro de voz (Jarbas, repo separado) e os
// dados reais do Painel de Controle Pessoal (agenda, tarefas, contas).
//
// Independente do api/pedro.js — não importa nada de lá — mas lê/escreve as
// mesmas chaves do sync_kv (tasks_v1, finance_v1, events_v1), porque essa é
// a fonte real dos dados do painel, a mesma que o Pedro e o front-end usam.
//
// Protegido por uma chave simples (JARBAS_API_KEY), enviada pelo Worker do
// Jarbas em cada chamada — nunca exposta ao navegador.
// ─────────────────────────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
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
async function getSnapshotText(sql, dia) {
  const todayStr = todayISO();
  const targetStr = dia === "amanha" ? addDaysISO(todayStr, 1) : todayStr;
  const diaLabel = dia === "amanha" ? "amanhã" : "hoje";
  const [events, tasks, finance, googleEventos, outlookEventos] = await Promise.all([
    getKvList(sql, "events_v1"), getKvList(sql, "tasks_v1"), getKvList(sql, "finance_v1"),
    getGoogleEventosDia(sql, targetStr), getOutlookEventosDia(sql, targetStr),
  ]);

  const localDia = events.filter(e => e.date === targetStr).map(e => ({ title: e.title, time: e.time || "" }));
  const diaEventos = [...localDia, ...googleEventos, ...outlookEventos].sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  const pendTasks = tasks.filter(t => (t.status || (t.done ? "done" : "todo")) !== "done");
  const pendBills = finance.filter(e => FIN_RECURRENT_TYPES.includes(e.type) && !finIsPaid(e));

  const partes = [];
  partes.push(diaEventos.length
    ? `Agenda de ${diaLabel}: ${diaEventos.map(e => `${e.time ? e.time + " " : ""}${e.title}`).join("; ")}`
    : `Agenda de ${diaLabel}: livre, nenhum compromisso.`);
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
const TASK_FILTER_STATUSES = { hoje: ["now", "today"], pendentes: ["todo"], andamento: ["doing"] };
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

// ---------- Ações (o que o Jarbas pode "fazer") ----------
async function cmdAddTask(sql, texto) {
  if (!texto) return { reply: "Faltou dizer o texto da tarefa." };
  const tasks = await getKvList(sql, "tasks_v1");
  const t = { id: Date.now(), text: texto, prio: "normal", status: "todo", done: false, date: new Date().toISOString(), notes: [], updates: [] };
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

async function cmdAnotarDiario(sql, { texto, humor }) {
  if (!texto || !texto.trim()) return { reply: "" };
  const moodMap = { bom: "🙂", otimo: "😄", ruim: "😔", pessimo: "😤", neutro: "🙂" };
  const mood = moodMap[normalize(humor || "")] || "🙂";
  const entries = await getKvList(sql, "diary_v1");
  const entry = { id: Date.now(), text: texto.trim(), mood, date: new Date().toISOString() };
  await setKvList(sql, "diary_v1", [entry, ...entries]);
  return { reply: "" }; // ação de bastidor, não vira fala
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

  const key = req.headers.get("x-jarbas-key") || new URL(req.url).searchParams.get("key");
  if (!process.env.JARBAS_API_KEY || key !== process.env.JARBAS_API_KEY) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: CORS });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    const { searchParams } = new URL(req.url);

    if (req.method === "GET" && searchParams.get("action") === "snapshot") {
      const texto = await getSnapshotText(sql, searchParams.get("dia") || "");
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
