// Estado do pet (pedro_pet_v1) — lógica PURA da Fase 3: necessidades, humor, eventos de cuidado,
// biscoitos (moedas) e loja. Sem three/React, testável. A Fase 4 (advancePet no servidor) reaproveita isto.
//
// Convenção: necessidades 0..100, onde 100 = SATISFEITO (fome 100 = barriguinha cheia).
// "Cuidado sem culpa": nada nunca passa de PISO (o Pedro fica manhoso/dorminhoco, jamais doente ou em risco).
export const PISO = 8;
export const MAX_CATCHUP_H = 48;

export const NECESSIDADES = ["fome", "sede", "energia", "diversao", "afeto", "higiene"];

// queda por hora acordado
const DECAY_H = { fome: 4, sede: 5, energia: 3, diversao: 4, afeto: 3, higiene: 2 };

export const CATALOGO = {
  roupinha: { id: "roupinha", nome: "Pijama de biscoito de gengibre", preco: 25, tipo: "vestir", emoji: "🧥" },
  petisco:  { id: "petisco",  nome: "Petisco",                          preco: 3,  tipo: "consumivel", emoji: "🍪" },
};

export const BRINQUEDOS = ["bolinha", "ratinho", "pena"];

export function defaultPet() {
  return {
    versao: 1, nome: "Pedro",
    necessidades: { fome: 80, sede: 85, energia: 85, diversao: 70, afeto: 70, higiene: 90 },
    humor: "calmo",
    ultimaInteracao: null, ultimoTick: null,
    inventario: { moedas: 5, itens: [...BRINQUEDOS], petiscos: 0, desbloqueados: [], vestindo: null },
    stats: { carinhos: 0, refeicoes: 0, brincadeiras: 0, descobertas: 0 },
    config: { som: true, vibracao: true },
  };
}

const clamp = (v, lo = PISO, hi = 100) => Math.min(hi, Math.max(lo, v));

// Completa/normaliza qualquer coisa vinda do KV (preserva campos desconhecidos, ex.: seeds, apelidos).
export function normalizePet(raw) {
  const d = defaultPet();
  const p = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const nec = { ...d.necessidades };
  for (const k of NECESSIDADES) if (Number.isFinite(p.necessidades?.[k])) nec[k] = clamp(p.necessidades[k]);
  const inv = { ...d.inventario, ...(p.inventario || {}) };
  inv.moedas = Math.max(0, Math.floor(Number(inv.moedas) || 0));
  inv.petiscos = Math.max(0, Math.floor(Number(inv.petiscos) || 0));
  inv.itens = Array.isArray(inv.itens) && inv.itens.length ? inv.itens : [...BRINQUEDOS];
  inv.desbloqueados = Array.isArray(inv.desbloqueados) ? inv.desbloqueados : [];
  const out = { ...d, ...p, necessidades: nec, inventario: inv, stats: { ...d.stats, ...(p.stats || {}) }, config: { ...d.config, ...(p.config || {}) } };
  out.humor = moodFor(out.necessidades);
  return out;
}

export function moodFor(n) {
  const menor = NECESSIDADES.reduce((a, k) => (n[k] < n[a] ? k : a), "fome");
  if (n[menor] < 30) {
    if (menor === "energia") return "sonolento";
    if (menor === "diversao") return "brincalhao";
    if (menor === "higiene") return "calmo";
    return "manhoso"; // fome, sede, afeto baixos: pede atenção, nada além disso
  }
  const media = NECESSIDADES.reduce((s, k) => s + n[k], 0) / NECESSIDADES.length;
  if (media >= 72) return "feliz";
  if (n.diversao < 45 && n.energia > 55) return "curioso";
  return "calmo";
}

// Passagem do tempo (catch-up ao abrir / a cada minuto). `agora` em ms.
export function applyDecay(pet, agora = Date.now()) {
  const p = normalizePet(pet);
  const last = p.ultimoTick ? Date.parse(p.ultimoTick) : null;
  if (!last || Number.isNaN(last) || agora <= last) return { ...p, ultimoTick: new Date(agora).toISOString() };
  const horas = Math.min(MAX_CATCHUP_H, (agora - last) / 3600000);
  const nec = { ...p.necessidades };
  for (const k of NECESSIDADES) nec[k] = clamp(nec[k] - DECAY_H[k] * horas);
  return { ...p, necessidades: nec, humor: moodFor(nec), ultimoTick: new Date(agora).toISOString() };
}

