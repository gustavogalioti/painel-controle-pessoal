// ─────────────────────────────────────────────────────────────────────────
// Vida do Pedro no SERVIDOR (Fase 4): o estado do pet (pedro_pet_v1) e o Diário (pedro_diary_v1) têm dono único aqui.
// `tickPedro` = catch-up preguiçoso (advancePet) + entradas do diário (templates, e LLM só nos marcantes dentro de um
// orçamento diário) — chamado pelo cron (a cada 5–15 min) e na abertura do app / no chat.
// Só toca chaves pedro_* do sync_kv (o teste de isolamento garante). Sem leitura de nada do painel.
// ─────────────────────────────────────────────────────────────────────────
import { PEDRO_KEYS, addMemory } from "./_pedro-pet-lib.js";
import { normalizePet, applyEvent, comprar, gastarPetisco, vestir } from "../src/pedro/pet-state.js";
import { advancePetSeeded, seedFor } from "../src/pedro/sim.js";
import { buildEntries, mergeEntries, diaryPrompt, sanitizarTextoLlm, turnoDe } from "../src/pedro/diary-lib.js";
import { mulberry32 } from "../src/pedro/behavior/brain.js";
import { decidePush, registrarPush } from "../src/pedro/push-policy.js";

export const MAX_LLM_DIARIO_DIA = 4;

// ---------- sync_kv (só pedro_*) ----------
export async function getKvList(sql, key) {
  const rows = await sql`SELECT value FROM sync_kv WHERE key=${key}`;
  if (!rows[0]) return [];
  try { const v = JSON.parse(rows[0].value); return Array.isArray(v) ? v : []; } catch { return []; }
}
export async function getKvObject(sql, key) {
  const rows = await sql`SELECT value FROM sync_kv WHERE key=${key}`;
  if (!rows[0]) return null;
  try { const v = JSON.parse(rows[0].value); return v && typeof v === "object" && !Array.isArray(v) ? v : null; } catch { return null; }
}
export async function setKv(sql, key, value) {
  const json = JSON.stringify(value);
  const ts = new Date().toISOString();
  await sql`INSERT INTO sync_kv (key, value, updated_at) VALUES (${key}, ${json}, ${ts})
            ON CONFLICT (key) DO UPDATE SET value=${json}, updated_at=${ts}`;
}

const diaSP = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
const iso = (ms) => new Date(ms).toISOString();

export async function loadPet(sql) { return normalizePet(await getKvObject(sql, PEDRO_KEYS.pet)); }
export const savePet = (sql, pet) => setKv(sql, PEDRO_KEYS.pet, pet);

// ---------- diário: reescreve marcantes com o LLM (orçamento diário), sem nunca bloquear o resto ----------
async function melhorarComLlm(novas, pet, agoraMs, callLlm, memoriasManias = []) {
  let p = pet;
  const hoje = diaSP(agoraMs);
  let usados = p.diario.llm.dia === hoje ? p.diario.llm.n : 0;
  const hora = turnoDe(agoraMs).nome;
  const ordem = novas.filter((e) => e.marcante).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  for (const e of ordem) {
    if (usados >= MAX_LLM_DIARIO_DIA) break;
    usados++; // conta a tentativa (falha também gasta orçamento: protege a cota compartilhada com o Jarbas)
    try {
      const data = await callLlm(diaryPrompt(e, { hora, memorias: memoriasManias }), undefined);
      const txt = sanitizarTextoLlm(data?.choices?.[0]?.message?.content);
      if (txt) { e.texto = txt; e.fonte = "llm"; }
    } catch (err) { console.error("diário do Pedro: LLM falhou, mantendo o texto-modelo:", err?.message || err); break; }
  }
  p = { ...p, diario: { ...p.diario, llm: { dia: hoje, n: usados } } };
  return p;
}

// Avança a vida do Pedro até `agoraMs`, grava estado + diário e devolve { pet, novas, eventos }.
export async function tickPedro(sql, agoraMs, { callLlm = null, visto = false, interacao = false } = {}) {
  const pet0 = await loadPet(sql);
  const { pet: adv, eventos } = advancePetSeeded(pet0, agoraMs);
  const rng = mulberry32(seedFor(Date.parse(pet0.ultimoTick || 0) || agoraMs));
  const { entries, pendentes } = buildEntries({ eventos, pendentes: adv.pendentes, agoraMs, humor: adv.humor, rng });
  const diary0 = await getKvList(sql, PEDRO_KEYS.diary);
  const ja = new Set(diary0.map((d) => d.id));
  const novas = entries.filter((e) => !ja.has(e.id));
  let pet = { ...adv, pendentes };
  if (novas.length && callLlm) {
    const manias = (await getKvList(sql, PEDRO_KEYS.memory)).filter((m) => m.categoria === "mania_do_pedro").slice(0, 3).map((m) => m.text);
    pet = await melhorarComLlm(novas, pet, agoraMs, callLlm, manias);
  }
  if (visto) pet = { ...pet, visto: iso(agoraMs) };
  if (interacao) pet = { ...pet, ultimaInteracao: iso(agoraMs), visto: iso(agoraMs) };
  await savePet(sql, pet);
  if (novas.length) await setKv(sql, PEDRO_KEYS.diary, mergeEntries(diary0, novas));
  return { pet, novas, eventos };
}

// ---------- atualizações vindas do app (cuidados, loja, config) ----------
const EV_OK = new Set(["carinho", "colo", "refeicao", "bebeu", "brincou", "dormiu", "limpou", "incomodo"]);
function evSeguro(ev) {
  if (!ev || !EV_OK.has(ev.type)) return null;
  return { type: ev.type, secs: Math.min(60, Math.max(0, Number(ev.secs) || 0)), kind: ev.kind === "petisco" ? "petisco" : "comida", toy: typeof ev.toy === "string" ? ev.toy.slice(0, 20) : undefined, auto: !!ev.auto };
}
const hh = (v, d) => (Number.isFinite(Number(v)) ? Math.min(23, Math.max(0, Math.floor(Number(v)))) : d);

