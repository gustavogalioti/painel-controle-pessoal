// Cérebro de comportamento do Pedro na cena (Fase 2): escolhe o próximo "passeio" (POI + atividade)
// por pesos que dependem da hora do dia. Puro e determinístico dado o rng — testável.
// (Na Fase 4 o servidor assume a escolha "de verdade" e o front só mostra o estado.)
import { POIS } from "../world/pois.js";

// O quintal só está aberto de dia (7h–18h30) e sem chuva — de noite/na chuva ele fica em casa (qualquer atividade).
export const foraOk = (hour, clima) => { const h = ((hour % 24) + 24) % 24; return h >= 7 && h < 18.5 && clima !== "chuva"; };

// Pesos de cada atividade por faixa de hora (gato: dorme muito, anda ao entardecer, "enlouquece" à noite).
export function activityWeights(hour, clima = null) {
  const h = ((hour % 24) + 24) % 24;
  const night = h >= 22 || h < 6;
  const morning = h >= 6 && h < 11;
  const afternoon = h >= 11 && h < 17;
  const evening = h >= 17 && h < 22;
  // quintal: só de dia (7h–18h30) e sem chuva; sol = mais animado; nublado/vento = menos
  const fora = foraOk(h, clima) ? (clima === "sol" || !clima ? 1 : 0.7) : 0;
  return {
    tomar_sol: fora * (clima === "sol" || !clima ? 4 : 1.2) * (afternoon ? 1.3 : 1),
    passear: fora * 2.5, cacar: fora * (clima === "sol" || !clima ? 2.5 : 0.9) * (h >= 15 ? 1.4 : 1),
    cheirar: fora * 1.6, observar_passaro: fora * 2.2 * (morning ? 1.5 : 1),
    dormir: night ? 6 : afternoon ? 5 : morning ? 2.5 : 1.5,
    descansar_janela: (morning ? 4 : afternoon ? 2.5 : evening ? 2 : 0.5) * (clima === "chuva" ? 2 : 1), // olhar a chuva da janela
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
  tomar_sol: [20, 45], passear: [10, 18], cacar: [12, 24], cheirar: [6, 12], observar_passaro: [14, 34],
  dormir: [45, 110], descansar_janela: [18, 45], comer: [8, 14], beber: [6, 10], limpar: [8, 16], amassar: [10, 20],
  brincar: [10, 22], explorar: [6, 12], arranhar: [5, 9], esconder: [20, 50], sentar: [8, 18],
};

// As necessidades (0..100, 100 = satisfeito) puxam o comportamento: com fome ele vai comer, cansado dorme,
// entediado brinca, sujo se limpa. Só pesos — o gato continua sendo gato (e nada aqui é "urgente").
export function needsBoost(w, n) {
  if (!n) return w;
  const f = (v, lim, k) => (v < lim ? 1 + ((lim - v) / lim) * k : 1);
  return {
    ...w,
    comer: w.comer * f(n.fome, 55, 5), beber: w.beber * f(n.sede, 55, 5),
    dormir: w.dormir * f(n.energia, 45, 4), brincar: w.brincar * f(n.diversao, 50, 3.5) * (n.energia < 25 ? 0.3 : 1),
    limpar: w.limpar * f(n.higiene, 50, 4), esconder: w.esconder * f(n.energia, 45, 2), cacar: w.cacar * f(n.diversao, 50, 2.5),
  };
}

export function pickNext({ hour, last = null, rng = Math.random, needs = null, clima = null }) {
  const w = needsBoost(activityWeights(hour, clima), needs);
  const options = [];
  const quintalAberto = foraOk(hour, clima);
  for (const poi of Object.values(POIS)) {
    if (poi.ambiente === "quintal" && !quintalAberto) continue;
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
