export const config = { runtime: "edge" };
import { neon } from "@neondatabase/serverless";
import { getValidToken } from "./google-calendar.js";
import { getValidToken as getOutlookToken } from "./outlook-calendar.js";
import { requireSession, getClientIp } from "./_auth-lib.js";

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
      id: ev.id,
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
      id: ev.id,
      account,
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

// ---------- FIX-3 PARTE A: dedupe de eventos (local x Google x Outlook) ----------
// O painel (src/App.jsx, AgendaPage) já evita mostrar duplicata na tela: um evento local
// que foi sincronizado guarda o id externo (googleId / outlookId+outlookAccount), e o
// evento "vivo" vindo do Google/Outlook com esse mesmo id é descartado da lista — só essa
// lógica nunca existiu aqui no lado do Jarbas, que simplesmente concatenava as três fontes
// sem filtrar nada (causa real da duplicata relatada: "10:00 — Reunião Jr. MH + Zezé"
// aparecendo duas vezes no card/agenda falada). Reproduzimos o MESMO critério aqui.
//
// Chave de conteúdo: mesmo horário + título normalizado (minúsculas, sem acento/pontuação)
// é tratado como o MESMO compromisso, mesmo sem id vinculado (ex: evento criado à mão nos
// dois lados, sem nunca ter sido de fato sincronizado) — cobre o caso relatado onde o
// evento existia solto no painel E também no Google, sem link entre os dois.
function eventContentKey(time, title) {
  return `${time || ""}|${normalize(title)}`;
}

// Recebe os eventos locais (shape bruto de events_v1, com date/title/time/googleId/
// outlookId/outlookAccount), já filtrados pro dia alvo, mais os eventos do Google e do
// Outlook pro MESMO dia (shape {id, title, time} / {id, account, title, time}). Devolve
// uma lista mesclada e sem duplicata, mantendo o formato {title, time} (+ o que mais o
// item local já tinha) — NUNCA perde o título original, só decide qual cópia mostrar.
// Ordem de preferência quando duas entradas batem na mesma chave: local, depois Google,
// depois Outlook — local vence porque é a cópia que o próprio Gustavo edita no painel.
export function mesclarEventosDoDia(localEventos, googleEventos, outlookEventos) {
  const locais = Array.isArray(localEventos) ? localEventos : [];
  const google = Array.isArray(googleEventos) ? googleEventos : [];
  const outlook = Array.isArray(outlookEventos) ? outlookEventos : [];

  // Passo 1: descarta o evento externo que já está "linkado" a uma cópia local (mesmo
  // caminho que o painel usa pra nunca listar duas vezes um evento sincronizado).
  const linkedGoogleIds = new Set(locais.filter(e => e.googleId).map(e => e.googleId));
  const linkedOutlookKeys = new Set(locais.filter(e => e.outlookId).map(e => `${e.outlookAccount || ""}:${e.outlookId}`));
  const googleRestantes = google.filter(g => !linkedGoogleIds.has(g.id));
  const outlookRestantes = outlook.filter(o => !linkedOutlookKeys.has(`${o.account || ""}:${o.id}`));

  // Passo 2: defesa extra por conteúdo (horário + título normalizado), pro caso de
  // duplicata SEM nenhum id em comum — mantém a primeira ocorrência na ordem
  // local > Google > Outlook; eventos com títulos diferentes no mesmo horário nunca batem.
  const vistos = new Set();
  const resultado = [];
  for (const e of [...locais, ...googleRestantes, ...outlookRestantes]) {
    const key = eventContentKey(e.time, e.title);
    if (vistos.has(key)) continue;
    vistos.add(key);
    resultado.push(e);
  }
  return resultado;
}

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
  const localDia = events.filter(e => e.date === targetStr);
  const diaEventos = mesclarEventosDoDia(localDia, googleEventos, outlookEventos)
    .map(e => ({ title: e.title, time: e.time || "" }))
    .sort((a, b) => (a.time || "").localeCompare(b.time || ""));
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

// ─────────────────────────────────────────────────────────────────────────
// PARTE D (Jarbas): consulta de agenda por data/intervalo arbitrário — generaliza
// getAgendaDiaData (que só sabia "hoje"/"amanhã") pra qualquer data ou período de até
// AGENDA_RANGE_MAX_DIAS, reaproveitando os MESMOS buscadores (local/Google/Outlook) por
// dia, em paralelo. Só leitura — nada escreve. Usado por ?action=agenda&data=...&ate=...
// mantendo o endpoint/parâmetro antigo (dia=hoje|amanha) intactos pra não quebrar nada.
// ─────────────────────────────────────────────────────────────────────────
const AGENDA_RANGE_MAX_DIAS = 14;

export function diasEntre(dataInicio, dataFim) {
  const dias = [];
  let atual = dataInicio;
  let guard = 0;
  while (atual <= dataFim && guard < AGENDA_RANGE_MAX_DIAS) {
    dias.push(atual);
    atual = addDaysISO(atual, 1);
    guard++;
  }
  return dias;
}

export function weekdayLabel(dataISO) {
  const dt = new Date(`${dataISO}T12:00:00-03:00`); // meio-dia evita qualquer borda de fuso
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long" }).format(dt);
}

async function getEventosDoDia(sql, dataISO) {
  const [events, googleEventos, outlookEventos] = await Promise.all([
    getKvList(sql, "events_v1"),
    getGoogleEventosDia(sql, dataISO), getOutlookEventosDia(sql, dataISO),
  ]);
  const localDia = events.filter((e) => e.date === dataISO);
  return mesclarEventosDoDia(localDia, googleEventos, outlookEventos)
    .sort((a, b) => (a.time || "").localeCompare(b.time || ""))
    .map((e) => ({ date: dataISO, time: e.time || "", title: e.title }));
}

