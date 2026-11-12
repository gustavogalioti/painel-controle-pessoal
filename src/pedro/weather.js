// Clima do MUNDINHO do Pedro — pura ambientação, DETERMINÍSTICA por data/hora de São Paulo.
// NÃO consulta nenhuma API de clima e não tem relação com o tempo real (nunca afirmar que é previsão).
// Mesma função no front (visual), no simulador (ele não passeia na chuva) e no chat (ambientação).
export const CLIMAS = ["sol", "nublado", "chuva", "vento"];
export const CLIMA_EMOJI = { sol: "☀️", nublado: "⛅", chuva: "🌧️", vento: "💨" };
export const CLIMA_NOME = { sol: "ensolarado", nublado: "nublado", chuva: "chuvoso", vento: "ventando" };

function hash(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
const unit = (str) => (hash(str) % 100000) / 100000;

function partsSP(ms) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(new Date(ms));
  const g = (t) => p.find((x) => x.type === t)?.value;
  return { dia: `${g("year")}-${g("month")}-${g("day")}`, hora: parseInt(g("hour"), 10) % 24 };
}

// Cada dia tem uma "personalidade" (seco ou úmido) e cada bloco de 3 h sorteia dentro dela:
// a chuva tende a vir em blocos seguidos nos dias úmidos, como na vida real.
const DIA_SECO = [["sol", 0.68], ["nublado", 0.2], ["vento", 0.1], ["chuva", 0.02]];
const DIA_UMIDO = [["chuva", 0.45], ["nublado", 0.35], ["sol", 0.15], ["vento", 0.05]];

export function weatherFor(ms) {
  const { dia, hora } = partsSP(ms);
  const umido = unit(`dia:${dia}`) < 0.3;
  const bloco = Math.floor(hora / 3);
  let r = unit(`bloco:${dia}:${bloco}`), tipo = "sol";
  for (const [t, w] of umido ? DIA_UMIDO : DIA_SECO) { r -= w; if (r <= 0) { tipo = t; break; } }
  // um pouco de continuidade: se o bloco anterior foi chuva num dia úmido, a chuva "segura" mais um bloco
  if (umido && bloco > 0 && tipo !== "chuva" && unit(`seg:${dia}:${bloco}`) < 0.35) {
    const ant = weatherFor(ms - 3 * 3600e3).tipo; if (ant === "chuva") tipo = "chuva";
  }
  return { tipo, forca: 0.4 + 0.6 * unit(`forca:${dia}:${bloco}`), bloco: `${dia}:${bloco}`, umido };
}
