export const config = { runtime: "edge" };
import { neon } from "@neondatabase/serverless";

// ─────────────────────────────────────────────────────────────────────────
// PEDRO (Painel) — assistente IA do Painel de Controle Pessoal.
// Mesma mecânica do Pedro do Daily (intents + keywords + fuzzy match),
// porém 100% independente: banco próprio (mesmo Neon do painel, tabelas
// prefixadas panel_pedro_*), sem nenhuma dependência de código do Daily.
// ─────────────────────────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

// ---------- Brain (normalize + fuzzy match) ----------
function normalize(text) {
  return (text || "")
    .toString()
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const al = a.length, bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  const dp = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) dp[j] = j;
  for (let i = 1; i <= al; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= bl; j++) {
      const temp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = temp;
    }
  }
  return dp[bl];
}

function fuzzyThreshold(len) {
  if (len <= 3) return 0;
  if (len <= 6) return 1;
  return 2;
}

function wordsMatch(inputWord, keywordWord) {
  if (inputWord === keywordWord) return true;
  const threshold = fuzzyThreshold(keywordWord.length);
  if (threshold === 0) return false;
  if (Math.abs(inputWord.length - keywordWord.length) > threshold) return false;
  return levenshtein(inputWord, keywordWord) <= threshold;
}

function matchIntent(message, intents) {
  const normMsg = normalize(message);
  if (!normMsg) return null;
  const msgWords = normMsg.split(" ");
  let best = null, bestScore = 0;
  for (const intent of intents) {
    if (intent.name === "fallback") continue;
    for (const kw of intent.keywords) {
      const normKw = normalize(kw);
      if (!normKw) continue;
      if (normKw.includes(" ")) {
        if (normMsg.includes(normKw)) {
          const score = normKw.length * 2;
          if (score > bestScore) { bestScore = score; best = intent; }
        }
        continue;
      }
      for (const w of msgWords) {
        if (wordsMatch(w, normKw)) {
          const score = normKw.length;
          if (score > bestScore) { bestScore = score; best = intent; }
        }
      }
    }
  }
  return best;
}

