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

// ---------- Conectores externos ----------
async function getWeatherReply(message) {
  try {
    const m = normalize(message).match(/(?:em|de|no|na)\s+([a-z\s]+)$/);
    const city = m ? m[1].trim() : null;
    if (!city) return "Me fala o nome da cidade que eu confiro o tempo pra você! Tipo \"vai chover em Jundiaí\" 🐾🌦️";
    const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=pt`);
    const geoData = await geoRes.json();
    const place = geoData?.results?.[0];
    if (!place) return "Não achei essa cidade aqui no mapa 🐾🗺️ Confere o nome?";
    const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,precipitation&timezone=auto`);
    const wData = await wRes.json();
    const cur = wData?.current;
    if (!cur) return "Consultei as nuvens mas elas não quiseram falar comigo agora 😹 tenta de novo?";
    const temp = Math.round(cur.temperature_2m);
    const chuva = cur.precipitation > 0 ? `e tem chuva rolando (${cur.precipitation}mm) ☔` : "sem chuva no momento ☀️";
    return `Em ${place.name} agora tá ${temp}°C, ${chuva} 🐾`;
  } catch (e) {
    return "Tentei checar o tempo mas escorreguei numa nuvem 😹 tenta de novo daqui a pouco?";
  }
}

async function getAgendaHojeReply(sql) {
  try {
    const rows = await sql`SELECT value FROM sync_kv WHERE key='events_v1'`;
    const events = rows[0] ? JSON.parse(rows[0].value) : [];
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const hoje = (events || []).filter(e => e.date === todayStr).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    if (!hoje.length) return "Hoje sua agenda tá livre! Aproveita pra respirar um pouco 🐾😌";
    const lista = hoje.slice(0, 5).map(e => `• ${e.time ? e.time + " — " : ""}${e.title}`).join("\n");
    return `Hoje você tem:\n${lista}\n\nQuer que eu te avise antes de cada um? 🐾`;
  } catch (e) {
    return "Fui olhar sua agenda mas derrubei a xícara no caminho 😹 tenta de novo?";
  }
}

async function getTasksPendingReply(sql) {
  try {
    const rows = await sql`SELECT text, prio FROM tasks WHERE done=false OR done IS NULL ORDER BY id DESC`;
    if (!rows.length) return "Suas tarefas estão todas em dia! Nenhuma pendente 🐾✅";
    const altas = rows.filter(r => r.prio === "alta").length;
    const lista = rows.slice(0, 5).map(r => `• ${r.text}${r.prio === "alta" ? " 🔴" : ""}`).join("\n");
    const extra = rows.length > 5 ? `\n...e mais ${rows.length - 5} 🐾` : "";
    return `Você tem ${rows.length} tarefa(s) pendente(s)${altas ? `, ${altas} de prioridade alta` : ""}:\n${lista}${extra}`;
  } catch (e) {
    return "Fui contar suas tarefas mas perdi as contas na pata 😹 tenta de novo?";
  }
}

async function getBillsPendingReply(sql) {
  try {
    const rows = await sql`SELECT name, value, due_day FROM bills WHERE paid=false OR paid IS NULL ORDER BY due_day ASC`;
    if (!rows.length) return "Nenhuma conta pendente! Tudo pago 🐾💰";
    const total = rows.reduce((s, r) => s + Number(r.value || 0), 0);
    const totalFmt = total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const lista = rows.slice(0, 5).map(r => `• ${r.name} — ${Number(r.value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}${r.due_day ? ` (dia ${r.due_day})` : ""}`).join("\n");
    const extra = rows.length > 5 ? `\n...e mais ${rows.length - 5} 🐾` : "";
    return `Você tem ${rows.length} conta(s) pendente(s), totalizando ${totalFmt}:\n${lista}${extra}`;
  } catch (e) {
    return "Fui olhar suas contas mas a calculadora escorregou da pata 😹 tenta de novo?";
  }
}

// ---------- Seed padrão (personalidade do Pedro do Painel) ----------
async function ensureSeed(sql) {
  const existing = await sql`SELECT id FROM panel_pedro_intents LIMIT 1`;
  if (existing.length) return;

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
    { name: "fallback", category: "Fallback",
      responses: ["Hmm, ainda não sei responder isso, mas tô aprendendo! 🐱", "Não captei direito, pode reformular? 🐾", "Essa eu ainda não conheço, mas vou lembrar disso! 🐱"] },
  ];

  for (const d of DEFS) {
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
      const { message } = await req.json();
      if (!message || !message.trim()) {
        return new Response(JSON.stringify({ error: "Mensagem vazia" }), { status: 400, headers: CORS });
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
        if (matched.external_type === "weather") reply = await getWeatherReply(message);
        else if (matched.external_type === "agenda_today") reply = await getAgendaHojeReply(sql);
        else if (matched.external_type === "tasks_pending") reply = await getTasksPendingReply(sql);
        else if (matched.external_type === "bills_pending") reply = await getBillsPendingReply(sql);
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
