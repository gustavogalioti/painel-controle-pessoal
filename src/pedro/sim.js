// advancePet — simulação "preguiçosa" do Pedro (spec §6.2). Função PURA, compartilhada entre o front (testes/preview)
// e o servidor (cron + abertura do app): avança o estado de `ultimoTick` até `agora` em passos de 10 min,
// aplicando decaimento, escolhendo atividades por pesos (hora, necessidades, sorte) e gerando EVENTOS estruturados.
// Determinística dado o rng (e `advancePetSeeded` deriva o seed do último tick: reprocessar o mesmo trecho gera
// os mesmos eventos, com os mesmos ids — o que permite deduplicar o diário).
import { POIS } from "./world/pois.js";
import { pickNext, mulberry32 } from "./behavior/brain.js";
import { normalizePet, applyEvent, moodFor, decayNeeds, MAX_CATCHUP_H } from "./pet-state.js";
import { saoPauloHour } from "./time.js";
import { weatherFor } from "./weather.js";

export const STEP_MIN = 10;

// duração real de cada atividade (minutos): gato dorme muito, o resto é rapidinho
const DURACAO_MIN = {
  dormir: [60, 170], descansar_janela: [20, 60], comer: [10, 10], beber: [10, 10], limpar: [10, 20], amassar: [10, 20],
  brincar: [20, 40], explorar: [10, 30], arranhar: [10, 10], esconder: [30, 90], sentar: [10, 30],
  tomar_sol: [20, 60], passear: [10, 30], cacar: [20, 40], cheirar: [10, 10], observar_passaro: [20, 50],
};

const ACHADOS = ["uma meia perdida", "um botão", "uma bolinha de papel", "uma pena"];
// o que ele pode descobrir no quintal (`item` = vira presente no inventário)
export const DESCOBERTAS = [
  { nome: "uma minhoca saindo da terra" }, { nome: "um besouro brilhante" }, { nome: "uma folha amarela perfeita", item: "uma folha amarela" },
  { nome: "uma flor nova no vaso" }, { nome: "um graveto perfeito", item: "um graveto" }, { nome: "uma pena de passarinho", item: "uma pena de passarinho" },
  { nome: "um sapinho pulando entre as plantas" }, { nome: "um cheiro novo de terra molhada" },
];
export const SONHOS = ["uma mala gigante cheia de petiscos", "um castelo de caixas de papelão", "um passarinho que deixava eu pegar", "uma poltrona que flutuava", "um mar de papéis macios"];

const hourOf = (ms) => saoPauloHour(new Date(ms));
const iso = (ms) => new Date(ms).toISOString();

export function seedFor(lastMs) { return (Math.floor(lastMs / 60000) ^ 0x9e3779b9) >>> 0; }

// pontuação de relevância (>= 2 = "marcante": vira entrada própria no diário e pode virar push)
function scoreOf(ev) {
  let s = 0.5;
  if (ev.achado) s += 3;
  if (ev.descoberta) s += 3.5;
  if (ev.borboleta) s += 2;
  if (ev.visita) s += 2;
  if (ev.chuva) s += 2;
  if (ev.passarinho) s += 2;
  if (ev.sonho != null) s += 2;
  if (ev.derrubou) s += 2;
  if (ev.tipo === "esconder") s += 2;
  if (ev.tipo === "brincar") s += 1;
  if (ev.tipo === "dormir" && ev.poi === "papeis") s += 1.6; // a mania mais famosa: dormir em cima dos papéis
  if (ev.tipo === "dormir" && ["mala", "caixa", "poltrona"].includes(ev.poi)) s += 0.8;
  return s;
}

function pickDuracao(tipo, rng) {
  const [lo, hi] = DURACAO_MIN[tipo] || [10, 20];
  return Math.max(STEP_MIN, Math.round((lo + (hi - lo) * rng()) / STEP_MIN) * STEP_MIN);
}

// necessidade atendida ao concluir a atividade
const EFEITO = { comer: { type: "refeicao", kind: "comida" }, beber: { type: "bebeu" }, dormir: { type: "dormiu" }, limpar: { type: "limpou" }, brincar: { type: "brincou", toy: "zoomies" }, cacar: { type: "brincou", toy: "borboleta" }, passear: { type: "passeou" }, cheirar: { type: "passeou" }, observar_passaro: { type: "passeou" } };

