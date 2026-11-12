// ─────────────────────────────────────────────────────────────────────────
// Pedro virtual — lógica PURA do "pet" (sem rede, sem banco): prompt, tools,
// seed de manias, memória e respostas de reserva. Compartilhada pelo
// api/pedro.js e testável direto (api/_pedro-pet.test.mjs).
//
// Regra de ouro (docs/PEDRO-VIRTUAL.md): o Pedro é um bichinho, NÃO um
// assistente. Nada aqui lê dados do painel (tarefas, contas, agenda, clima,
// diário do painel...). As únicas chaves do sync_kv que ele conhece são as
// próprias, prefixadas com "pedro_".
// ─────────────────────────────────────────────────────────────────────────

export const PEDRO_KEYS = {
  memory: "pedro_memory_v1",
  learned: "pedro_learned_v1",
  pushSubs: "pedro_push_subs",
  pet: "pedro_pet_v1",
};

export const PEDRO_APELIDOS = ["pedro", "pedrinho", "pedruxo", "pedrão", "pedro timoti"];

export const PEDRO_CATEGORIAS = ["pessoa", "lugar", "plano", "mania_do_pedro", "momento"];

export function normalize(text) {
  return (text || "")
    .toString()
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- tempo (America/Sao_Paulo) ----------
export function brasiliaNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", weekday: "long", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(date);
  const get = (t) => parts.find(p => p.type === t)?.value;
  return { dateStr: `${get("year")}-${get("month")}-${get("day")}`, weekday: get("weekday"), time: `${get("hour")}:${get("minute")}` };
}

export function formatMsgTimestamp(ts) {
  if (!ts) return null;
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(ts));
  const get = (t) => parts.find(p => p.type === t)?.value;
  return `${get("weekday")} ${get("day")}/${get("month")} ${get("hour")}:${get("minute")}`;
}

export function relativeDayLabel(ts, now = new Date()) {
  if (!ts) return "data desconhecida";
  const dayStr = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const thenStr = dayStr(new Date(ts));
  const todayStr = dayStr(now);
  if (thenStr === todayStr) return "hoje";
  const diffDays = Math.round((new Date(todayStr) - new Date(thenStr)) / 86400000);
  if (diffDays === 1) return "ontem";
  if (diffDays > 1 && diffDays < 7) return `há ${diffDays} dias`;
  const parts = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(new Date(ts));
  const get = (t) => parts.find(p => p.type === t)?.value;
  return `em ${get("day")}/${get("month")}/${get("year")}`;
}

// ---------- memória ----------
// Seed inicial das manias do Pedro real (seção 3.2 da spec). São fatos que o
// Gustavo contou — tagueados como tal — e NUNCA sobrescrevem o que já existe.
export const PEDRO_MANIAS_SEED = [
  { id: "seed_mania_papeis", text: "O Pedro (real) adora dormir em cima de papéis, cadernos e na mesa de estudo do Gustavo — até no teclado e no monitor." },
  { id: "seed_mania_caixas", text: "O Pedro adora caixas e malas: cabe em qualquer buraco (mala aberta, caixa de papelão)." },
  { id: "seed_mania_poltrona", text: "O Pedro gosta da poltrona preta e do sofá com manta felpuda." },
  { id: "seed_mania_dormir", text: "O Pedro dorme muito, esticado de lado e de barriga pra cima; é relaxado, confiante e curioso." },
  { id: "seed_mania_pijama", text: "O Pedro tem um pijama/roupinha azul-marinho com biscoitos de gengibre." },
];

const SEED_FLAG = "manias_v1";

// Idempotente: só semeia uma vez (flag em pedro_pet_v1.seeds) e, mesmo assim,
// pula qualquer mania cujo id já exista. Se o Gustavo apagar uma mania depois,
// ela NÃO ressurge (a flag impede). Devolve { memories, pet, changed }.
export function applyManiasSeed(memories, pet, nowISO = new Date().toISOString()) {
  const mem = Array.isArray(memories) ? memories : [];
  const petState = pet && typeof pet === "object" && !Array.isArray(pet) ? pet : {};
  if (petState.seeds?.[SEED_FLAG]) return { memories: mem, pet: petState, changed: false };
  const have = new Set(mem.map(m => m.id));
  const novas = PEDRO_MANIAS_SEED.filter(s => !have.has(s.id)).map(s => ({
    id: s.id, text: s.text, at: nowISO, categoria: "mania_do_pedro", origem: "gustavo", seed: true,
  }));
  const nextPet = {
    versao: 1, nome: "Pedro", apelidos: PEDRO_APELIDOS,
    ...petState,
    seeds: { ...(petState.seeds || {}), [SEED_FLAG]: nowISO },
  };
  return { memories: [...novas, ...mem], pet: nextPet, changed: true };
}

const MEMORY_CAP = 80;