export async function applyUpdate(sql, agoraMs, body = {}) {
  const { pet: base } = await tickPedro(sql, agoraMs, { visto: true });
  let pet = base, moedas = 0, ok = true, motivo;
  if (body.ev) {
    const ev = evSeguro(body.ev);
    if (!ev) return { ok: false, motivo: "evento_invalido", pet };
    const r = applyEvent(pet, ev, agoraMs); pet = r.pet; moedas = r.moedas;
  } else if (body.op === "comprar") { const r = comprar(pet, String(body.item)); pet = r.pet; ok = r.ok; motivo = r.motivo; }
  else if (body.op === "gastar_petisco") { const r = gastarPetisco(pet); pet = r.pet; ok = r.ok; }
  else if (body.op === "devolver_petisco") pet = { ...pet, inventario: { ...pet.inventario, petiscos: pet.inventario.petiscos + 1 } };
  else if (body.op === "vestir") pet = vestir(pet, body.item || null);
  else if (body.op === "config") {
    const c = body.config || {}, push = c.push || {};
    pet = { ...pet, config: { ...pet.config,
      ...(typeof c.som === "boolean" ? { som: c.som } : {}), ...(typeof c.vibracao === "boolean" ? { vibracao: c.vibracao } : {}),
      push: { ...pet.config.push, ...(typeof push.ligado === "boolean" ? { ligado: push.ligado } : {}), ...(push.max != null ? { max: Math.min(6, Math.max(0, Math.floor(Number(push.max) || 0))) } : {}),
        ...(push.silencioDe != null ? { silencioDe: hh(push.silencioDe, 22) } : {}), ...(push.silencioAte != null ? { silencioAte: hh(push.silencioAte, 8) } : {}) } } };
  } else return { ok: false, motivo: "operacao_invalida", pet };
  await savePet(sql, pet);
  return { ok, motivo, moedas, pet };
}

// ---------- diário: leitura, "lido", reação 💛 ----------
export async function listDiary(sql, { limit = 40 } = {}) {
  const all = await getKvList(sql, PEDRO_KEYS.diary);
  const nao_lidos = all.filter((e) => !e.lido).length;
  return { nao_lidos, entradas: all.slice(-Math.min(200, Math.max(1, limit))).reverse() };
}
export async function markDiaryRead(sql, ids) {
  const all = await getKvList(sql, PEDRO_KEYS.diary);
  const set = ids === "todos" ? null : new Set(Array.isArray(ids) ? ids : []);
  await setKv(sql, PEDRO_KEYS.diary, all.map((e) => (!set || set.has(e.id) ? { ...e, lido: true } : e)));
  return { ok: true };
}
// 💛 numa entrada: vira afeto (+6, uma vez por entrada) e memória ("momento")
export async function reactDiary(sql, id, agoraMs) {
  const all = await getKvList(sql, PEDRO_KEYS.diary);
  const e = all.find((x) => x.id === id);
  if (!e) return { ok: false, motivo: "nao_encontrada" };
  if (e.reacao) return { ok: true, ja: true };
  await setKv(sql, PEDRO_KEYS.diary, all.map((x) => (x.id === id ? { ...x, reacao: true, lido: true } : x)));
  const pet = await loadPet(sql);
  const r = applyEvent(pet, { type: "carinho", secs: 1.5 }, agoraMs); // +afeto (sem biscoito: secs < 3)
  await savePet(sql, { ...r.pet, necessidades: { ...r.pet.necessidades, afeto: Math.min(100, pet.necessidades.afeto + 6) } });
  const mem = addMemory(await getKvList(sql, PEDRO_KEYS.memory), `O Gustavo reagiu com 💛 a uma entrada do diário do Pedro: "${String(e.texto).slice(0, 120)}"`, { categoria: "momento", at: iso(agoraMs), id: agoraMs });
  if (mem.added) await setKv(sql, PEDRO_KEYS.memory, mem.memories);
  return { ok: true };
}

// ---------- núcleo do cron (injetável: testável sem rede) ----------
// sendPush(subs, payload) -> nº de envios bem-sucedidos (o cron real usa web-push). vapidOk: chaves configuradas.
export async function runCronTick(sql, agoraMs, { callLlm = null, sendPush = null, vapidOk = false } = {}) {
  const { pet, novas, eventos } = await tickPedro(sql, agoraMs, { callLlm });
  const result = { ok: true, eventos: eventos.length, entradas: novas.length, push: null, sent: 0 };
  const decisao = decidePush({ pet, novasEntradas: novas, agoraMs });
  if (!decisao) return result;
  const subs = await getKvList(sql, PEDRO_KEYS.pushSubs);
  if (!vapidOk || !sendPush) return { ...result, push: "sem_vapid" };
  if (!subs.length) return { ...result, push: "sem_inscricoes" };
  const sent = await sendPush(subs, { title: "Pedro 🐾", body: decisao.texto, tag: decisao.tag, data: { pedro: true, texto: decisao.texto } });
  if (sent > 0) {
    // conta no orçamento e registra a fala no chat (aparece na conversa ao abrir o app)
    await savePet(sql, { ...pet, push: registrarPush(pet, decisao.tipo, agoraMs) });
    const chat = await getKvList(sql, PEDRO_KEYS.chat);
    await setKv(sql, PEDRO_KEYS.chat, [...chat, { from: "pedro", text: decisao.texto, at: agoraMs, espontanea: true }].slice(-60));
  }
  return { ...result, push: decisao.tipo, sent };
}