// Devolve { texto, eventos }. Um dia só mantém o MESMO formato de texto que
// agendaLine/getAgendaOnlyText já produzem (pra parseAgendaTexto, do lado do Worker,
// continuar funcionando sem mudar); um intervalo de vários dias agrupa por dia.
export async function getAgendaPorDataText(sql, dataInicio, dataFim) {
  const dias = diasEntre(dataInicio, dataFim || dataInicio);
  const porDia = await Promise.all(dias.map((d) => getEventosDoDia(sql, d)));
  const eventos = porDia.flat();
  if (dias.length <= 1) {
    const label = dataInicio === todayISO() ? "hoje" : weekdayLabel(dataInicio);
    const texto = agendaLine(label, eventos.map((e) => ({ title: e.title, time: e.time })));
    return { texto, eventos };
  }
  const texto = dias.map((d, i) => {
    const doDia = porDia[i];
    const label = `${weekdayLabel(d)} (${d.slice(8, 10)}/${d.slice(5, 7)})`;
    return doDia.length
      ? `${label}: ${doDia.map((e) => `${e.time ? e.time + " " : ""}${e.title}`).join("; ")}`
      : `${label}: livre`;
  }).join(". ");
  return { texto, eventos };
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

// ─────────────────────────────────────────────────────────────────────────
// ADMIN-1: inventário completo do painel ("o Jarbas se pauta por TUDO").
//
// IMPORTANTE — divergência pré-existente encontrada (não introduzida por este PR):
// os comandos de voz mais antigos (pagar_conta/apagar_conta, chamados por
// gerenciar_conta) e api/pedro.js leem/escrevem "finance_v1", mas a tela real de
// Contas do painel (BillsPage, src/App.jsx) usa "bills_v1" — são chaves DIFERENTES,
// então esses comandos antigos nunca enxergam as contas que aparecem na tela. Fora
// de escopo corrigir aqui (usado em mais de um lugar, risco de regressão); o
// inventário/ferramentas NOVAS deste PR usam a chave REAL (bills_v1), que é a
// única que a tela mostra. Ver nota na descrição do PR.
//
// Cada domínio: a chave real do sync_kv + um normalizador compacto (id/titulo/
// status/data/prioridade/tags), usado tanto por ?action=painel_resumo (leitura
// para o prompt) quanto por painel_gerenciar (escrita) e painel_buscar (busca).
// "diario" tem seu próprio fluxo dedicado (anotar/desfazer/corrigir já existentes)
// e não entra nos domínios de escrita genérica, pra não duplicar regra nenhuma.
// "saude_v1"/"temas_*" (hábitos) ficaram de fora: são objetos de configuração/log
// por dia, não listas de itens com id — não cabem no mesmo formato genérico sem
// código sob medida, desproporcional ao pedido; ver nota no PR.
// ─────────────────────────────────────────────────────────────────────────
function truncate(str, n) {
  const s = String(str || "");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export const PAINEL_COLECOES = {
  tarefa: {
    key: "tasks_v1", label: "tarefa", campoTexto: "text",
    map: (t) => ({ id: t.id, titulo: truncate(t.text, 140), status: getTaskStatus(t), data: t.date || null, prioridade: t.prio || null, tags: [] }),
  },
  compromisso: {
    key: "events_v1", label: "compromisso", campoTexto: "title",
    map: (e) => ({ id: e.id, titulo: truncate(e.title, 140), status: e.cat || null, data: [e.date, e.time].filter(Boolean).join(" ") || null, prioridade: null, tags: e.local ? [e.local] : [] }),
  },
  conta: {
    key: "bills_v1", label: "conta", campoTexto: "name",
    map: (b) => ({ id: b.id, titulo: truncate(b.name, 140), status: b.paid ? "paga" : "pendente", data: b.dueDay != null ? `dia ${b.dueDay}` : null, prioridade: null, tags: [b.cat].filter(Boolean) }),
  },
  ideia: {
    key: "ideas_v1", label: "ideia", campoTexto: "text",
    map: (i) => ({ id: i.id, titulo: truncate(i.text, 140), status: null, data: i.date || null, prioridade: null, tags: [i.tag].filter(Boolean) }),
  },
  lembrete: {
    key: "reminders_v1", label: "lembrete", campoTexto: "text",
    map: (r) => ({ id: r.id, titulo: truncate(r.text, 140), status: r.done ? "feito" : "pendente", data: r.date || null, prioridade: null, tags: [] }),
  },
  lista: {
    key: "lists_v1", label: "lista", campoTexto: "title",
    map: (l) => ({ id: l.id, titulo: truncate(l.title, 140), status: `${(l.items || []).length} itens`, data: l.created || null, prioridade: null, tags: [] }),
  },
  nota: {
    key: "rascunhos_v1", label: "nota", campoTexto: "title",
    map: (n) => ({ id: n.id, titulo: truncate(n.title || n.notes, 140), status: null, data: n.date || null, prioridade: null, tags: Array.isArray(n.tags) ? n.tags : [] }),
  },
  diario: {
    key: "diary_v1", label: "anotação no diário", campoTexto: "text", somenteLeitura: true,
    map: (d) => ({ id: d.id, titulo: truncate(d.text, 140), status: d.mood || null, data: d.date || null, prioridade: null, tags: [] }),
  },
};

// Relevância temporal por domínio, pra painel_resumo nunca despejar tudo — só o que
// importa AGORA primeiro. Itens concluídos/pagos/feitos sempre vão pro final.
const PAINEL_RESUMO_LIMITE = 6;
const PAINEL_RESUMO_TITULO_MAX = 140;

function relevanciaChave(dominio, item) {
  const done = item.status === "done" || item.status === "feito" || item.status === "paga" || item.status === "tratado";
  if (dominio === "tarefa") {
    const ordemStatus = { now: 0, today: 1, doing: 2, todo: 3, standby: 4, done: 9 };
    return [done ? 1 : 0, ordemStatus[item.status] ?? 5, item.data || ""];
  }
  if (dominio === "compromisso" || dominio === "conta") {
    // mais próximos primeiro (data/dueDay em ordem crescente), pagos/passados depois.
    return [done ? 1 : 0, item.data || "9999"];
  }
  // ideia/lembrete/lista/nota/diario: mais recente primeiro (já vêm prependados na
  // criação — manter a ordem de chegada da lista é suficiente, sem reordenar).
  return [done ? 1 : 0];
}

function compararRelevancia(dominio, a, b) {
  const ka = relevanciaChave(dominio, a), kb = relevanciaChave(dominio, b);
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
    const va = ka[i], vb = kb[i];
    if (va === vb) continue;
    if (typeof va === "number" || typeof vb === "number") return (Number(va) || 0) - (Number(vb) || 0);
    return String(va || "").localeCompare(String(vb || ""));
  }
  return 0;
}

// Devolve, por domínio: total de itens, os N mais relevantes (compactados/truncados)
// e um hash do conjunto devolvido — o Worker guarda o hash e só recalcula/reage se
// ele mudar, sem precisar baixar a coleção inteira de novo pra saber se algo mudou.
export async function getPainelResumo(sql) {
  const entradas = await Promise.all(Object.entries(PAINEL_COLECOES).map(async ([dominio, cfg]) => {
    const lista = await getKvList(sql, cfg.key);
    const itens = lista.map(cfg.map).sort((a, b) => compararRelevancia(dominio, a, b)).slice(0, PAINEL_RESUMO_LIMITE)
      .map((it) => ({ ...it, titulo: truncate(it.titulo, PAINEL_RESUMO_TITULO_MAX) }));
    const hash = await sha256Short(JSON.stringify(itens));
    return [dominio, { total: lista.length, itens, hash }];
  }));
  return Object.fromEntries(entradas);
}

// ---------- ADMIN-1 PARTE D: painel_buscar (só leitura, busca por palavra normalizada) ----------
const PAINEL_BUSCA_LIMITE_POR_DOMINIO = 5;

export async function getPainelBusca(sql, q) {
  const nq = normalize(q);
  if (!nq) return { query: q || "", resultados: [] };
  const porDominio = await Promise.all(Object.entries(PAINEL_COLECOES).map(async ([dominio, cfg]) => {
    const lista = await getKvList(sql, cfg.key);
    return lista
      .filter((item) => normalize(item[cfg.campoTexto]).includes(nq) || (Array.isArray(item.tags) && item.tags.some((t) => normalize(t).includes(nq))))
      .slice(0, PAINEL_BUSCA_LIMITE_POR_DOMINIO)
      .map((item) => ({ dominio, label: cfg.label, ...cfg.map(item) }));
  }));
  return { query: q, resultados: porDominio.flat() };
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

// ─────────────────────────────────────────────────────────────────────────
// PAINEL-3: ponte painel → Jarbas (companion) — "@jarbas" na barra de comando
// global. Protegida pela SESSÃO do painel (nunca pela JARBAS_API_KEY, que é
// segredo só do Worker) e repassa pro Worker com um segredo de servidor
// próprio (WORKER_URL + JARBAS_WORKER_SYNC_KEY) — a chave do Worker nunca
// chega ao navegador em nenhum dos dois sentidos.
// ─────────────────────────────────────────────────────────────────────────

const CHAT_MAX_CHARS = 2000;
const CHAT_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutos
const CHAT_RATE_LIMIT_MAX = 30; // 30 mensagens / 10 min
const CHAT_RATE_LIMIT_KEY_PREFIX = "jarbas_chat_rl:";
const UNDO_TTL_MS = 10 * 60 * 1000; // 10 minutos
const UNDO_KEY_PREFIX = "jarbas_undo:";

// Mesmo padrão de rate limit do login (_auth-lib.js), por IP — o painel é de uso
// único (só o Gustavo), então IP já equivale, na prática, a "por sessão".
async function checkChatRateLimit(sql, ip) {
  const key = CHAT_RATE_LIMIT_KEY_PREFIX + ip;
  const state = await getKvJson(sql, key);
  const now = Date.now();
  if (!state || now - state.firstAt > CHAT_RATE_LIMIT_WINDOW_MS) {
    await setKvJson(sql, key, { count: 1, firstAt: now });
    return { blocked: false };
  }
  if (state.count >= CHAT_RATE_LIMIT_MAX) {
    const retryAfterSeconds = Math.ceil((state.firstAt + CHAT_RATE_LIMIT_WINDOW_MS - now) / 1000);
    return { blocked: true, retryAfterSeconds: Math.max(1, retryAfterSeconds) };
  }
  await setKvJson(sql, key, { count: state.count + 1, firstAt: state.firstAt });
  return { blocked: false };
}

// Mesmo shape que o app de voz manda em companionState (companion/index.html,
// buildCompanionState) — montado aqui, server-side, a partir do MESMO mem que o
// Worker já lê/grava (jarbas_memory_v1), pra não precisar mandar a memória
// inteira do navegador pra cá e dali pro Worker (e porque o navegador nunca tem
// a JARBAS_API_KEY pra chamar jarbas_memory direto).
export function buildCompanionStateFromMem(mem) {
  const m = mem || {};
  const agora = new Date();
  return {
    origem: "painel",
    memory: m.memory || "",
    knowledge: m.knowledge || null,
    location: m.location || null,
    timeline: Array.isArray(m.timeline) ? m.timeline : [],
    items: Array.isArray(m.items) ? m.items : [],
    learned: Array.isArray(m.learned) ? m.learned : [],
    shortcuts: Array.isArray(m.shortcuts) ? m.shortcuts : [],
    now: agora.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    hojeISO: todayISO(),
    aparencia: null, // sem rosto no painel — nada aqui pra configurar
    podeMaterializarEspontaneo: false, // sem onde mostrar uma materialização no painel
    perfil: m.perfil || null,
    ideias: Array.isArray(m.ideias) ? m.ideias : [],
  };
}

// Ferramenta de ESCRITA (Worker) -> coleção afetada no painel (sync_kv). Usado pro
// Desfazer: restaura a coleção inteira pro estado de ANTES da chamada — mais simples
// e mais robusto que tentar reconstruir só o item específico que mudou (não depende
// de saber qual foi, nem do formato interno de cada comando).
const TOOL_TO_COLLECTION = {
  gerenciar_tarefa: { key: "tasks_v1", label: "tarefa" },
  gerenciar_conta: { key: "finance_v1", label: "conta" },
  gerenciar_compromisso: { key: "events_v1", label: "compromisso" },
  gerenciar_ideia: { key: "ideas_v1", label: "ideia" },
  gerenciar_lembrete: { key: "reminders_v1", label: "lembrete" },
  gerenciar_lista: { key: "lists_v1", label: "lista" },
  anotar_no_diario: { key: "diary_v1", label: "anotação no diário" },
  desfazer_anotacao_diario: { key: "diary_v1", label: "anotação no diário" },
  corrigir_anotacao_diario: { key: "diary_v1", label: "anotação no diário" },
  concluir_recado: { key: JARBAS_RECADOS_KEY, label: "recado" },
};
const UNDO_COLLECTIONS = [...new Set(Object.values(TOOL_TO_COLLECTION).map(c => c.key))];

async function snapshotCollections(sql, keys) {
  const entries = await Promise.all(keys.map(async (k) => [k, await getKvList(sql, k)]));
  return Object.fromEntries(entries);
}

export async function cmdChat(sql, body, ip) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (!messages.length) return { status: 400, data: { error: "messages_required" } };
  const last = messages[messages.length - 1];
  const lastText = String(last?.content || "");
  if (!lastText.trim()) return { status: 400, data: { error: "empty_message" } };
  if (lastText.length > CHAT_MAX_CHARS) return { status: 400, data: { error: "message_too_long", max: CHAT_MAX_CHARS } };

  const rl = await checkChatRateLimit(sql, ip);
  if (rl.blocked) return { status: 429, data: { error: "rate_limited", retryAfterSeconds: rl.retryAfterSeconds } };

  const workerUrl = process.env.WORKER_URL;
  const workerKey = process.env.JARBAS_WORKER_SYNC_KEY;
  if (!workerUrl || !workerKey) return { status: 500, data: { error: "worker_not_configured" } };

  const mem = await getKvJson(sql, JARBAS_MEMORY_KEY);
  const companionState = buildCompanionStateFromMem(mem);

  // Snapshot ANTES de chamar o Worker — é o único jeito de saber o estado "de antes"
  // sem precisar que cada ferramenta devolva isso (o Worker/painel.js comando não
  // muda: só isso aqui, novo, guarda uma cópia de cada coleção que PODE mudar).
  const before = await snapshotCollections(sql, UNDO_COLLECTIONS);

  const trimmedMessages = messages.slice(-12).map(m => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content || "").slice(0, CHAT_MAX_CHARS),
    at: m.at || null,
  }));

  let workerData;
  try {
    const r = await fetchWithTimeout(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "companion", key: workerKey, messages: trimmedMessages, companionState }),
    }, 20000);
    if (!r.ok) return { status: 502, data: { error: "worker_error", detail: `http_${r.status}` } };
    workerData = await r.json();
  } catch (e) {
    return { status: 502, data: { error: "worker_unreachable", detail: e.message } };
  }
  if (!workerData || typeof workerData.reply !== "string") {
    return { status: 502, data: { error: "worker_bad_response" } };
  }

  // Guarda só o "antes" das coleções que REALMENTE mudaram (tools_used), com TTL —
  // nunca guarda as outras (não precisam de Desfazer, e não vale gastar espaço à toa).
  const toolsUsed = Array.isArray(workerData.tools_used) ? workerData.tools_used : [];
  const undo = [];
  const collectionsJaGuardadas = new Set();
  for (const tool of toolsUsed) {
    const alvo = TOOL_TO_COLLECTION[tool];
    if (!alvo || collectionsJaGuardadas.has(alvo.key)) continue;
    collectionsJaGuardadas.add(alvo.key);
    const id = newLogId();
    const createdAt = Date.now();
    await setKvJson(sql, UNDO_KEY_PREFIX + id, {
      collection: alvo.key, before: before[alvo.key], createdAt, expiresAt: createdAt + UNDO_TTL_MS, used: false,
    });
    undo.push({ id, label: alvo.label });
  }

  return {
    status: 200,
    data: {
      reply: workerData.reply,
      emotion: workerData.emotion || "neutro",
      cards: workerData.cards || null,
      lousa: workerData.lousa || null,
      materialize: workerData.materialize || null,
      undo,
    },
  };
}