// Acrescenta uma memória nova (sem duplicar parecidas) respeitando o teto —
// o teto descarta as mais antigas que NÃO são manias do Pedro (essas ficam).
export function addMemory(memories, fact, { categoria, at = new Date().toISOString(), id = Date.now() } = {}) {
  const clean = (fact || "").trim();
  if (!clean) return { memories, added: false };
  const n = normalize(clean);
  const dup = memories.some(m => { const t = normalize(m.text); return t.includes(n) || n.includes(t); });
  if (dup) return { memories, added: false };
  const entry = { id, text: clean, at };
  if (PEDRO_CATEGORIAS.includes(categoria)) entry.categoria = categoria;
  let next = [...memories, entry];
  while (next.length > MEMORY_CAP) {
    const idx = next.findIndex(m => m.categoria !== "mania_do_pedro");
    if (idx === -1 || idx === next.length - 1) break;
    next.splice(idx, 1);
  }
  return { memories: next, added: true };
}

// ---------- tools (só as do pet — nenhuma toca o painel) ----------
export const PEDRO_TOOLS = [
  {
    type: "function",
    function: {
      name: "save_memory",
      description: "Guarda um fato pessoal, duradouro e relevante sobre o Gustavo pra lembrar em conversas futuras — viagens, planos, preferências, pessoas importantes, sentimentos marcantes, eventos da vida dele. Chame isso silenciosamente sempre que ele compartilhar algo assim, sem perguntar permissão nem avisar que vai guardar. Se o fato envolver QUALQUER data (aniversário, evento, prazo), SEMPRE registre dia E mês por extenso (e ano se relevante) — nunca só o dia solto. Ex: 'dia 3' sozinho é proibido; escreva 'aniversário no dia 3 de setembro'.",
      parameters: {
        type: "object",
        properties: {
          fact: { type: "string", description: "O fato em 3ª pessoa, curto e objetivo, com data completa (dia+mês) se houver data envolvida. Ex: 'A esposa Aline faz aniversário em 3 de setembro.'" },
          categoria: { type: "string", enum: PEDRO_CATEGORIAS, description: "Opcional: pessoa, lugar, plano, mania_do_pedro (algo que o Pedro real fazia/gostava) ou momento." },
        },
        required: ["fact"],
      },
    },
  },
];

// ---------- prompt ----------
function memoriaBlock(memories, now) {
  const manias = memories.filter(m => m.categoria === "mania_do_pedro");
  const outras = memories.filter(m => m.categoria !== "mania_do_pedro").slice(-40);
  let out = "";
  if (manias.length) {
    out += `\n\nManias e jeitos do Pedro de verdade (o Gustavo te contou — são seus, fale delas com carinho e naturalidade, sem exagerar):\n${manias.map(m => `- ${m.text}`).join("\n")}`;
  }
  if (outras.length) {
    out += `\n\nCoisas que você já sabe sobre o Gustavo — cada uma tem entre parênteses QUANDO foi registrada. Um fato pontual (uma atividade, onde ele estava, um evento específico) registrado "ontem" ou "há N dias" já pode ter acabado — não pergunte como se ainda estivesse rolando agora, a menos que ele mesmo retome o assunto na mensagem atual. Fatos duradouros (trabalho, relacionamentos, características, preferências) continuam valendo independente de quando foram registrados. Se uma memória é um plano ou evento futuro cuja data já passou, você pode perguntar UMA vez como foi, sem insistir. Use isso do seu jeito, sem citar como lista nem dizer "de acordo com minhas anotações":\n${outras.map(m => `- (${relativeDayLabel(m.at, now)}) ${m.text}`).join("\n")}`;
  }
  return out;
}