// O Pedro aceita a ação agora? (gato é gato: sem fome, recusa comida; muito cansado, recusa brincar)
export function reaction(pet, acao) {
  const n = normalizePet(pet).necessidades;
  if (acao === "comida") return n.fome > 92 ? "recusa" : "aceita";
  if (acao === "petisco") return n.fome > 97 ? "recusa" : "aceita";
  if (acao === "agua") return n.sede > 92 ? "recusa" : "aceita";
  if (acao === "brincar") return n.energia < 15 ? "recusa" : "aceita";
  return "aceita";
}

const ganha = (inv, n) => ({ ...inv, moedas: inv.moedas + n });
const TETO_MOEDAS = 9999;

// Aplica um evento de cuidado. Devolve { pet, moedas (ganhas agora), msg? }.
// Recompensa só quando a necessidade estava < 85 (evita "farmar" biscoito sem necessidade).
export function applyEvent(pet, ev, agora = Date.now()) {
  const p = normalizePet(pet);
  const nec = { ...p.necessidades }, stats = { ...p.stats };
  let inv = { ...p.inventario }, ganhos = 0;
  const up = (k, v) => { nec[k] = clamp(nec[k] + v, PISO, 100); };
  const premia = (cond, n) => { if (cond) { ganhos += n; } };
  switch (ev.type) {
    case "carinho": { // ev.secs = tempo acariciando
      const antes = nec.afeto;
      up("afeto", Math.min(30, ev.secs * 4)); up("diversao", Math.min(6, ev.secs));
      stats.carinhos += 1;
      premia(antes < 85 && ev.secs >= 3, 1);
      break;
    }
    case "colo": up("afeto", 8); up("energia", 2); break;
    case "refeicao": {
      const antes = nec.fome;
      if (ev.kind === "petisco") { up("fome", 22); up("afeto", 6); } else up("fome", 55);
      if (!ev.auto) { stats.refeicoes += 1; premia(antes < 85 && ev.kind !== "petisco", 2); }
      else stats.refeicoes += 1;
      break;
    }
    case "bebeu": { const antes = nec.sede; up("sede", 55); premia(!ev.auto && antes < 85, 1); break; }
    case "brincou": {
      const antes = nec.diversao;
      up("diversao", 28); up("energia", -10); up("afeto", 3); up("fome", -3);
      stats.brincadeiras += 1; premia(antes < 85 && !ev.auto, 2);
      break;
    }
    case "dormiu": up("energia", ev.auto === false ? 15 : 28); break;
    case "limpou": up("higiene", 22); break;
    case "incomodo": break; // só reage; nunca pune
    default: return { pet: p, moedas: 0 };
  }
  inv = ganha(inv, ganhos); inv.moedas = Math.min(TETO_MOEDAS, inv.moedas);
  const out = { ...p, necessidades: nec, stats, inventario: inv, humor: moodFor(nec), ultimaInteracao: ev.auto ? p.ultimaInteracao : new Date(agora).toISOString() };
  return { pet: out, moedas: ganhos };
}

// Compra na loja. Devolve { pet, ok, motivo? }.
export function comprar(pet, itemId) {
  const p = normalizePet(pet);
  const item = CATALOGO[itemId];
  if (!item) return { pet: p, ok: false, motivo: "item_invalido" };
  if (item.tipo === "vestir" && p.inventario.desbloqueados.includes(itemId)) return { pet: p, ok: false, motivo: "ja_tem" };
  if (p.inventario.moedas < item.preco) return { pet: p, ok: false, motivo: "sem_biscoitos" };
  const inv = { ...p.inventario, moedas: p.inventario.moedas - item.preco };
  if (item.tipo === "vestir") inv.desbloqueados = [...inv.desbloqueados, itemId];
  else inv.petiscos = inv.petiscos + 1;
  return { pet: { ...p, inventario: inv }, ok: true };
}

export function gastarPetisco(pet) {
  const p = normalizePet(pet);
  if (p.inventario.petiscos < 1) return { pet: p, ok: false };
  return { pet: { ...p, inventario: { ...p.inventario, petiscos: p.inventario.petiscos - 1 } }, ok: true };
}

export function vestir(pet, itemId) { // itemId null = tirar
  const p = normalizePet(pet);
  if (itemId && !p.inventario.desbloqueados.includes(itemId)) return p;
  return { ...p, inventario: { ...p.inventario, vestindo: itemId || null } };
}