// Limite de expiração: registros antigos (criados antes do ADMIN-1) não têm
// `expiresAt` — caem no TTL de 10min antigo (UNDO_TTL_MS), igual sempre se comportaram.
function undoExpirado(record) {
  const limite = record.expiresAt ?? (record.createdAt + UNDO_TTL_MS);
  return Date.now() > limite;
}

async function restaurarUndo(sql, id, record, origemLog) {
  await setKvList(sql, record.collection, record.before || []);
  await setKvJson(sql, UNDO_KEY_PREFIX + id, { ...record, used: true });
  await cmdLogAppend(sql, [{
    tipo: "acao_pedida", origem: origemLog,
    resumo: `Desfez a última ação do Jarbas em "${record.collection}"${origemLog === "painel" ? " pela barra de comando do painel." : "."}`,
    detalhes: { canal: origemLog, collection: record.collection },
  }]);
  return { status: 200, data: { ok: true, collection: record.collection } };
}

export async function cmdDesfazer(sql, undoId) {
  if (!undoId) return { status: 400, data: { error: "id_required" } };
  const record = await getKvJson(sql, UNDO_KEY_PREFIX + undoId);
  if (!record) return { status: 404, data: { error: "undo_not_found" } };
  if (record.used) return { status: 410, data: { error: "undo_already_used" } };
  if (undoExpirado(record)) return { status: 410, data: { error: "undo_expired" } };
  return restaurarUndo(sql, undoId, record, "painel");
}

