export const config = { runtime: "edge" };
import { neon } from "@neondatabase/serverless";
import { requireSession } from "./_auth-lib.js";
import { pedroAtivo } from "./_pedro-standby.js";
import {
  PEDRO_KEYS, PEDRO_TOOLS, buildSystemPrompt, formatMsgTimestamp,
  applyManiasSeed, addMemory, pickFallbackReply,
} from "./_pedro-pet-lib.js";

// ─────────────────────────────────────────────────────────────────────────
// PEDRO (Painel) — bichinho virtual do Gustavo (ver docs/PEDRO-VIRTUAL.md).
//
// É um PET, não um assistente: este arquivo NÃO lê nenhuma chave do painel
// (tarefas, contas, agenda, diário do painel...) nem fala com Google/Outlook/
// clima. Só toca nas chaves próprias do sync_kv, todas "pedro_*":
//   pedro_memory_v1, pedro_learned_v1, pedro_push_subs, pedro_pet_v1.
// (O teste api/_pedro-isolation.test.mjs garante isso.)
//
// As tabelas legadas panel_pedro_* (intents/keywords/respostas/log) continuam
// no banco, intactas, mas NÃO são mais lidas nem escritas por ninguém.
//
// Todas as ações aqui (chat, push_subscribe/unsubscribe, admin_*) são
// chamadas só pelo navegador do painel — por isso o handler inteiro exige
// sessão (quando AUTH_ENFORCE=1), e não precisa de CORS aberto.
// ─────────────────────────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

// ---------- sync_kv (só chaves pedro_*) ----------
async function getKvList(sql, key) {
  const rows = await sql`SELECT value FROM sync_kv WHERE key=${key}`;
  if (!rows[0]) return [];
  try { const v = JSON.parse(rows[0].value); return Array.isArray(v) ? v : []; } catch { return []; }
}

async function getKvObject(sql, key) {
  const rows = await sql`SELECT value FROM sync_kv WHERE key=${key}`;
  if (!rows[0]) return null;
  try { const v = JSON.parse(rows[0].value); return v && typeof v === "object" && !Array.isArray(v) ? v : null; } catch { return null; }
}

async function setKv(sql, key, value) {
  const json = JSON.stringify(value);
  const ts = new Date().toISOString();
  await sql`INSERT INTO sync_kv (key, value, updated_at) VALUES (${key}, ${json}, ${ts})
            ON CONFLICT (key) DO UPDATE SET value=${json}, updated_at=${ts}`;
}

// Semeia as manias do Pedro real em pedro_memory_v1 (uma vez só, sem
// sobrescrever nada — ver applyManiasSeed). Devolve a lista de memórias atual.
async function ensureManiasSeed(sql) {
  const [memories, pet] = await Promise.all([getKvList(sql, PEDRO_KEYS.memory), getKvObject(sql, PEDRO_KEYS.pet)]);
  const r = applyManiasSeed(memories, pet);
  if (!r.changed) return memories;
  await setKv(sql, PEDRO_KEYS.memory, r.memories);
  await setKv(sql, PEDRO_KEYS.pet, r.pet);
  return r.memories;
}

async function cmdSaveMemory(sql, fact, categoria) {
  const memories = await getKvList(sql, PEDRO_KEYS.memory);
  const r = addMemory(memories, fact, { categoria });
  if (r.added) await setKv(sql, PEDRO_KEYS.memory, r.memories);
}

async function executeTool(sql, name, args) {
  try {
    if (name === "save_memory") { await cmdSaveMemory(sql, args.fact, args.categoria); return "ok"; } // silencioso, bastidor
    return "Ferramenta desconhecida.";
  } catch (e) {
    return `Deu um erro tentando fazer isso: ${e.message}`;
  }
}

// ---------- Groq (LLM real com tool calling) ----------
const GROQ_MODEL = "openai/gpt-oss-120b";

// ---------- Roteador de LLM (Groq / OpenAI) com fallback — mesma ideia do roteador do
// Worker do Jarbas, adaptada pro Pedro (Chat Completions + tools nos dois provedores).
// A Groq é compartilhada com o Worker do Jarbas e a transcrição de voz, então pode
// estourar cota/limite de requisições sem nenhum aviso aqui além do console — daí a
// reserva: se a Groq falhar, tenta a OpenAI antes de cair nas palavras-chave.
const PEDRO_LLM_TIMEOUT_MS = 20000;

