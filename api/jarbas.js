export const config = { runtime: "edge" };
import { neon } from "@neondatabase/serverless";

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
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

const FIN_RECURRENT_TYPES = ["fixed", "subscription", "income"];
function finCurMonth() { return todayISO().slice(0, 7); }
function finIsPaid(e) { return e.recurrent ? (e.paidMonths || []).includes(finCurMonth()) : !!e.paid; }

// ---------- Leitura (o que o Jarbas "sabe") ----------
async function getSnapshotText(sql) {
  const todayStr = todayISO();
  const [events, tasks, finance] = await Promise.all([
    getKvList(sql, "events_v1"), getKvList(sql, "tasks_v1"), getKvList(sql, "finance_v1"),
  ]);

  const hojeEventos = events.filter(e => e.date === todayStr).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  const pendTasks = tasks.filter(t => (t.status || (t.done ? "done" : "todo")) !== "done");
  const pendBills = finance.filter(e => FIN_RECURRENT_TYPES.includes(e.type) && !finIsPaid(e));

  const partes = [];
  partes.push(hojeEventos.length
    ? `Agenda de hoje: ${hojeEventos.map(e => `${e.time ? e.time + " " : ""}${e.title}`).join("; ")}`
    : "Agenda de hoje: livre, nenhum compromisso.");
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
      const texto = await getSnapshotText(sql);
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
      else result = { reply: "Comando desconhecido." };
      return new Response(JSON.stringify(result), { headers: CORS });
    }

    return new Response(JSON.stringify({ error: "invalid_request" }), { status: 400, headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