// Pedida por voz ("desfaz") — sem id explícito, acha o registro de desfazer mais
// recente que ainda não foi usado nem expirou. Usado SÓ pelo Worker (comando
// "desfazer_ultima_acao", autenticado com a JARBAS_API_KEY, nunca pela sessão do
// painel, que já tem o id exato devolvido pela própria conversa).
export async function cmdDesfazerUltima(sql) {
  const rows = await sql`SELECT key, value FROM sync_kv WHERE key LIKE ${UNDO_KEY_PREFIX + "%"} ORDER BY updated_at DESC LIMIT 20`;
  for (const row of rows) {
    let record;
    try { record = JSON.parse(row.value); } catch { continue; }
    if (!record || record.used || undoExpirado(record)) continue;
    const id = row.key.slice(UNDO_KEY_PREFIX.length);
    const result = await restaurarUndo(sql, id, record, "jarbas");
    return { ...result, data: { ...result.data, label: TOOL_TO_COLLECTION_LABEL[record.collection] || record.collection } };
  }
  return { status: 404, data: { error: "undo_not_found" } };
}
const TOOL_TO_COLLECTION_LABEL = Object.fromEntries([
  ...Object.values(TOOL_TO_COLLECTION).map((c) => [c.key, c.label]),
  ...Object.entries(PAINEL_COLECOES).map(([, c]) => [c.key, c.label]),
]);