// Circuit breaker em memória da instância — "melhor esforço": cada instância fria da
// função Edge começa com os contadores zerados (não persiste entre deploys nem é
// compartilhado entre instâncias), só evita martelar um provedor que falhou agora
// mesmo dentro da mesma instância "morna".
const PEDRO_LLM_CIRCUIT = new Map();
const PEDRO_LLM_CIRCUIT_THRESHOLD = 2;
const PEDRO_LLM_CIRCUIT_OPEN_MS = 60000;

export function pedroLlmCircuitIsOpen(name) {
  const c = PEDRO_LLM_CIRCUIT.get(name);
  return !!(c?.openUntil && Date.now() < c.openUntil);
}
function pedroLlmCircuitRecordTransientFailure(name) {
  const c = PEDRO_LLM_CIRCUIT.get(name) || { failCount: 0, openUntil: 0 };
  c.failCount++;
  if (c.failCount >= PEDRO_LLM_CIRCUIT_THRESHOLD) c.openUntil = Date.now() + PEDRO_LLM_CIRCUIT_OPEN_MS;
  PEDRO_LLM_CIRCUIT.set(name, c);
}
export function pedroLlmCircuitReset(name) {
  PEDRO_LLM_CIRCUIT.set(name, { failCount: 0, openUntil: 0 });
}

function pedroLlmProviderDefs() {
  return {
    groq: { name: "groq", url: "https://api.groq.com/openai/v1/chat/completions", apiKey: process.env.GROQ_API_KEY, model: GROQ_MODEL },
    openai: { name: "openai", url: "https://api.openai.com/v1/chat/completions", apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL || "gpt-4o-mini" },
  };
}

// Ordem configurável por PEDRO_LLM_ORDER (ex: "openai,groq"); padrão "groq,openai".
// Só entram na cadeia os provedores com chave configurada — com uma chave só, o
// comportamento é idêntico a chamar aquele provedor direto, como antes.
export function pedroLlmChain() {
  const order = (process.env.PEDRO_LLM_ORDER || "groq,openai").split(",").map(s => s.trim()).filter(Boolean);
  const defs = pedroLlmProviderDefs();
  const seen = new Set();
  const chain = [];
  for (const name of order) {
    if (seen.has(name)) continue;
    seen.add(name);
    const def = defs[name];
    if (def && def.apiKey) chain.push(def);
  }
  return chain;
}

// 400/401/403/404 = erro permanente (chave inválida, modelo descontinuado etc.) — não
// adianta repetir pro mesmo provedor, mas ainda tenta o próximo da cadeia. Qualquer
// outro status (429, 5xx) é tratado como transiente.
export function pedroLlmIsPermanentStatus(status) {
  return status === 400 || status === 401 || status === 403 || status === 404;
}

