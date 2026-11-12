// Cérebro de comportamento do Pedro na cena (Fase 2): escolhe o próximo "passeio" (POI + atividade)
// por pesos que dependem da hora do dia. Puro e determinístico dado o rng — testável.
// (Na Fase 4 o servidor assume a escolha "de verdade" e o front só mostra o estado.)
import { POIS } from "../world/pois.js";

// Pesos de cada atividade por faixa de hora (gato: dorme muito, anda ao entardecer, "enlouquece" à noite).
export function activityWeights(hour) {
  const h = ((hour % 24) + 24) % 24;
  const night = h >= 22 || h < 6;
  const morning = h >= 6 && h < 11;
  const afternoon = h >= 11 && h < 17;
  const evening = h >= 17 && h < 22;
  return {
    dormir: night ? 6 : afternoon ? 5 : morning ? 2.5 : 1.5,
    descansar_janela: morning ? 4 : afternoon ? 2.5 : evening ? 2 : 0.5,
    comer: morning ? 2.5 : evening ? 2.5 : 0.8,
    beber: 1,
    limpar: 2,
    amassar: evening ? 2 : 1,
    brincar: evening ? 4 : night ? 1.2 : 0.8,
    explorar: evening ? 2.5 : 1.5,
    arranhar: 1,
    esconder: afternoon ? 1.2 : 0.8,
    sentar: 1,
  };
}

// Duração (s) de cada atividade em tempo de cena.
const DURACAO = {
  dormir: [45, 110], descansar_janela: [18, 45], comer: [8, 14], beber: [6, 10], limpar: [8, 16], amassar: [10, 20],
  brincar: [10, 22], explorar: [6, 12], arranhar: [5, 9], esconder: [20, 50], sentar: [8, 18],
};

export function pickNext({ hour, last = null, rng = Math.random }) {
  const w = activityWeights(hour);
  const options = [];
  for (const poi of Object.values(POIS)) {
    for (const ativ of poi.ativ) {
      let weight = w[ativ] ?? 0;
      if (last && last.poi === poi.id) weight *= 0.15; // não repete o mesmo lugar em seguida
      if (last && last.ativ === ativ) weight *= 0.5;
      if (weight > 0) options.push({ poi: poi.id, ativ, weight });
    }
  }
  const total = options.reduce((s, o) => s + o.weight, 0);
  let r = rng() * total;
  let pick = options[options.length - 1];
  for (const o of options) { r -= o.weight; if (r <= 0) { pick = o; break; } }
  const [lo, hi] = DURACAO[pick.ativ] || [8, 16];
  return { poi: pick.poi, ativ: pick.ativ, duracao: lo + (hi - lo) * rng() };
}

// PRNG determinístico (mulberry32) — para testes e, na Fase 4, seed por dia.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