// ─────────────────────────────────────────────────────────────────────────
// ADMIN-1 PARTE C: painel_gerenciar — o Jarbas como ADMINISTRADOR do painel.
// Única porta de ESCRITA genérica sobre o inventário (PAINEL_COLECOES), chamada
// pelo Worker (ferramenta "painel_gerenciar", autenticada com a JARBAS_API_KEY,
// igual aos outros comandos) a partir de uma conversa ao vivo (voz ou barra do
// painel) — NUNCA pelas janelas automáticas de verificação, que só leem e sugerem
// (ver worker/index.js); esta rota simplesmente não é chamada por elas.
//
// "diario" fica de fora (tem fluxo próprio: anotar_no_diario/desfazer_anotacao_diario/
// corrigir_anotacao_diario, já existentes) — reaproveitado, não duplicado.
// ─────────────────────────────────────────────────────────────────────────
const ADMIN_WRITE_RL_MIN_KEY = "jarbas_admin_rl_min";
const ADMIN_WRITE_RL_MIN_MAX = 20; // escritas por minuto (anti-laço)
const ADMIN_WRITE_RL_MIN_MS = 60 * 1000;
function adminWriteRlDiaKey() { return `jarbas_admin_rl_dia:${todayISO()}`; }
const ADMIN_WRITE_RL_DIA_MAX = 300; // escritas por dia
const UNDO_ADMIN_TTL_MS = 24 * 60 * 60 * 1000; // 24h (vs. 10min da barra de comando)

async function checkAdminWriteRateLimit(sql) {
  const now = Date.now();
  const minState = await getKvJson(sql, ADMIN_WRITE_RL_MIN_KEY);
  if (!minState || now - minState.firstAt > ADMIN_WRITE_RL_MIN_MS) {
    await setKvJson(sql, ADMIN_WRITE_RL_MIN_KEY, { count: 1, firstAt: now });
  } else if (minState.count >= ADMIN_WRITE_RL_MIN_MAX) {
    return { blocked: true, motivo: "limite_por_minuto" };
  } else {
    await setKvJson(sql, ADMIN_WRITE_RL_MIN_KEY, { count: minState.count + 1, firstAt: minState.firstAt });
  }

  const diaKey = adminWriteRlDiaKey();
  const diaCount = Number(await getKvJson(sql, diaKey)) || 0;
  if (diaCount >= ADMIN_WRITE_RL_DIA_MAX) return { blocked: true, motivo: "limite_por_dia" };
  await setKvJson(sql, diaKey, diaCount + 1);
  return { blocked: false };
}

// Ações destrutivas/em massa — NUNCA executam sem `confirmado:true` vindo da
// conversa (o Worker só manda isso depois que a própria pessoa confirmou
// explicitamente). Sem confirmação, devolve o que SERIA feito, sem fazer nada.
const ADMIN_ACOES_DESTRUTIVAS = new Set(["apagar", "arquivar_varios", "mover_todos", "item_remover"]);

// O que cada domínio aceita — fora daqui, 400 (nunca um domínio/ação inesperados
// batendo em código que não foi escrito pra eles).
const ADMIN_ACOES_POR_DOMINIO = {
  tarefa: ["criar", "atualizar", "mover", "concluir", "apagar", "arquivar_varios", "mover_todos"],
  compromisso: ["criar", "atualizar", "mover", "apagar"],
  conta: ["criar", "atualizar", "concluir", "apagar"],
  ideia: ["criar", "atualizar", "apagar"],
  lembrete: ["criar", "atualizar", "concluir", "apagar"],
  lista: ["criar", "apagar", "item_adicionar", "item_remover"],
  nota: ["criar", "atualizar", "apagar"],
};

function encontrarPorId(lista, id) {
  return lista.find((it) => String(it.id) === String(id));
}

