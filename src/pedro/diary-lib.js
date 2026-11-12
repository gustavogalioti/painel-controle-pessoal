// Diário do Pedro — lógica PURA: textos (templates na voz do Pedro), agrupamento por turno do dia e prompt de LLM.
// Anti-alucinação: o texto só descreve EVENTOS que o simulador realmente gerou (sonho é fantasia declarada).
// Nada de culpa/cobrança e nada sobre morte, doença ou despedida.
import { SONHOS } from "./sim.js";

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length) % arr.length];

const ONDE = {
  caminha: "na minha caminha", caixa: "dentro da caixa de papelão", mala: "na mala aberta", poltrona: "na poltrona preta",
  papeis: "em cima dos papéis", sol: "no solzinho do chão", tapete: "no tapete", janela: "perto da janela", centro: "no meio da sala",
  comida: "na minha tigela", agua: "na tigela de água", arranhador: "no arranhador",
  varanda: "na varanda", gramado: "na grama do quintal", vaso: "perto dos vasos de flores", arvore: "na sombra da árvore", comedouro: "perto do comedouro de passarinhos", pedra: "em cima da pedra do quintal", cerca: "perto da cerca",
};
export const onde = (poi) => ONDE[poi] || "pela sala";

const T = {
  dormir: [(e) => `Tirei uma soneca ${onde(e.poi)}.`, (e) => `Dormi ${onde(e.poi)}, esticadão. Que delícia.`],
  descansar_janela: [() => "Fiquei olhando pela janela, só observando o mundo.", () => "Passei um tempão na janela. Tem sempre alguma coisa pra olhar."],
  comer: [() => "Comi minha ração. Estava ótima!", () => "Dei uma beliscada na tigela. Barriguinha feliz."],
  beber: [() => "Bebi uma aguinha fresca.", () => "Fui matar a sede na tigela de água."],
  limpar: [() => "Fiz minha toalete completa: patinha, orelha, rabo.", () => "Me lambi todo. Tem que estar apresentável."],
  amassar: [() => "Amassei pãozinho até cansar.", () => "Fiz massagem no tapete com as patinhas."],
  brincar: [() => "Deu um surto de energia e eu corri a sala inteira!", () => "Dei uns pulos e ataquei o ar. Ninguém viu, mas foi épico."],
  explorar: [() => "Dei uma volta de inspeção pela sala.", () => "Fui cheirar uns cantinhos que eu ainda não tinha cheirado."],
  arranhar: [() => "Afiei as unhas no arranhador. Prontinhas!", () => "Arranhei o arranhador com vontade."],
  esconder: [(e) => `Me escondi ${onde(e.poi)}. Ninguém me achou!`, (e) => `Fiquei quietinho ${onde(e.poi)}, como se fosse invisível.`],
  sentar: [() => "Fiquei sentadinho, pensando na vida.", () => "Sentei e fiquei curtindo o momento."],
  tomar_sol: [(e) => `Tomei sol ${onde(e.poi)}. Quentinho demais, quase derreti.`, (e) => `Me estiquei ${onde(e.poi)} e deixei o sol cuidar de mim. ☀️`],
  passear: [() => "Dei um passeio pelo quintal, farejando tudo.", () => "Passeei pela grama de ponta a ponta. Cada cantinho tem um cheiro!"],
  cacar: [() => "Caí na caça às borboletas no quintal. Pulei, pulei, e nenhuma se deixou pegar. 🦋", () => "Fiquei de tocaia na grama, de olho nas borboletas."],
  cheirar: [(e) => `Fui cheirar as flores ${onde(e.poi)}. Cheiro bom demais. 🌸`, () => "Fiquei um tempão cheirando as plantinhas."],
  observar_passaro: [(e) => `Fiquei de vigia ${onde(e.poi)}, de olho nos passarinhos.`, () => "Observei os passarinhos do quintal. Eu só olho, juro. 🐦"],
};