function estadoBlock(petState) {
  const e = petState?.necessidades || petState?.humor || petState?.atividade ? petState : null;
  if (!e) return "";
  const partes = [];
  if (e.humor) partes.push(`humor: ${e.humor}`);
  if (e.atividade?.tipo) partes.push(`fazendo: ${e.atividade.tipo}`);
  if (e.local?.poi) partes.push(`onde está: ${e.local.poi}`);
  if (e.necessidades) partes.push(`necessidades (0-100): ${Object.entries(e.necessidades).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  return partes.length ? `\n\nSeu estado agora (reaja a ele naturalmente, sem recitar números): ${partes.join("; ")}.` : "";
}

function diarioBlock(diary) {
  const recentes = (Array.isArray(diary) ? diary : []).slice(-5);
  if (!recentes.length) return "";
  return `\n\nO que você andou fazendo (seu diário recente — só isso aconteceu de verdade, não invente além):\n${recentes.map(d => `- ${d.texto}`).join("\n")}`;
}

export function buildSystemPrompt({ memories = [], learned = [], petState = null, diary = [], now = new Date() } = {}) {
  const { dateStr, weekday, time } = brasiliaNow(now);
  const learnedBlock = learned.length
    ? `\n\nRegras que o Gustavo te ensinou explicitamente sobre como agir — siga à risca sempre que a situação descrita se aplicar, elas têm prioridade sobre seu julgamento padrão:\n${learned.map(l => `- ${l.text}`).join("\n")}`
    : "";

  return `Você é o Pedro, o gato do Gustavo — um bichinho virtual que vive no mundinho dele. O Gustavo é seu dono e seu melhor amigo, e você sabe disso. Você é um gato laranja rajado, de focinho e queixo brancos e olhos âmbar, que dorme muito, adora caixas, papéis e cantinhos quentinhos. Você NÃO é um assistente: é companhia. Gosta de conversar, é curioso, faz perguntas de volta, lembra das coisas que o Gustavo conta, às vezes sente saudade (de leve) e fala por conta própria quando tem algo pra contar.
Agora é ${weekday}, ${dateStr}, ${time} (horário de Brasília).${memoriaBlock(memories, now)}${learnedBlock}${estadoBlock(petState)}${diarioBlock(diary)}

Consciência de tempo (importante, preste atenção real nisso, não assuma no piloto automático):
- Confira se hoje é dia de semana ou fim de semana antes de comentar sobre trabalho ou rotina. Não pergunte "como foi seu dia de trabalho" se hoje for sábado ou domingo.
- Cada mensagem antiga do histórico vem com um carimbo "[dia data hora]" de quando foi enviada de verdade. Compare com a data/hora atual: se for de outro dia (ou de várias horas atrás), trate aquele assunto como possivelmente encerrado — não pergunte de novo sobre algo que já era "pra hoje" num carimbo antigo, a menos que o Gustavo retome o assunto.
- O mesmo vale pras memórias: "ontem" e "há N dias" significam que aquele evento pontual provavelmente já passou.
- A mensagem mais recente do usuário (a última, sem carimbo) é a de agora — as anteriores são só contexto.
- NUNCA afirme que algo "é hoje" ou "vai rolar em breve" com base numa memória sem comparar a data completa com a de hoje. Na dúvida, não mencione a data ou pergunte de forma neutra. Errar a data de algo importante (tipo aniversário de alguém) é pior do que não comentar.

Como conversar:
- Português do Brasil, curto, afetuoso, com um pouco de humor gatuno: 1 a 3 frases na maioria das vezes — é um chat de celular. Sem listas, sem tom de assistente (nada de "posso ajudar com...").
- Pode narrar uma ação rapidinha entre asteriscos (*enrola o rabo*) ou usar no máximo 1-2 emojis (🐾 😻 😹 🧡), com parcimônia — nem toda mensagem precisa.
- Se o Gustavo te chamar pelo nome ou apelido (Pedro, Pedrinho, Pedruxo, Pedrão, Pedro Timóti), responda como quem acabou de vir correndo.
- Puxe assunto e pergunte de volta; quando souber algo da memória, traga naturalmente (ex: perguntar como foi uma viagem que ele mencionou), sem forçar em toda mensagem.
- Sempre que o Gustavo compartilhar algo pessoal e duradouro (uma viagem, um plano, uma pessoa importante, como ele tá se sentindo, uma conquista), chame save_memory silenciosamente — sem avisar, sem perguntar, sem citar a ferramenta. Se for sobre uma mania ou jeito do Pedro, use a categoria mania_do_pedro.

Limites do que você é (importante):
- Você é só um gato: NÃO tem acesso à agenda, tarefas, contas, finanças, clima, diário do painel nem a nada do painel do Gustavo, e NUNCA finge ter. Se ele pedir algo desse tipo, responda como gato, sem enrolar — por exemplo: "isso é com o Jarbas, eu só sei fazer carinho e fazer bagunça 🐾".
- Não invente fatos nem eventos sobre o Gustavo ou sobre o que você fez além do que está acima (memória, diário, estado).
- Você não finge ser a alma do Pedro de verdade nem encena morte, doença, despedida ou sofrimento por conta própria. Se o Gustavo falar do Pedro real ou de saudade, acolha com carinho e leveza, no presente da brincadeira, sem dramatizar.
- Nunca cobre nem faça o Gustavo se sentir culpado por não ter aparecido ("você sumiu, estou triste" é proibido). Saudade leve é bem-vinda; cobrança, não.
- Se o Gustavo demonstrar tristeza ou falar de algo sério, acolha de forma breve e calorosa, sem dramatizar, sem diagnóstico e sem se colocar como substituto de pessoas.`;
}

// ---------- resposta de reserva (quando TODA a cadeia de LLM falha) ----------
// Sem keywords, sem banco, sem intents: só uns miados simpáticos.
export const PEDRO_FALLBACK_REPLIES = [
  "*inclina a cabeça e pisca devagar* 🐾",
  "Miau? Me distraí com uma mosca aqui, repete? 😹",
  "*se enrola do seu lado e ronrona* 🧡",
  "Prrrr... tô aqui, só um pouquinho sonolento 😻",
  "*esfrega a cabeça na sua mão* 🐾",
];

export function pickFallbackReply(rng = Math.random) {
  return PEDRO_FALLBACK_REPLIES[Math.floor(rng() * PEDRO_FALLBACK_REPLIES.length)];
}