// Dedup (PARTE C.4): antes de criar, checa se já existe algo equivalente (texto
// normalizado, igual ou contendo um ao outro) e ainda "ativo" (não concluído/pago/
// apagado) — nesse caso recusa a criação e devolve o item existente, pra quem
// chamou perguntar/atualizar em vez de duplicar.
function encontrarDuplicado(lista, campoTexto, textoNovo, estaAtivo) {
  const nq = normalize(textoNovo);
  if (!nq) return null;
  return lista.find((it) => estaAtivo(it) && (normalize(it[campoTexto]).includes(nq) || nq.includes(normalize(it[campoTexto]))));
}

async function gravarUndoAdmin(sql, collection, before) {
  const id = newLogId();
  const createdAt = Date.now();
  await setKvJson(sql, UNDO_KEY_PREFIX + id, { collection, before, createdAt, expiresAt: createdAt + UNDO_ADMIN_TTL_MS, used: false });
  return id;
}

async function logAcaoAdmin(sql, dominio, acao, resumo, extra) {
  await cmdLogAppend(sql, [{
    tipo: "acao_pedida", origem: "jarbas",
    resumo, detalhes: { ferramenta: "painel_gerenciar", dominio, acao, ...extra },
  }]);
}

export async function cmdPainelGerenciar(sql, payload = {}) {
  const { dominio, acao, params = {}, confirmado = false } = payload || {};
  const cfg = PAINEL_COLECOES[dominio];
  const acoesValidas = ADMIN_ACOES_POR_DOMINIO[dominio];
  if (!cfg || cfg.somenteLeitura || !acoesValidas) return { ok: false, erro: "dominio_invalido" };
  if (!acoesValidas.includes(acao)) return { ok: false, erro: "acao_invalida" };

  const mem = await getKvJson(sql, JARBAS_MEMORY_KEY);
  const adminConfig = mem?.config?.admin || {};
  if (adminConfig.ativo === false) return { ok: false, erro: "admin_desativado", reply: "O modo administrador do painel está desligado nas configurações — não fiz nada." };

  const destrutiva = ADMIN_ACOES_DESTRUTIVAS.has(acao);
  if (destrutiva && !confirmado) {
    return { ok: false, erro: "confirmacao_necessaria", reply: `Essa ação (${acao.replace("_", " ")} em ${cfg.label}) apaga ou move muita coisa de uma vez — confirme com a pessoa antes de eu fazer de verdade.` };
  }

  const modoSugerir = adminConfig.modo === "sugerir";
  if (modoSugerir) {
    return { ok: false, erro: "modo_sugerir", reply: `(modo sugestão) Eu faria: ${acao.replace("_", " ")} em ${cfg.label}${params?.texto || params?.titulo || params?.nome ? ` — "${params.texto || params.titulo || params.nome}"` : ""}. Confirme pra eu executar de verdade.` };
  }

  const rl = await checkAdminWriteRateLimit(sql);
  if (rl.blocked) return { ok: false, erro: "rate_limited", motivo: rl.motivo, reply: "Fiz escrita demais no painel em pouco tempo — vou esperar um pouco antes da próxima." };

  const antes = await getKvList(sql, cfg.key);
  let depois = antes;
  let itemResultado = null;
  let resumoLog = "";

  const textoNovo = params.texto ?? params.titulo ?? params.nome ?? "";
  const estaAtivo = (it) => !(it.status === "done" || it.done === true || it.paid === true);

  if (acao === "criar") {
    if (!textoNovo || !String(textoNovo).trim()) return { ok: false, erro: "texto_obrigatorio" };
    const duplicado = encontrarDuplicado(antes, cfg.campoTexto, textoNovo, estaAtivo);
    if (duplicado) return { ok: false, erro: "duplicado", existente: cfg.map(duplicado), reply: `Já existe ${cfg.label === "conta" ? "uma conta" : "algo"} parecido: "${duplicado[cfg.campoTexto]}". Quer que eu atualize essa em vez de criar outra?` };
    itemResultado = construirNovoItem(dominio, params);
    depois = [itemResultado, ...antes];
    resumoLog = `Criou ${cfg.label}: "${textoNovo}".`;
  } else if (acao === "atualizar") {
    const alvo = encontrarPorId(antes, params.id);
    if (!alvo) return { ok: false, erro: "nao_encontrado" };
    itemResultado = aplicarAtualizacao(dominio, alvo, params.campos || {});
    depois = antes.map((it) => (String(it.id) === String(params.id) ? itemResultado : it));
    resumoLog = `Atualizou ${cfg.label} #${params.id}.`;
  } else if (acao === "mover") {
    const alvo = encontrarPorId(antes, params.id);
    if (!alvo) return { ok: false, erro: "nao_encontrado" };
    itemResultado = aplicarMovimentacao(dominio, alvo, params);
    if (!itemResultado) return { ok: false, erro: "parametros_invalidos" };
    depois = antes.map((it) => (String(it.id) === String(params.id) ? itemResultado : it));
    resumoLog = `Moveu ${cfg.label} #${params.id}.`;
  } else if (acao === "concluir") {
    const alvo = encontrarPorId(antes, params.id);
    if (!alvo) return { ok: false, erro: "nao_encontrado" };
    itemResultado = aplicarConclusao(dominio, alvo);
    depois = antes.map((it) => (String(it.id) === String(params.id) ? itemResultado : it));
    resumoLog = `Concluiu ${cfg.label} #${params.id}.`;
  } else if (acao === "apagar") {
    const alvo = encontrarPorId(antes, params.id);
    if (!alvo) return { ok: false, erro: "nao_encontrado" };
    await moverParaLixeira(sql, cfg.key, [alvo]);
    depois = antes.filter((it) => String(it.id) !== String(params.id));
    resumoLog = `Apagou ${cfg.label} #${params.id}: "${alvo[cfg.campoTexto] || ""}".`;
  } else if (acao === "arquivar_varios") {
    const filtroStatus = params.status;
    const alvos = filtroStatus ? antes.filter((it) => getItemStatus(dominio, it) === filtroStatus) : antes.filter(estaAtivo);
    if (!alvos.length) return { ok: false, erro: "nada_para_arquivar" };
    await moverParaLixeira(sql, cfg.key, alvos);
    const idsAlvo = new Set(alvos.map((a) => String(a.id)));
    depois = antes.filter((it) => !idsAlvo.has(String(it.id)));
    resumoLog = `Arquivou ${alvos.length} ${cfg.label}(s) em massa.`;
  } else if (acao === "mover_todos") {
    if (dominio !== "tarefa" || !params.deStatus || !params.paraStatus) return { ok: false, erro: "parametros_invalidos" };
    let movidos = 0;
    depois = antes.map((it) => {
      if (getTaskStatus(it) !== params.deStatus) return it;
      movidos++;
      return { ...it, status: params.paraStatus, done: params.paraStatus === "done" };
    });
    if (!movidos) return { ok: false, erro: "nada_para_mover" };
    resumoLog = `Moveu ${movidos} tarefa(s) de "${params.deStatus}" para "${params.paraStatus}".`;
  } else if (acao === "item_adicionar") {
    const alvo = encontrarPorId(antes, params.id);
    if (!alvo) return { ok: false, erro: "nao_encontrado" };
    const novoItem = { id: Date.now(), text: String(params.item || "").trim(), done: false, date: new Date().toLocaleString("pt-BR") };
    if (!novoItem.text) return { ok: false, erro: "texto_obrigatorio" };
    itemResultado = { ...alvo, items: [...(alvo.items || []), novoItem] };
    depois = antes.map((it) => (String(it.id) === String(params.id) ? itemResultado : it));
    resumoLog = `Adicionou item em ${cfg.label} #${params.id}: "${novoItem.text}".`;
  } else if (acao === "item_remover") {
    const alvo = encontrarPorId(antes, params.id);
    if (!alvo) return { ok: false, erro: "nao_encontrado" };
    const existia = (alvo.items || []).some((i) => String(i.id) === String(params.itemId));
    if (!existia) return { ok: false, erro: "item_nao_encontrado" };
    itemResultado = { ...alvo, items: (alvo.items || []).filter((i) => String(i.id) !== String(params.itemId)) };
    depois = antes.map((it) => (String(it.id) === String(params.id) ? itemResultado : it));
    resumoLog = `Removeu item de ${cfg.label} #${params.id}.`;
  } else {
    return { ok: false, erro: "acao_nao_implementada" };
  }

  const undoId = await gravarUndoAdmin(sql, cfg.key, antes);
  await setKvList(sql, cfg.key, depois);

  // Ordem de verdade: relê a própria coleção pra confirmar que a escrita pegou
  // antes de responder "feito" — nunca confia só no `depois` calculado em memória.
  const releitura = await getKvList(sql, cfg.key);
  const confirmado2 = params.id ? !!encontrarPorId(releitura, params.id) || acao === "apagar" : releitura.length === depois.length;
  await logAcaoAdmin(sql, dominio, acao, resumoLog, { antes: antes.length, depois: releitura.length });

  return { ok: true, reply: resumoLog, item: itemResultado ? cfg.map(itemResultado) : null, undoId, confirmado: confirmado2, label: cfg.label };
}