// texto de UM evento (marcantes usam os extras; os outros, o template padrão)
export function eventoTexto(ev, rng = Math.random) {
  if (ev.descoberta) return `Descobri ${ev.descoberta.nome} no quintal! Quero te contar. 🔍`;
  if (ev.chuva) return "Choveu e eu fiquei olhando da janela, todo curioso. As gotinhas descem correndo! 🌧️";
  if (ev.borboleta) return "Persegui uma borboleta pelo quintal inteiro. Quase peguei! 🦋";
  if (ev.visita) return "Um passarinho pousou pertinho de mim, no quintal. Fiquei imóvel feito estátua. 🐦";
  if (ev.achado) return `Achei ${ev.achado} escondida pela sala! Vou guardar como presente pra você. 🎁`;
  if (ev.passarinho) return "Apareceu um passarinho na janela! Fiquei com o rabo tremendo e os olhos arregalados. 🐦";
  if (ev.derrubou) return "Derrubei uma coisinha da mesa de propósito. A gravidade funciona, confirmei. 😹";
  if (ev.sonho != null) return `Tirei uma soneca ${onde(ev.poi)} e sonhei com ${SONHOS[ev.sonho % SONHOS.length]}. 💭`;
  const arr = T[ev.tipo] || T.sentar;
  return pick(arr, rng)(ev);
}

export const ehMarcante = (ev) => (ev.score ?? 0) >= 2;

// ---- turnos do dia (manhã 6–12, tarde 12–18, noite 18–6), em America/Sao_Paulo
function partsSP(ms) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(new Date(ms));
  const g = (t) => p.find((x) => x.type === t)?.value;
  return { dia: `${g("year")}-${g("month")}-${g("day")}`, hora: parseInt(g("hour"), 10) % 24 };
}
export function turnoDe(ms) {
  const { dia, hora } = partsSP(ms);
  if (hora >= 6 && hora < 12) return { chave: `${dia}:manha`, nome: "manhã" };
  if (hora >= 12 && hora < 18) return { chave: `${dia}:tarde`, nome: "tarde" };
  const base = hora < 6 ? partsSP(ms - 6 * 3600e3).dia : dia; // madrugada pertence à noite anterior
  return { chave: `${base}:noite`, nome: "noite" };
}

const RESUMO = { dormir: "tirei uma soneca", descansar_janela: "fiquei olhando a janela", comer: "comi", beber: "bebi água", limpar: "me limpei todo", amassar: "amassei pãozinho", brincar: "brinquei um pouco", explorar: "dei uma volta de inspeção", arranhar: "afiei as unhas", esconder: "me escondi", sentar: "fiquei sentadinho", tomar_sol: "tomei sol", passear: "passeei no quintal", cacar: "caçei borboletas", cheirar: "cheirei as flores", observar_passaro: "vigiei os passarinhos" };

export function resumoTexto(evs, turnoNome) {
  const nomes = [...new Set(evs.map((e) => RESUMO[e.tipo]).filter(Boolean))].slice(0, 4);
  if (!nomes.length) return `Na ${turnoNome} foi tudo tranquilo por aqui.`;
  const lista = nomes.length > 1 ? `${nomes.slice(0, -1).join(", ")} e ${nomes.at(-1)}` : nomes[0];
  const prefixo = turnoNome === "manhã" ? "De manhã" : turnoNome === "tarde" ? "De tarde" : "À noite";
  return `${prefixo} eu ${lista}.`;
}

const POUCOS = (ev) => ({ id: ev.id, t: ev.t, tipo: ev.tipo, poi: ev.poi });

