// Política de push do Pedro (spec §8) — PURA e testável. Decide SE e O QUE mandar, nunca como (o envio é do cron).
// Etiqueta: no máx. N/dia (padrão 3), silêncio 22h–8h, no mín. 2 h entre pushes, nunca o mesmo tipo em sequência,
// cancela se o Gustavo está com o app aberto/usou há pouco, e NUNCA cobra ou faz culpa (saudade é leve).
import { normalizePet } from "./pet-state.js";
import { saoPauloHour } from "./time.js";

export const MIN_ENTRE_PUSH_MS = 2 * 3600e3;
export const APP_RECENTE_MS = 30 * 60e3;
export const SAUDADE_APOS_MS = 10 * 3600e3;
export const REPETE_TIPO_MS = 24 * 3600e3;

const SAUDADES = [
  "Lembrei de você agora. Tô por aqui, quando quiser 🐾",
  "Passei pela janela e pensei em você. O solzinho tá bom hoje ☀️",
  "Dei uma esticada e lembrei de você. Sem pressa, tô na caminha 🧡",
];
const FOMES = ["Passei pela tigela e deu um vazio na barriga... quando puder, dá uma olhadinha? 😸", "Miau! Acho que a hora do lanchinho chegou 🍗"];

const diaSP = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));

export function emSilencio(hora, de = 22, ate = 8) { return de > ate ? hora >= de || hora < ate : hora >= de && hora < ate; }

const corta = (t, n = 150) => (t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t);

// -> { tipo, texto, tag } | null
export function decidePush({ pet: petRaw, novasEntradas = [], agoraMs, rng = Math.random }) {
  const pet = normalizePet(petRaw);
  const cfg = pet.config.push;
  if (!cfg.ligado) return null;
  if (emSilencio(saoPauloHour(new Date(agoraMs)), cfg.silencioDe, cfg.silencioAte)) return null;
  const hoje = diaSP(agoraMs);
  const n = pet.push.dia === hoje ? pet.push.n : 0;
  if (n >= (cfg.max ?? 3)) return null;
  if (pet.push.ultimo && agoraMs - Date.parse(pet.push.ultimo) < MIN_ENTRE_PUSH_MS) return null;
  const visto = Math.max(Date.parse(pet.visto || 0) || 0, Date.parse(pet.ultimaInteracao || 0) || 0);
  if (visto && agoraMs - visto < APP_RECENTE_MS) return null; // o Gustavo abriu o app há pouco

  const cands = [];
  const marc = [...novasEntradas].filter((e) => e.marcante).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  if (marc[0]) cands.push({ tipo: (marc[0].score ?? 0) >= 3 ? "descoberta" : "diario", texto: corta(marc[0].texto) });
  if (visto && agoraMs - visto > SAUDADE_APOS_MS && (!pet.push.saudadeEm || agoraMs - Date.parse(pet.push.saudadeEm) > REPETE_TIPO_MS)) {
    cands.push({ tipo: "saudade", texto: SAUDADES[Math.floor(rng() * SAUDADES.length)] });
  }
  if (pet.necessidades.fome < 25 && (!pet.push.fomeEm || agoraMs - Date.parse(pet.push.fomeEm) > REPETE_TIPO_MS)) {
    cands.push({ tipo: "fome", texto: FOMES[Math.floor(rng() * FOMES.length)] });
  }
  const c = cands.find((x) => x.tipo !== pet.push.ultimoTipo); // sem repetir o mesmo tipo em sequência
  return c ? { ...c, tag: `pedro-${c.tipo}` } : null;
}

// novo estado de `pet.push` depois de enviar
export function registrarPush(pet, tipo, agoraMs) {
  const p = normalizePet(pet), hoje = diaSP(agoraMs);
  return {
    ...p.push, dia: hoje, n: (p.push.dia === hoje ? p.push.n : 0) + 1, ultimo: new Date(agoraMs).toISOString(), ultimoTipo: tipo,
    ...(tipo === "saudade" ? { saudadeEm: new Date(agoraMs).toISOString() } : {}), ...(tipo === "fome" ? { fomeEm: new Date(agoraMs).toISOString() } : {}),
  };
}