function getItemStatus(dominio, it) {
  if (dominio === "tarefa") return getTaskStatus(it);
  if (dominio === "conta") return it.paid ? "paga" : "pendente";
  if (dominio === "lembrete") return it.done ? "feito" : "pendente";
  return null;
}

async function moverParaLixeira(sql, key, itens) {
  const trash = await getKvList(sql, `${key}_trash_v1`);
  const comData = itens.map((it) => ({ ...it, deletedAt: new Date().toISOString() }));
  await setKvList(sql, `${key}_trash_v1`, [...comData, ...trash]);
}

function construirNovoItem(dominio, params) {
  const id = Date.now();
  if (dominio === "tarefa") return { id, text: params.texto, prio: params.prioridade || "normal", status: "todo", done: false, date: new Date().toISOString(), notes: [], updates: [] };
  if (dominio === "compromisso") return { id, title: params.titulo, date: params.data || todayISO(), time: params.hora || "", local: params.local || "", cat: params.categoria || "Pessoal", notes: params.notas || "" };
  if (dominio === "conta") return { id, name: params.nome, value: Number(params.valor) || 0, dueDay: Number(params.diaVencimento) || 1, cat: params.categoria || "Fixo", recurrent: params.recorrente !== false, paid: false };
  if (dominio === "ideia") return { id, text: params.texto, tag: params.tag || "", mood: "💡", date: new Date().toISOString() };
  if (dominio === "lembrete") return { id, text: params.texto, mood: "🔔", done: false, date: new Date().toISOString() };
  if (dominio === "lista") return { id, title: params.titulo, text: "", items: [], created: new Date().toLocaleString("pt-BR") };
  if (dominio === "nota") return { id, title: params.titulo || "", notes: params.notas || "", tags: Array.isArray(params.tags) ? params.tags : [], date: new Date().toLocaleString("pt-BR") };
  return { id };
}

const CAMPOS_PERMITIDOS_ATUALIZAR = {
  tarefa: ["text", "prio"],
  compromisso: ["title", "date", "time", "local", "cat", "notes"],
  conta: ["name", "value", "dueDay", "cat"],
  ideia: ["text", "tag"],
  lembrete: ["text"],
  nota: ["title", "notes", "tags"],
};

function aplicarAtualizacao(dominio, item, campos) {
  const permitidos = CAMPOS_PERMITIDOS_ATUALIZAR[dominio] || [];
  const filtrados = Object.fromEntries(Object.entries(campos || {}).filter(([k]) => permitidos.includes(k)));
  return { ...item, ...filtrados };
}