function pickRandom(arr) {
  if (!arr || !arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---------- Helpers de leitura do sync_kv (fonte real dos dados do painel) ----------
async function getKvList(sql, key) {
  const rows = await sql`SELECT value FROM sync_kv WHERE key=${key}`;
  if (!rows[0]) return [];
  try { const v = JSON.parse(rows[0].value); return Array.isArray(v) ? v : []; } catch { return []; }
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function setKvList(sql, key, list) {
  const value = JSON.stringify(list);
  const ts = new Date().toISOString();
  await sql`INSERT INTO sync_kv (key, value, updated_at) VALUES (${key}, ${value}, ${ts})
            ON CONFLICT (key) DO UPDATE SET value=${value}, updated_at=${ts}`;
}

// ---------- Comandos (Pedro age, não só responde) ----------
function parseWhen(text) {
  const t = text.toLowerCase();
  const now = new Date();
  let date = null;
  if (/\bhoje\b/.test(t)) date = new Date(now);
  else if (/\bamanh[aã]\b/.test(t)) { date = new Date(now); date.setDate(date.getDate() + 1); }
  else {
    const dm = t.match(/\b(?:dia\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (dm) {
      const d = parseInt(dm[1]), m = parseInt(dm[2]);
      const y = dm[3] ? (dm[3].length === 2 ? 2000 + parseInt(dm[3]) : parseInt(dm[3])) : now.getFullYear();
      date = new Date(y, m - 1, d);
    }
  }
  let time = null;
  const tm = t.match(/\b(?:as|às)\s+(\d{1,2})[:h](\d{2})?\b/) || t.match(/\b(\d{1,2})[:h](\d{2})\b/);
  if (tm) {
    const h = String(parseInt(tm[1])).padStart(2, "0");
    const mi = String(tm[2] ? parseInt(tm[2]) : 0).padStart(2, "0");
    time = `${h}:${mi}`;
  }
  return { date, time };
}

function stripWhen(text) {
  return text
    .replace(/\b(hoje|amanh[ãa])\b/gi, "")
    .replace(/\b(?:dia\s+)?\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/gi, "")
    .replace(/\b(?:as|às)\s+\d{1,2}[:h]\d{0,2}\b/gi, "")
    .replace(/\b\d{1,2}[:h]\d{2}\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/^[,\-–\s]+|[,\-–\s]+$/g, "");
}

function matchCommand(message) {
  const text = message.trim();
  let m;
  if ((m = text.match(/^(?:cria|criar|adiciona|adicionar|nova|novo)\s+tarefa[:\s]+(.+)/i))) return { type: "add_task", arg: m[1].trim() };
  if ((m = text.match(/^marca(?:r)?\s+(?:a\s+)?tarefa\s+(.+?)\s+como\s+feita/i))) return { type: "complete_task", arg: m[1].trim() };
  if ((m = text.match(/^(?:conclu[ií]|concluir|termina|terminei|finaliza|finalizei)\s+(?:a\s+tarefa\s+)?(.+)/i))) return { type: "complete_task", arg: m[1].trim() };
  if ((m = text.match(/^marca(?:r)?\s+(?:a\s+)?conta\s+(.+?)\s+como\s+paga/i))) return { type: "pay_bill", arg: m[1].trim() };
  if ((m = text.match(/^(?:paguei|pagar)\s+(?:a\s+)?conta\s+(.+)/i))) return { type: "pay_bill", arg: m[1].trim() };
  if ((m = text.match(/^(?:cria|criar|marca|marcar|agenda|agendar)\s+(?:um\s+)?compromisso[:\s]+(.+)/i))) return { type: "add_event", arg: m[1].trim() };
  return null;
}

async function cmdAddTask(sql, title) {
  if (!title) return "Me fala o texto da tarefa! Tipo \"cria tarefa: comprar ração\" 🐾";
  const tasks = await getKvList(sql, "tasks_v1");
  const t = { id: Date.now(), text: title, prio: "normal", status: "todo", done: false, date: new Date().toISOString(), notes: [], updates: [] };
  await setKvList(sql, "tasks_v1", [t, ...tasks]);
  return `Anotado! ✅ Criei a tarefa "${title}" pra você 🐾`;
}

async function cmdCompleteTask(sql, query) {
  const tasks = await getKvList(sql, "tasks_v1");
  const nq = normalize(query);
  const match = tasks.find(t => normalize(t.text).includes(nq) && (t.status || (t.done ? "done" : "todo")) !== "done");
  if (!match) return `Não achei nenhuma tarefa pendente parecida com "${query}" 🐾 confere o nome?`;
  const updated = tasks.map(t => t.id === match.id ? { ...t, status: "done", done: true } : t);
  await setKvList(sql, "tasks_v1", updated);
  return `Boa! Marquei "${match.text}" como concluída ✅🐾`;
}

async function cmdPayBill(sql, query) {
  const bills = await getKvList(sql, "bills_v1");
  const nq = normalize(query);
  const match = bills.find(b => normalize(b.name).includes(nq) && !b.paid);
  if (!match) return `Não achei nenhuma conta pendente parecida com "${query}" 🐾 confere o nome?`;
  const updated = bills.map(b => b.id === match.id ? { ...b, paid: true } : b);
  await setKvList(sql, "bills_v1", updated);
  return `Marquei "${match.name}" como paga! 💰🐾`;
}

async function cmdAddEvent(sql, rawText) {
  const { date, time } = parseWhen(rawText);
  const title = stripWhen(rawText) || rawText;
  if (!date) return `Pra criar o compromisso "${title}" preciso saber o dia — fala "hoje", "amanhã" ou "dia DD/MM" 🐾`;
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const events = await getKvList(sql, "events_v1");
  const ev = { id: Date.now(), title, date: dateStr, time: time || "", local: "", cat: "Pessoal", notes: "" };
  await setKvList(sql, "events_v1", [ev, ...events]);
  const [, m, d] = dateStr.split("-");
  return `Criei o compromisso "${title}" pra ${d}/${m}${time ? ` às ${time}` : ""} 📅🐾`;
}

// ---------- Conectores externos ----------
async function getWeatherReply(message, coords) {
  try {
    let lat = coords?.lat, lon = coords?.lon, placeName = null;
    const m = normalize(message).match(/(?:em|de|no|na)\s+([a-z\s]+)$/);
    const city = m ? m[1].trim() : null;
    if (city) {
      const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=pt`);
      const geoData = await geoRes.json();
      const place = geoData?.results?.[0];
      if (!place) return "Não achei essa cidade aqui no mapa 🐾🗺️ Confere o nome?";
      lat = place.latitude; lon = place.longitude; placeName = place.name;
    }
    if (lat == null || lon == null) {
      return "Me fala o nome da cidade que eu confiro o tempo pra você! Tipo \"vai chover em Jundiaí\" 🐾🌦️ (ou libera a localização na página Clima que eu passo a saber automático)";
    }
    const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,precipitation&timezone=auto`);
    const wData = await wRes.json();
    const cur = wData?.current;
    if (!cur) return "Consultei as nuvens mas elas não quiseram falar comigo agora 😹 tenta de novo?";
    const temp = Math.round(cur.temperature_2m);
    const chuva = cur.precipitation > 0 ? `e tem chuva rolando (${cur.precipitation}mm) ☔` : "sem chuva no momento ☀️";
    return `${placeName ? `Em ${placeName} agora` : "Aqui agora"} tá ${temp}°C, ${chuva} 🐾`;
  } catch (e) {
    return "Tentei checar o tempo mas escorreguei numa nuvem 😹 tenta de novo daqui a pouco?";
  }
}

async function getAgendaHojeReply(sql) {
  try {
    const events = await getKvList(sql, "events_v1");
    const todayStr = todayISO();
    const hoje = events.filter(e => e.date === todayStr).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    if (!hoje.length) return "Hoje sua agenda tá livre! Aproveita pra respirar um pouco 🐾😌";
    const lista = hoje.slice(0, 5).map(e => `• ${e.time ? e.time + " — " : ""}${e.title}`).join("\n");
    return `Hoje você tem:\n${lista}\n\nQuer que eu te avise antes de cada um? 🐾`;
  } catch (e) {
    return "Fui olhar sua agenda mas derrubei a xícara no caminho 😹 tenta de novo?";
  }
}

async function getTasksPendingReply(sql) {
  try {
    const tasks = await getKvList(sql, "tasks_v1");
    const pending = tasks.filter(t => (t.status || (t.done ? "done" : "todo")) !== "done");
    if (!pending.length) return "Suas tarefas estão todas em dia! Nenhuma pendente 🐾✅";
    const altas = pending.filter(t => t.prio === "alta").length;
    const lista = pending.slice(0, 5).map(t => `• ${t.text}${t.prio === "alta" ? " 🔴" : ""}`).join("\n");
    const extra = pending.length > 5 ? `\n...e mais ${pending.length - 5} 🐾` : "";
    return `Você tem ${pending.length} tarefa(s) pendente(s)${altas ? `, ${altas} de prioridade alta` : ""}:\n${lista}${extra}`;
  } catch (e) {
    return "Fui contar suas tarefas mas perdi as contas na pata 😹 tenta de novo?";
  }
}

async function getBillsPendingReply(sql) {
  try {
    const bills = await getKvList(sql, "bills_v1");
    const pending = bills.filter(b => !b.paid);
    if (!pending.length) return "Nenhuma conta pendente! Tudo pago 🐾💰";
    const total = pending.reduce((s, b) => s + Number(b.value || 0), 0);
    const totalFmt = total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const sorted = [...pending].sort((a, b) => (+a.dueDay || 99) - (+b.dueDay || 99));
    const lista = sorted.slice(0, 5).map(b => `• ${b.name} — ${Number(b.value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}${b.dueDay ? ` (dia ${b.dueDay})` : ""}`).join("\n");
    const extra = pending.length > 5 ? `\n...e mais ${pending.length - 5} 🐾` : "";
    return `Você tem ${pending.length} conta(s) pendente(s), totalizando ${totalFmt}:\n${lista}${extra}`;
  } catch (e) {
    return "Fui olhar suas contas mas a calculadora escorregou da pata 😹 tenta de novo?";
  }
}

async function getResumoDiaReply(sql) {
  try {
    const todayStr = todayISO();
    const [events, tasks, bills] = await Promise.all([
      getKvList(sql, "events_v1"), getKvList(sql, "tasks_v1"), getKvList(sql, "bills_v1"),
    ]);
    const hojeEventos = events.filter(e => e.date === todayStr).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    const pendTasks = tasks.filter(t => (t.status || (t.done ? "done" : "todo")) !== "done");
    const hojeTasks = pendTasks.filter(t => t.status === "today");
    const dia = new Date().getDate();
    const contasVencendo = bills.filter(b => !b.paid && +b.dueDay >= dia && +b.dueDay <= dia + 5);

    const partes = [];
    partes.push(hojeEventos.length
      ? `📅 Agenda: ${hojeEventos.length} compromisso(s) hoje — ${hojeEventos.slice(0,3).map(e=>`${e.time?e.time+" ":""}${e.title}`).join(", ")}`
      : "📅 Agenda: livre hoje");
    partes.push(hojeTasks.length
      ? `✅ Tarefas de hoje: ${hojeTasks.length} (${pendTasks.length} pendentes no total)`
      : `✅ Tarefas: ${pendTasks.length} pendente(s) no total, nenhuma marcada pra hoje`);
    partes.push(contasVencendo.length
      ? `💳 Contas vencendo nos próximos dias: ${contasVencendo.length}`
      : "💳 Contas: nada vencendo nos próximos dias");

    return `Aqui vai o resumo do seu dia 🐾\n\n${partes.join("\n")}\n\nQuer que eu detalhe algum desses pontos?`;
  } catch (e) {
    return "Tentei montar seu resumo mas me enrolei nos papéis 😹 tenta de novo?";
  }
}

async function getHumorRecenteReply(sql) {
  try {
    const entries = await getKvList(sql, "diary_v1");
    const seteDiasAtras = Date.now() - 7 * 86400000;
    const recentes = entries.filter(e => new Date(e.date).getTime() >= seteDiasAtras);
    if (!recentes.length) return "Ainda não tenho registros seus no Diário dos últimos dias 🐾 quando quiser desabafar, é só escrever lá!";
    const bons = ["😄", "🙂", "🎉"], ruins = ["😔", "😤"];
    const nBons = recentes.filter(e => bons.includes(e.mood)).length;
    const nRuins = recentes.filter(e => ruins.includes(e.mood)).length;
    if (nRuins > nBons) return `Reparei que nos últimos dias você andou mais para baixo por aqui (${nRuins} registro(s) mais difíceis). Tudo bem com você? Se quiser conversar ou organizar algo pra aliviar, tô aqui 💛🐾`;
    if (nBons > nRuins) return `Pelo que anotou no Diário essa semana, você andou bem mais pra cima! 😻 ${nBons} registro(s) positivos. Segue assim! 🧡`;
    return "Vendo seus registros da semana, foi meio equilibrado — nem tudo perfeito, nem tudo ruim. Como você diria que foi essa semana? 🐾";
  } catch (e) {
    return "Fui olhar seu Diário mas me distraí no caminho 😹 tenta de novo?";
  }
}

// ---------- Seed padrão (personalidade do Pedro do Painel) ----------
async function ensureSeed(sql) {
  const DEFS = [
    { name: "greeting", category: "Saudação", keywords: ["oi", "ola", "opa", "eae", "e ai", "bom dia", "boa tarde", "boa noite", "salve"],
      responses: ["Oi! Que bom te ver por aqui 🐾", "Opa! Cheguei correndo pra te dar oi! 🐱", "Oi oi! Pronto pra organizar o dia? 🧡"] },
    { name: "mood_good", category: "Humor", keywords: ["bem", "otimo", "ótimo", "feliz", "tranquilo", "suave", "de boa", "tudo certo", "tudo bem", "animado"],
      responses: ["Que bom demais! Fico feliz junto com você 😻", "Isso sim que é notícia boa! Bora aproveitar o dia 🐾", "Adorei ouvir isso! Energia boa contagia 🧡"] },
    { name: "mood_bad", category: "Humor", keywords: ["mal", "cansado", "cansada", "estressado", "estressada", "ruim", "triste", "correria", "apertado", "sobrecarregado", "exausto", "exausta"],
      responses: ["Poxa, sinto muito. Quer que eu te ajude a organizar alguma coisa pra aliviar? 🐾💛", "Dias assim acontecem. Respira fundo — eu tô aqui se precisar de algo 🧡", "Entendo. Se quiser eu dou uma olhada nas suas tarefas e vemos o que dá pra ajeitar 🐱"] },
    { name: "mood_neutral", category: "Humor", keywords: ["mais ou menos", "na media", "normal", "levando", "indo"],
      responses: ["Entendi, dia neutro! Vamos ver se consigo melhorar ele um pouco 🐾", "Ok! Se precisar de uma força em algo, é só falar 🧡"] },
    { name: "thanks", category: "Cortesia", keywords: ["obrigado", "obrigada", "valeu", "vlw", "obg", "brigado"],
      responses: ["Disponha! Sempre por aqui 🐾", "Imagina! Pra isso eu tô aqui 🧡", "De nada! Qualquer coisa é só chamar 😸"] },
    { name: "bye", category: "Cortesia", keywords: ["tchau", "falou", "ate mais", "flw", "xau", "ate logo"],
      responses: ["Falou! Qualquer coisa tô por aqui 🐾", "Até mais! Vou ficar de olho na agenda pra você 🐱", "Tchau tchau! Volta sempre 🧡"] },
    { name: "praise_pedro", category: "Elogio", keywords: ["legal", "gostei", "voce e bom", "voce e otimo", "top", "sensacional", "gostei de vc", "gostei de voce"],
      responses: ["Aaah valeu! Fico todo derretido 🐾😻", "Isso me deixa super feliz! 🧡", "Ronronando de alegria aqui! 😸"] },
    { name: "agenda_hoje", category: "Agenda", is_external: 1, external_type: "agenda_today",
      keywords: ["agenda", "compromisso", "compromissos", "o que tenho hoje", "meus compromissos", "agenda de hoje", "compromissos hoje"] },
    { name: "weather", category: "Clima", is_external: 1, external_type: "weather",
      keywords: ["tempo", "clima", "vai chover", "previsao", "previsão"] },
    { name: "tarefas_pendentes", category: "Tarefas", is_external: 1, external_type: "tasks_pending",
      keywords: ["tarefas pendentes", "minhas tarefas", "o que tenho pra fazer", "tarefas", "pendencias", "pendências"] },
    { name: "contas_pendentes", category: "Contas", is_external: 1, external_type: "bills_pending",
      keywords: ["contas pendentes", "contas a pagar", "quanto tenho de conta", "minhas contas", "contas"] },
    { name: "resumo_dia", category: "Resumo", is_external: 1, external_type: "resumo_today",
      keywords: ["resumo do dia", "resumo do meu dia", "como ta meu dia", "como esta meu dia", "meu dia hoje", "resumo"] },
    { name: "humor_recente", category: "Humor", is_external: 1, external_type: "mood_recent",
      keywords: ["como fui essa semana", "meu humor recente", "como andei", "como tenho estado", "como venho estando", "meu humor"] },
    { name: "ajuda", category: "Ajuda", keywords: ["o que voce sabe fazer", "o que você sabe fazer", "me ajuda", "ajuda", "comandos", "o que voce faz"],
      responses: ["Consigo bem mais que bater papo! 🐾 Posso: contar sua agenda de hoje, listar tarefas e contas pendentes, dar um resumo do dia, comentar seu humor recente do Diário, avisar o clima — e também AGIR: \"cria tarefa: X\", \"concluí a tarefa X\", \"paguei a conta X\", \"cria compromisso X amanhã às 15h\". Manda ver! 🐱"] },
    { name: "fallback", category: "Fallback",
      responses: ["Hmm, ainda não sei responder isso, mas tô aprendendo! 🐱", "Não captei direito, pode reformular? 🐾", "Essa eu ainda não conheço, mas vou lembrar disso! 🐱"] },
  ];

  const existingNames = new Set((await sql`SELECT name FROM panel_pedro_intents`).map(r => r.name));

  for (const d of DEFS) {
    if (existingNames.has(d.name)) continue; // já existe (seed anterior ou editado pelo usuário) — não sobrescreve
    const intentId = crypto.randomUUID();
    await sql`INSERT INTO panel_pedro_intents (id, name, category, is_external, external_type, active)
              VALUES (${intentId}, ${d.name}, ${d.category}, ${d.is_external || 0}, ${d.external_type || null}, 1)
              ON CONFLICT (name) DO NOTHING`;
    for (const kw of (d.keywords || [])) {
      await sql`INSERT INTO panel_pedro_keywords (id, intent_id, keyword) VALUES (${crypto.randomUUID()}, ${intentId}, ${normalize(kw)})`;
    }
    for (const r of (d.responses || [])) {
      await sql`INSERT INTO panel_pedro_responses (id, intent_id, content, active) VALUES (${crypto.randomUUID()}, ${intentId}, ${r}, 1)`;
    }
  }
}

async function initTables(sql) {
  await sql`CREATE TABLE IF NOT EXISTS panel_pedro_intents (
    id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, category TEXT NOT NULL,
    is_external INTEGER DEFAULT 0, external_type TEXT,
    active INTEGER DEFAULT 1, created_at TIMESTAMPTZ DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS panel_pedro_keywords (
    id TEXT PRIMARY KEY, intent_id TEXT NOT NULL, keyword TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS panel_pedro_responses (
    id TEXT PRIMARY KEY, intent_id TEXT NOT NULL, content TEXT NOT NULL,
    active INTEGER DEFAULT 1, created_at TIMESTAMPTZ DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS panel_pedro_unmatched_log (
    id TEXT PRIMARY KEY, message TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`;
  await sql`CREATE INDEX IF NOT EXISTS idx_panel_pedro_kw_intent ON panel_pedro_keywords(intent_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_panel_pedro_rsp_intent ON panel_pedro_responses(intent_id)`;
  await ensureSeed(sql);
}

async function loadActiveIntents(sql) {
  const intents = await sql`SELECT * FROM panel_pedro_intents WHERE active=1`;
  const keywords = await sql`SELECT * FROM panel_pedro_keywords`;
  return intents.map(intent => ({
    ...intent,
    keywords: keywords.filter(k => k.intent_id === intent.id).map(k => k.keyword),
  }));
}

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const sql = neon(process.env.DATABASE_URL);
    await initTables(sql);

    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");

    if (action === "chat" && req.method === "POST") {
      const { message, coords } = await req.json();
      if (!message || !message.trim()) {
        return new Response(JSON.stringify({ error: "Mensagem vazia" }), { status: 400, headers: CORS });
      }

      // Comandos (criar/concluir tarefa, pagar conta, criar compromisso) têm prioridade sobre o chat comum
      const cmd = matchCommand(message.trim());
      if (cmd) {
        let reply;
        if (cmd.type === "add_task") reply = await cmdAddTask(sql, cmd.arg);
        else if (cmd.type === "complete_task") reply = await cmdCompleteTask(sql, cmd.arg);
        else if (cmd.type === "pay_bill") reply = await cmdPayBill(sql, cmd.arg);
        else if (cmd.type === "add_event") reply = await cmdAddEvent(sql, cmd.arg);
        return new Response(JSON.stringify({ reply, intent: cmd.type, action: cmd.type }), { headers: CORS });
      }

      const intents = await loadActiveIntents(sql);
      const matched = matchIntent(message, intents);

      if (!matched) {
        await sql`INSERT INTO panel_pedro_unmatched_log (id, message) VALUES (${crypto.randomUUID()}, ${message.trim()})`;
        const fallback = intents.find(i => i.name === "fallback");
        const responses = fallback ? await sql`SELECT content FROM panel_pedro_responses WHERE intent_id=${fallback.id} AND active=1` : [];
        const reply = pickRandom(responses.map(r => r.content)) || "Hmm, ainda não sei sobre isso! 🐱";
        return new Response(JSON.stringify({ reply, intent: "fallback" }), { headers: CORS });
      }

      if (matched.is_external) {
        let reply;
        if (matched.external_type === "weather") reply = await getWeatherReply(message, coords);
        else if (matched.external_type === "agenda_today") reply = await getAgendaHojeReply(sql);
        else if (matched.external_type === "tasks_pending") reply = await getTasksPendingReply(sql);
        else if (matched.external_type === "bills_pending") reply = await getBillsPendingReply(sql);
        else if (matched.external_type === "resumo_today") reply = await getResumoDiaReply(sql);
        else if (matched.external_type === "mood_recent") reply = await getHumorRecenteReply(sql);
        else reply = "Essa informação ainda não tá pronta aqui, mas em breve! 🐱";
        return new Response(JSON.stringify({ reply, intent: matched.name }), { headers: CORS });
      }

      const responses = await sql`SELECT content FROM panel_pedro_responses WHERE intent_id=${matched.id} AND active=1`;
      const reply = pickRandom(responses.map(r => r.content)) || "🐾";
      return new Response(JSON.stringify({ reply, intent: matched.name }), { headers: CORS });
    }

    // ============ ADMIN — GERENCIAR O CÉREBRO DO PEDRO ============
    // App pessoal (sem multiusuário), então sem checagem extra de auth aqui —
    // mesma exposição que as demais rotas /api/db já têm hoje.

    if (action === "admin_intents" && req.method === "GET") {
      const intents = await sql`SELECT * FROM panel_pedro_intents ORDER BY category`;
      const kwCounts = await sql`SELECT intent_id, COUNT(*) as c FROM panel_pedro_keywords GROUP BY intent_id`;
      const rspCounts = await sql`SELECT intent_id, COUNT(*) as c FROM panel_pedro_responses GROUP BY intent_id`;
      const result = intents.map(i => ({
        ...i,
        keyword_count: parseInt(kwCounts.find(k => k.intent_id === i.id)?.c || 0),
        response_count: parseInt(rspCounts.find(r => r.intent_id === i.id)?.c || 0),
      }));
      return new Response(JSON.stringify({ intents: result }), { headers: CORS });
    }

    if (action === "admin_intent_create" && req.method === "POST") {
      const { name, category, is_external, external_type } = await req.json();
      if (!name || !category) return new Response(JSON.stringify({ error: "name e category são obrigatórios" }), { status: 400, headers: CORS });
      const id = crypto.randomUUID();
      await sql`INSERT INTO panel_pedro_intents (id, name, category, is_external, external_type, active)
                VALUES (${id}, ${name.trim().toLowerCase().replace(/\s+/g, "_")}, ${category}, ${is_external ? 1 : 0}, ${external_type || null}, 1)`;
      return new Response(JSON.stringify({ ok: true, id }), { headers: CORS });
    }

    if (action === "admin_intent_toggle" && req.method === "POST") {
      const { id, active } = await req.json();
      await sql`UPDATE panel_pedro_intents SET active=${active ? 1 : 0} WHERE id=${id}`;
      return new Response(JSON.stringify({ ok: true }), { headers: CORS });
    }

    if (action === "admin_intent_delete" && req.method === "POST") {
      const { id } = await req.json();
      await sql`DELETE FROM panel_pedro_keywords WHERE intent_id=${id}`;
      await sql`DELETE FROM panel_pedro_responses WHERE intent_id=${id}`;
      await sql`DELETE FROM panel_pedro_intents WHERE id=${id}`;
      return new Response(JSON.stringify({ ok: true }), { headers: CORS });
    }

    if (action === "admin_keywords" && req.method === "GET") {
      const intentId = searchParams.get("intent_id");
      const keywords = await sql`SELECT * FROM panel_pedro_keywords WHERE intent_id=${intentId} ORDER BY keyword`;
      return new Response(JSON.stringify({ keywords }), { headers: CORS });
    }

    if (action === "admin_keyword_add" && req.method === "POST") {
      const { intent_id, keyword } = await req.json();
      if (!keyword || !keyword.trim()) return new Response(JSON.stringify({ error: "keyword obrigatória" }), { status: 400, headers: CORS });
      const id = crypto.randomUUID();
      await sql`INSERT INTO panel_pedro_keywords (id, intent_id, keyword) VALUES (${id}, ${intent_id}, ${normalize(keyword)})`;
      return new Response(JSON.stringify({ ok: true, id }), { headers: CORS });
    }

    if (action === "admin_keyword_delete" && req.method === "POST") {
      const { id } = await req.json();
      await sql`DELETE FROM panel_pedro_keywords WHERE id=${id}`;
      return new Response(JSON.stringify({ ok: true }), { headers: CORS });
    }

    if (action === "admin_responses" && req.method === "GET") {
      const intentId = searchParams.get("intent_id");
      const responses = await sql`SELECT * FROM panel_pedro_responses WHERE intent_id=${intentId} ORDER BY created_at`;
      return new Response(JSON.stringify({ responses }), { headers: CORS });
    }

    if (action === "admin_response_add" && req.method === "POST") {
      const { intent_id, content } = await req.json();
      if (!content || !content.trim()) return new Response(JSON.stringify({ error: "content obrigatório" }), { status: 400, headers: CORS });
      const id = crypto.randomUUID();
      await sql`INSERT INTO panel_pedro_responses (id, intent_id, content, active) VALUES (${id}, ${intent_id}, ${content.trim()}, 1)`;
      return new Response(JSON.stringify({ ok: true, id }), { headers: CORS });
    }

    if (action === "admin_response_toggle" && req.method === "POST") {
      const { id, active } = await req.json();
      await sql`UPDATE panel_pedro_responses SET active=${active ? 1 : 0} WHERE id=${id}`;
      return new Response(JSON.stringify({ ok: true }), { headers: CORS });
    }

    if (action === "admin_response_delete" && req.method === "POST") {
      const { id } = await req.json();
      await sql`DELETE FROM panel_pedro_responses WHERE id=${id}`;
      return new Response(JSON.stringify({ ok: true }), { headers: CORS });
    }

    if (action === "admin_unmatched" && req.method === "GET") {
      const logs = await sql`SELECT * FROM panel_pedro_unmatched_log ORDER BY created_at DESC LIMIT 100`;
      return new Response(JSON.stringify({ logs }), { headers: CORS });
    }

    if (action === "admin_unmatched_delete" && req.method === "POST") {
      const { id } = await req.json();
      await sql`DELETE FROM panel_pedro_unmatched_log WHERE id=${id}`;
      return new Response(JSON.stringify({ ok: true }), { headers: CORS });
    }

    return new Response(JSON.stringify({ error: "Ação inválida" }), { status: 400, headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