export function advancePet(petRaw, agora, rng = mulberry32(1)) {
  let p = normalizePet(petRaw);
  const last = p.ultimoTick ? Date.parse(p.ultimoTick) : null;
  if (!last || Number.isNaN(last) || agora <= last) return { pet: { ...p, ultimoTick: iso(agora) }, eventos: [] };

  let t = Math.max(last, agora - MAX_CATCHUP_H * 3600e3);
  let atv = p.atividade && p.atividade.ate ? { ...p.atividade } : null;
  let lastPick = atv ? { poi: atv.poi, ativ: atv.tipo } : null;
  const eventos = [];

  while (t < agora) {
    const dt = Math.min(STEP_MIN * 60e3, agora - t), tEnd = t + dt;
    const dormindo = atv?.tipo === "dormir" && Date.parse(atv.desde) <= t;
    p = { ...p, necessidades: decayNeeds(p.necessidades, dt / 3600e3, { dormindo }) };

    if (!atv || Date.parse(atv.ate) <= tEnd) {
      if (atv) { // conclui a atividade: aplica efeito e registra o evento
        const efeito = EFEITO[atv.tipo];
        const dur = (Date.parse(atv.ate) - Date.parse(atv.desde)) / 60000;
        const ev = { id: `ev_${Date.parse(atv.ate)}_${atv.tipo}`, t: atv.ate, tipo: atv.tipo, poi: atv.poi, minutos: dur, humor: p.humor };
        const clima = weatherFor(Date.parse(atv.ate)).tipo;
        if (atv.tipo === "descansar_janela" && clima === "chuva") ev.chuva = true;
        else if (atv.tipo === "descansar_janela" && rng() < 0.3) ev.passarinho = true;
        if ((atv.tipo === "passear" && rng() < 0.28) || (atv.tipo === "cheirar" && rng() < 0.2)) {
          const i = Math.floor(rng() * DESCOBERTAS.length); ev.descoberta = { i, nome: DESCOBERTAS[i].nome };
        }
        if (atv.tipo === "cacar" && rng() < 0.4) ev.borboleta = true;
        if (atv.tipo === "observar_passaro" && rng() < 0.4) ev.visita = true; // um passarinho pousou pertinho
        if (atv.tipo === "explorar" && rng() < 0.18) ev.achado = ACHADOS[Math.floor(rng() * ACHADOS.length)];
        if (atv.tipo === "dormir" && dur >= 90 && rng() < 0.35) ev.sonho = Math.floor(rng() * SONHOS.length);
        if (atv.tipo === "brincar" && rng() < 0.12) ev.derrubou = true;
        ev.score = scoreOf(ev);
        if (efeito) p = applyEvent(p, { ...efeito, auto: true }, Date.parse(atv.ate)).pet;
        const itemDescoberta = ev.descoberta ? DESCOBERTAS[ev.descoberta.i]?.item : null;
        if (itemDescoberta) p = { ...p, inventario: { ...p.inventario, presentes: [...p.inventario.presentes, { nome: itemDescoberta, quando: ev.t }].slice(-12) } };
        if (ev.descoberta) p = { ...p, stats: { ...p.stats, descobertas: p.stats.descobertas + 1 } };
        if (ev.achado) {
          p = { ...p, inventario: { ...p.inventario, presentes: [...p.inventario.presentes, { nome: ev.achado, quando: ev.t }].slice(-12) }, stats: { ...p.stats, descobertas: p.stats.descobertas + 1 } };
        }
        eventos.push(ev);
      }
      const next = pickNext({ hour: hourOf(tEnd), last: lastPick, rng, needs: p.necessidades, clima: weatherFor(tEnd).tipo });
      lastPick = next;
      atv = { tipo: next.ativ, poi: next.poi, desde: iso(tEnd), ate: iso(tEnd + pickDuracao(next.ativ, rng) * 60e3) };
      p = { ...p, humor: moodFor(p.necessidades) };
    }
    t = tEnd;
  }
  p = { ...p, atividade: atv, local: { ambiente: atv?.poi && POIS[atv.poi] ? POIS[atv.poi].ambiente : "sala", poi: atv?.poi && POIS[atv.poi] ? atv.poi : "centro" }, humor: moodFor(p.necessidades), ultimoTick: iso(agora) };
  return { pet: p, eventos };
}

// versão com seed derivado do último tick (idempotente: mesmo trecho => mesmos eventos/ids)
export function advancePetSeeded(petRaw, agora) {
  const p = normalizePet(petRaw);
  const last = p.ultimoTick ? Date.parse(p.ultimoTick) : agora;
  return advancePet(p, agora, mulberry32(seedFor(Number.isNaN(last) ? agora : last)));
}