function aplicarMovimentacao(dominio, item, params) {
  if (dominio === "tarefa") {
    const validos = ["now", "today", "todo", "doing", "done", "standby"];
    if (!validos.includes(params.status)) return null;
    return { ...item, status: params.status, done: params.status === "done" };
  }
  if (dominio === "compromisso") {
    if (!params.data && !params.hora) return null;
    return { ...item, date: params.data || item.date, time: params.hora ?? item.time };
  }
  return null;
}

function aplicarConclusao(dominio, item) {
  if (dominio === "tarefa") return { ...item, status: "done", done: true };
  if (dominio === "lembrete") return { ...item, done: true };
  if (dominio === "conta") {
    const month = finCurMonth();
    return item.recurrent ? { ...item, paid: true, paidMonths: [...(item.paidMonths || []), month] } : { ...item, paid: true };
  }
  return item;
}

// ---------- ADMIN-1 PARTE B.4: "Verificar agora" no painel -> Worker ----------
// Mesmo par de segredo de servidor que cmdChat já usa (WORKER_URL +
// JARBAS_WORKER_SYNC_KEY) — protegida pela sessão do painel, nunca pela
// JARBAS_API_KEY (igual chat/desfazer).
export async function cmdVerificarJanela(sql, body) {
  const workerUrl = process.env.WORKER_URL;
  const workerKey = process.env.JARBAS_WORKER_SYNC_KEY;
  if (!workerUrl || !workerKey) return { status: 500, data: { error: "worker_not_configured" } };
  try {
    const r = await fetchWithTimeout(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "painel_verificar_janela", key: workerKey, janelaId: body?.janelaId || null }),
    }, 20000);
    if (!r.ok) return { status: 502, data: { error: "worker_error", detail: `http_${r.status}` } };
    const data = await r.json();
    return { status: 200, data };
  } catch (e) {
    return { status: 502, data: { error: "worker_unreachable", detail: e.message } };
  }
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
  //
  // PAINEL-3: "chat" e "desfazer" são o INVERSO — chamadas do NAVEGADOR (a barra de
  // comando @jarbas), nunca do Worker, então exigem sessão do painel, nunca a
  // JARBAS_API_KEY. A ponte pro Worker (cmdChat) usa seu PRÓPRIO segredo de servidor
  // (JARBAS_WORKER_SYNC_KEY), nunca repassando nem expondo a JARBAS_API_KEY.
  const isLogRead = req.method === "GET" && action === "log_read";
  const isPainelBridgeAction = req.method === "POST" && (action === "chat" || action === "desfazer" || action === "desfazer_ultima" || action === "verificar_janela");

  if (!hasJarbasKey) {
    if ((!isLogRead && !isPainelBridgeAction) || !(await requireSession(req))) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: CORS });
    }
  } else if (isPainelBridgeAction) {
    // "chat"/"desfazer" são SÓ do painel — nunca aceitas com a JARBAS_API_KEY (que
    // identificaria o Worker, não a pessoa), mesmo que alguém mande as duas coisas.
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: CORS });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);

    if (req.method === "GET" && searchParams.get("action") === "snapshot") {
      const texto = await getSnapshotText(sql, searchParams.get("dia") || "");
      return new Response(JSON.stringify({ texto }), { headers: CORS });
    }
    if (req.method === "GET" && searchParams.get("action") === "agenda") {
      // PARTE D (Jarbas): data/intervalo arbitrário, se vier `data` (AAAA-MM-DD) — o
      // parâmetro antigo `dia` (hoje|amanha) continua funcionando quando `data` não vem.
      const dataParam = searchParams.get("data") || "";
      if (/^\d{4}-\d{2}-\d{2}$/.test(dataParam)) {
        const ateParam = searchParams.get("ate") || "";
        const dataFim = /^\d{4}-\d{2}-\d{2}$/.test(ateParam) && ateParam >= dataParam ? ateParam : dataParam;
        const { texto, eventos } = await getAgendaPorDataText(sql, dataParam, dataFim);
        return new Response(JSON.stringify({ texto, eventos }), { headers: CORS });
      }
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
    if (req.method === "GET" && action === "painel_resumo") {
      return new Response(JSON.stringify(await getPainelResumo(sql)), { headers: CORS });
    }
    if (req.method === "GET" && action === "painel_buscar") {
      return new Response(JSON.stringify(await getPainelBusca(sql, searchParams.get("q") || "")), { headers: CORS });
    }

    if (req.method === "POST" && action === "log_append") {
      const body = await req.json();
      const result = await cmdLogAppend(sql, body?.eventos);
      return new Response(JSON.stringify(result), { status: result.ok ? 200 : 400, headers: CORS });
    }

    if (req.method === "POST" && action === "chat") {
      const body = await req.json();
      const { status, data } = await cmdChat(sql, body, getClientIp(req));
      return new Response(JSON.stringify(data), { status, headers: CORS });
    }
    if (req.method === "POST" && action === "desfazer") {
      const body = await req.json();
      const { status, data } = await cmdDesfazer(sql, body?.id);
      return new Response(JSON.stringify(data), { status, headers: CORS });
    }
    if (req.method === "POST" && action === "desfazer_ultima") {
      const { status, data } = await cmdDesfazerUltima(sql);
      return new Response(JSON.stringify(data), { status, headers: CORS });
    }
    if (req.method === "POST" && action === "verificar_janela") {
      const body = await req.json();
      const { status, data } = await cmdVerificarJanela(sql, body);
      return new Response(JSON.stringify(data), { status, headers: CORS });
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
      else if (comando === "painel_gerenciar") result = await cmdPainelGerenciar(sql, arg || {});
      else if (comando === "desfazer_ultima_acao") { const r = await cmdDesfazerUltima(sql); result = { ok: r.status === 200, ...r.data }; }
      else result = { reply: "Comando desconhecido." };
      return new Response(JSON.stringify(result), { headers: CORS });
    }

    return new Response(JSON.stringify({ error: "invalid_request" }), { status: 400, headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