async function callLlmProvider(def, messages, tools) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PEDRO_LLM_TIMEOUT_MS);
  try {
    const r = await fetch(def.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${def.apiKey}` },
      body: JSON.stringify({ model: def.model, messages, tools, tool_choice: "auto", temperature: 0.7, max_tokens: 600 }),
      signal: controller.signal,
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      const err = new Error(`${def.name} API ${r.status}: ${errText.slice(0, 200)}`);
      err.status = r.status;
      err.retryAfter = Number(r.headers.get("retry-after")) || null;
      throw err;
    }
    return r.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

// Tenta cada provedor da cadeia em ordem. Erro transiente (429/5xx/timeout/rede) passa
// pro próximo provedor — exceção: 429 com Retry-After curto (até 2s) espera uma vez e
// tenta de novo o MESMO provedor antes de desistir dele. Erro permanente (400/401/403/
// 404) loga claro e também passa pro próximo. Só lança (e cai nas palavras-chave) se
// TODOS os provedores da cadeia falharem — o erro lançado carrega `.motivo` curto
// (ex: "groq_429") pro chamador expor no fallback.
export async function callLlmChain(messages, tools) {
  const chain = pedroLlmChain();
  if (!chain.length) {
    const err = new Error("Nenhum provedor de LLM configurado (GROQ_API_KEY/OPENAI_API_KEY ausentes).");
    err.motivo = "sem_chave";
    throw err;
  }

  let lastMotivo = "desconhecido";
  for (const def of chain) {
    if (pedroLlmCircuitIsOpen(def.name)) {
      console.error(`pedro_llm: ${def.name} em circuit breaker (falhou recentemente), pulando.`);
      lastMotivo = `${def.name}_circuito_aberto`;
      continue;
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const data = await callLlmProvider(def, messages, tools);
        pedroLlmCircuitReset(def.name);
        data._provider = def.name;
        return data;
      } catch (e) {
        const isTimeout = e.name === "AbortError";
        const status = e.status || null;
        const permanente = !isTimeout && status && pedroLlmIsPermanentStatus(status);
        const motivoCurto = isTimeout ? `${def.name}_timeout` : `${def.name}_${status || "erro_rede"}`;
        lastMotivo = motivoCurto;
        console.error(
          `pedro_llm: ${def.name} falhou (${permanente ? "permanente" : "transiente"}, tentativa ${attempt + 1}):`,
          isTimeout ? "timeout" : String(e.message || e)
        );

        if (!permanente) pedroLlmCircuitRecordTransientFailure(def.name);

        // 429 com Retry-After curto: espera uma vez e tenta de novo o mesmo provedor.
        if (!permanente && status === 429 && attempt === 0 && e.retryAfter && e.retryAfter > 0 && e.retryAfter <= 2) {
          await new Promise((resolve) => setTimeout(resolve, e.retryAfter * 1000));
          continue;
        }
        break; // qualquer outro caso: desiste deste provedor, vai pro próximo da cadeia
      }
    }
  }

  const err = new Error(`Todos os provedores de LLM falharam (último: ${lastMotivo}).`);
  err.motivo = lastMotivo;
  throw err;
}

async function handleLlmChat(sql, userMessage, history) {
  const [memories, learned, petState, diary] = await Promise.all([
    ensureManiasSeed(sql),
    getKvList(sql, PEDRO_KEYS.learned),
    getKvObject(sql, PEDRO_KEYS.pet),
    Promise.resolve([]), // pedro_diary_v1 entra na Fase 4 — por ora, contexto de diário vazio
  ]);

  const systemPrompt = buildSystemPrompt({ memories, learned, petState, diary });

  const messages = [
    { role: "system", content: systemPrompt },
    ...history.slice(-12).map(m => {
      const label = formatMsgTimestamp(m.at);
      const content = label && m.from !== "pedro" ? `[${label}] ${m.text}` : m.text;
      return { role: m.from === "pedro" ? "assistant" : "user", content };
    }),
    { role: "user", content: userMessage },
  ];

  let data = await callLlmChain(messages, PEDRO_TOOLS);
  let engine = data._provider;
  let choice = data.choices[0];
  let loops = 0;

  while (choice.message.tool_calls?.length && loops < 4) {
    messages.push(choice.message);
    for (const call of choice.message.tool_calls) {
      let args = {};
      try { args = JSON.parse(call.function.arguments || "{}"); } catch {}
      const result = await executeTool(sql, call.function.name, args);
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
    data = await callLlmChain(messages, PEDRO_TOOLS);
    engine = data._provider; // pode trocar de provedor entre chamadas — relata o ÚLTIMO que respondeu de fato
    choice = data.choices[0];
    loops++;
  }

  return { reply: choice.message.content?.trim() || "🐾", engine };
}

// Núcleo do chat, separado do handler HTTP pra ser testável com um `sql` falso.
// Devolve { status, body }.
export async function handleChat(sql, { message, history } = {}) {
  if (!message || !message.trim()) return { status: 400, body: { error: "Mensagem vazia" } };

  // "aprenda: ..." é um comando de ensino explícito — sempre prioritário, nunca passa pelo LLM
  const teachMatch = message.trim().match(/^aprenda\s*[:\-]\s*(.+)/i);
  if (teachMatch) {
    const rule = teachMatch[1].trim();
    if (!rule) return { status: 200, body: { reply: "Me fala o que devo aprender depois dos dois pontos! Tipo \"aprenda: X\" 🐾" } };
    const learned = await getKvList(sql, PEDRO_KEYS.learned);
    learned.push({ id: Date.now(), text: rule, at: new Date().toISOString() });
    await setKv(sql, PEDRO_KEYS.learned, learned.slice(-150));
    return { status: 200, body: { reply: "Anotado! 📝🐾 Da próxima vez que rolar essa situação, já sei o que fazer." } };
  }

  // LLM real (Groq, com reserva na OpenAI). Se TODA a cadeia falhar (ou nenhuma chave
  // estiver configurada), o Pedro responde com um miado simpático — sem palavras-chave,
  // sem banco. fallbackMotivo registra o porquê (ver callLlmChain).
  try {
    const { reply, engine } = await handleLlmChat(sql, message.trim(), history || []);
    return { status: 200, body: { reply, engine } };
  } catch (e) {
    console.error("LLM do Pedro falhou (todos os provedores), usando resposta de reserva:", e.message);
    return { status: 200, body: { reply: pickFallbackReply(), engine: "fallback", fallbackMotivo: e.motivo || "desconhecido" } };
  }
}

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (!(await requireSession(req))) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: CORS });
  }

  // Pedro em stand by (ver docs/PEDRO-STANDBY.md): responde ANTES de abrir
  // qualquer conexão com o Neon, chamar o LLM ou mexer em push — nenhuma
  // action (chat, push_subscribe/unsubscribe, admin_*) escapa disso.
  if (!pedroAtivo()) {
    return new Response(JSON.stringify({ standby: true, reply: "O Pedro está em stand by." }), { headers: CORS });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);

    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");

    if (action === "push_subscribe" && req.method === "POST") {
      const { subscription } = await req.json();
      if (!subscription?.endpoint) return new Response(JSON.stringify({ error: "subscription inválida" }), { status: 400, headers: CORS });
      const subs = await getKvList(sql, PEDRO_KEYS.pushSubs);
      const filtered = subs.filter(s => s.endpoint !== subscription.endpoint);
      await setKv(sql, PEDRO_KEYS.pushSubs, [...filtered, subscription]);
      return new Response(JSON.stringify({ ok: true }), { headers: CORS });
    }

    if (action === "push_unsubscribe" && req.method === "POST") {
      const { endpoint } = await req.json();
      const subs = await getKvList(sql, PEDRO_KEYS.pushSubs);
      await setKv(sql, PEDRO_KEYS.pushSubs, subs.filter(s => s.endpoint !== endpoint));
      return new Response(JSON.stringify({ ok: true }), { headers: CORS });
    }

    if (action === "chat" && req.method === "POST") {
      const body = await req.json();
      const r = await handleChat(sql, body);
      return new Response(JSON.stringify(r.body), { status: r.status, headers: CORS });
    }

    // ============ ADMIN — MEMÓRIA E ENSINADO ============
    // Protegido junto com o resto do handler pelo requireSession no topo.
    // (Os antigos admin_intents/keywords/responses/unmatched foram desligados;
    // as tabelas panel_pedro_* continuam no banco, só não são mais usadas.)

    if (action === "admin_memory" && req.method === "GET") {
      const memories = await ensureManiasSeed(sql);
      return new Response(JSON.stringify({ memories: [...memories].reverse() }), { headers: CORS });
    }

    if (action === "admin_memory_delete" && req.method === "POST") {
      const { id } = await req.json();
      const memories = await getKvList(sql, PEDRO_KEYS.memory);
      await setKv(sql, PEDRO_KEYS.memory, memories.filter(m => m.id !== id));
      return new Response(JSON.stringify({ ok: true }), { headers: CORS });
    }

    if (action === "admin_learned" && req.method === "GET") {
      const learned = await getKvList(sql, PEDRO_KEYS.learned);
      return new Response(JSON.stringify({ learned: [...learned].reverse() }), { headers: CORS });
    }

    if (action === "admin_learned_delete" && req.method === "POST") {
      const { id } = await req.json();
      const learned = await getKvList(sql, PEDRO_KEYS.learned);
      await setKv(sql, PEDRO_KEYS.learned, learned.filter(l => l.id !== id));
      return new Response(JSON.stringify({ ok: true }), { headers: CORS });
    }

    return new Response(JSON.stringify({ error: "Ação inválida" }), { status: 400, headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