// Transforma os eventos novos em entradas do diário: marcantes viram entrada própria; os triviais ficam em `pendentes`
// e viram UM resumo por turno quando o turno termina (ou quando acumulam demais).
export function buildEntries({ eventos, pendentes = [], agoraMs, humor = null, rng = Math.random }) {
  const entries = [];
  let pend = [...pendentes];
  for (const ev of eventos) {
    if (ehMarcante(ev)) {
      entries.push({ id: `d_${ev.id}`, quando: ev.t, tipo: "evento", evento: ev.tipo, texto: eventoTexto(ev, rng), humor: ev.humor || humor, local: ev.poi, marcante: true, score: ev.score, ev, fonte: "template", lido: false, reacao: false });
    } else pend.push(POUCOS(ev));
  }
  const atual = turnoDe(agoraMs).chave;
  const porTurno = new Map();
  for (const e of pend) { const k = turnoDe(Date.parse(e.t)).chave; if (!porTurno.has(k)) porTurno.set(k, []); porTurno.get(k).push(e); }
  const resto = [];
  for (const [chave, evs] of porTurno) {
    if (chave !== atual || evs.length > 10) {
      const nome = turnoDe(Date.parse(evs[0].t)).nome;
      const ultimo = evs.at(-1);
      entries.push({ id: `r_${chave}`, quando: ultimo.t, tipo: "resumo", texto: resumoTexto(evs, nome), humor, local: ultimo.poi, marcante: false, fonte: "template", lido: false, reacao: false });
    } else resto.push(...evs);
  }
  entries.sort((a, b) => a.quando.localeCompare(b.quando));
  return { entries, pendentes: resto.slice(-40) };
}

// junta entradas sem duplicar (por id) e mantém as últimas 300
export function mergeEntries(existentes, novas) {
  const byId = new Map((existentes || []).map((e) => [e.id, e]));
  for (const n of novas) if (!byId.has(n.id)) byId.set(n.id, n);
  return [...byId.values()].sort((a, b) => a.quando.localeCompare(b.quando)).slice(-300);
}

// ---- LLM (só pra marcantes, com orçamento diário): reescreve na voz do Pedro SEM inventar fatos
export function diaryPrompt(entry, { hora, memorias = [] } = {}) {
  const fatos = JSON.stringify({ o_que_aconteceu: entry.evento, onde: onde(entry.local), achado: entry.ev?.achado, descoberta_no_quintal: entry.ev?.descoberta?.nome, choveu: !!entry.ev?.chuva, borboleta: !!entry.ev?.borboleta, passarinho_pousou_perto: !!entry.ev?.visita, passarinho: !!entry.ev?.passarinho, derrubou_algo: !!entry.ev?.derrubou, sonho: entry.ev?.sonho != null ? SONHOS[entry.ev.sonho % SONHOS.length] : undefined });
  const mem = memorias.length ? `\nManias suas que podem colorir o tom (não obrigatório): ${memorias.join(" | ")}` : "";
  return [
    { role: "system", content: `Você é o Pedro, um gato laranja rajado, escrevendo uma entrada CURTA do seu diário, em primeira pessoa, em português do Brasil, tom fofo e com humor gatuno.
Regras: 1 a 2 frases; no máximo 1 emoji; descreva SOMENTE os fatos fornecidos (se houver "sonho", pode contar como sonho/fantasia); NÃO invente fatos, pessoas, lugares ou acontecimentos; não fale do Gustavo nem de agenda/tarefas/contas; nunca cobre nem reclame de ausência; sem tristeza, doença ou despedida. Responda só com o texto da entrada.` },
    { role: "user", content: `Hora do dia: ${hora}. Fatos: ${fatos}.${mem}\nRascunho de referência (reescreva com suas palavras): ${entry.texto}` },
  ];
}

// aceita a resposta do LLM só se for razoável (curta, sem lista, sem coisa de assistente)
export function sanitizarTextoLlm(txt) {
  const t = String(txt || "").trim().replace(/^["“”']+|["“”']+$/g, "");
  if (!t || t.length > 260 || /\n\s*[-*\d]+[.)]?\s/.test(t) || /agenda|tarefa|conta[s]? a pagar|clima|painel/i.test(t)) return null;
  return t;
}
