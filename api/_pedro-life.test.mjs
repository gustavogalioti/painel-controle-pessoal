import assert from "node:assert/strict";
import { tickPedro, applyUpdate, listDiary, markDiaryRead, reactDiary, runCronTick, loadPet, MAX_LLM_DIARIO_DIA } from "./_pedro-life.js";
import { handleChat } from "./pedro.js";
import { PEDRO_KEYS } from "./_pedro-pet-lib.js";
import { normalizePet } from "../src/pedro/pet-state.js";

const H = 3600e3;
const T0 = Date.parse("2026-11-12T15:00:00Z"); // 12:00 em SP

function fakeSql(initial = {}) {
  const store = Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
  const touched = new Set();
  const sql = async (strings, ...values) => {
    const q = strings.join("?");
    if (/SELECT value FROM sync_kv/.test(q)) { touched.add(values[0]); return store[values[0]] !== undefined ? [{ value: store[values[0]] }] : []; }
    if (/INSERT INTO sync_kv/.test(q)) { touched.add(values[0]); store[values[0]] = values[1]; return []; }
    throw new Error(`SQL inesperado: ${q}`);
  };
  sql.read = (k) => (store[k] === undefined ? undefined : JSON.parse(store[k]));
  sql.touched = touched;
  return sql;
}
const comBase = (extra = {}) => ({ [PEDRO_KEYS.pet]: normalizePet({ ultimoTick: new Date(T0).toISOString(), visto: new Date(T0 - 30 * H).toISOString(), ultimaInteracao: new Date(T0 - 30 * H).toISOString(), ...extra }) });

// ---------- 12 h sem abrir: diário coerente, local consistente, só chaves pedro_* ----------
{
  const sql = fakeSql(comBase());
  const r = await tickPedro(sql, T0 + 12 * H);
  assert.ok(r.eventos.length >= 8);
  const pet = sql.read(PEDRO_KEYS.pet), diario = sql.read(PEDRO_KEYS.diary);
  assert.ok(diario.length > 0 && diario.length < r.eventos.length, "diário agrupado, não um item por evento");
  assert.equal(pet.ultimoTick, new Date(T0 + 12 * H).toISOString());
  assert.equal(pet.local.poi, pet.atividade.poi, "local consistente com a atividade");
  for (const e of diario) { assert.ok(Date.parse(e.quando) > T0 && Date.parse(e.quando) <= T0 + 12 * H, "só descreve o que aconteceu no intervalo"); assert.equal(e.fonte, "template"); }
  assert.ok([...sql.touched].every((k) => k.startsWith("pedro_")), `só pedro_*: ${[...sql.touched]}`);
  // reprocessar o mesmo instante não duplica; avançar um pouco mais só acrescenta
  await tickPedro(sql, T0 + 12 * H);
  assert.equal(sql.read(PEDRO_KEYS.diary).length, diario.length);
  // se o estado "voltar no tempo" (escrita concorrente antiga), os ids estáveis impedem duplicatas no diário
  sql.read; const sql2 = fakeSql({ ...comBase(), [PEDRO_KEYS.diary]: diario });
  await tickPedro(sql2, T0 + 12 * H);
  assert.equal(sql2.read(PEDRO_KEYS.diary).length, diario.length, "dedupe por id");
  console.log("tickPedro 12 h: OK");
}

// ---------- LLM do diário: só marcantes, orçamento, falha não quebra ----------
{
  let chamadas = 0;
  const llmOk = async (msgs, tools) => { chamadas++; assert.equal(tools, undefined, "sem tools"); assert.match(msgs[0].content, /NÃO invente fatos/); return { choices: [{ message: { content: "Escrevi isso com o LLM! 🐾" } }] }; };
  // procura uma janela que gere vários marcantes
  let sql, r;
  for (let d = 0; d < 20; d++) {
    sql = fakeSql(comBase({ ultimoTick: new Date(T0 + d * 7777777).toISOString() }));
    chamadas = 0;
    r = await tickPedro(sql, T0 + d * 7777777 + 40 * H, { callLlm: llmOk });
    if (r.novas.filter((e) => e.marcante).length >= 1) break;
  }
  const marcantes = r.novas.filter((e) => e.marcante);
  assert.ok(marcantes.length >= 1, "achou janela com marcantes");
  assert.equal(chamadas, Math.min(marcantes.length, MAX_LLM_DIARIO_DIA), "LLM só nos marcantes e dentro do orçamento");
  assert.ok(marcantes.filter((e) => e.fonte === "llm").length === chamadas);
  assert.ok(r.novas.filter((e) => !e.marcante).every((e) => e.fonte === "template"), "triviais nunca usam LLM");
  assert.ok(sql.read(PEDRO_KEYS.pet).diario.llm.n <= MAX_LLM_DIARIO_DIA);

  // LLM falhando: mantém o texto-modelo, não derruba o tick
  const sql3 = fakeSql(comBase());
  let falhas = 0; const logs = console.error; console.error = () => {};
  const r3 = await tickPedro(sql3, T0 + 40 * H, { callLlm: async () => { falhas++; throw new Error("429"); } });
  console.error = logs;
  assert.ok(r3.novas.length > 0 && r3.novas.every((e) => e.fonte === "template"));
  assert.ok(falhas <= 1, "para na primeira falha (protege a cota compartilhada)");
  // resposta imprópria do LLM é descartada
  const sql4 = fakeSql(comBase());
  const r4 = await tickPedro(sql4, T0 + 40 * H, { callLlm: async () => ({ choices: [{ message: { content: "Vi sua agenda e suas tarefas de hoje." } }] }) });
  assert.ok(r4.novas.every((e) => e.fonte === "template"));
  console.log("diário por LLM (orçamento/falha/sanitização): OK");
}

// ---------- atualizações do app ----------
{
  const sql = fakeSql(comBase({ necessidades: { fome: 20, sede: 80, energia: 80, diversao: 80, afeto: 80, higiene: 80 }, inventario: { moedas: 30 } }));
  let r = await applyUpdate(sql, T0 + 60e3, { ev: { type: "refeicao", kind: "comida" } });
  assert.equal(r.ok, true); assert.ok(r.moedas >= 0); assert.ok(r.pet.necessidades.fome > 60);
  assert.equal(r.pet.visto, new Date(T0 + 60e3).toISOString(), "marca que o app está aberto");
  assert.equal((await applyUpdate(sql, T0 + 61e3, { ev: { type: "hack", secs: 9999 } })).motivo, "evento_invalido");
  assert.equal((await applyUpdate(sql, T0 + 61e3, { op: "x" })).motivo, "operacao_invalida");
  r = await applyUpdate(sql, T0 + 62e3, { op: "comprar", item: "roupinha" }); assert.equal(r.ok, true); assert.deepEqual(r.pet.inventario.desbloqueados, ["roupinha"]);
  assert.equal((await applyUpdate(sql, T0 + 62e3, { op: "comprar", item: "roupinha" })).motivo, "ja_tem");
  r = await applyUpdate(sql, T0 + 63e3, { op: "vestir", item: "roupinha" }); assert.equal(r.pet.inventario.vestindo, "roupinha");
  r = await applyUpdate(sql, T0 + 64e3, { op: "config", config: { som: false, push: { ligado: false, max: 99, silencioDe: 99, silencioAte: -3 } } });
  assert.equal(r.pet.config.som, false); assert.equal(r.pet.config.push.ligado, false); assert.equal(r.pet.config.push.max, 6); assert.equal(r.pet.config.push.silencioDe, 23); assert.equal(r.pet.config.push.silencioAte, 0);
  const carinho = await applyUpdate(sql, T0 + 65e3, { ev: { type: "carinho", secs: 99999 } });
  assert.ok(carinho.pet.necessidades.afeto <= 100);
  console.log("applyUpdate: OK");
}

// ---------- diário: ler, marcar lido, 💛 vira afeto + memória (uma vez) ----------
{
  const sql = fakeSql(comBase({ necessidades: { fome: 80, sede: 80, energia: 80, diversao: 80, afeto: 40, higiene: 80 } }));
  await tickPedro(sql, T0 + 30 * H);
  let d = await listDiary(sql, { limit: 5 });
  assert.ok(d.nao_lidos > 0 && d.entradas.length <= 5);
  assert.ok(d.entradas[0].quando >= d.entradas.at(-1).quando, "mais recentes primeiro");
  const id = d.entradas[0].id;
  await markDiaryRead(sql, [id]);
  assert.equal(sql.read(PEDRO_KEYS.diary).find((e) => e.id === id).lido, true);
  const afetoAntes = sql.read(PEDRO_KEYS.pet).necessidades.afeto;
  assert.deepEqual(await reactDiary(sql, id, T0 + 31 * H), { ok: true });
  assert.ok(sql.read(PEDRO_KEYS.pet).necessidades.afeto > afetoAntes);
  const mem = sql.read(PEDRO_KEYS.memory);
  assert.ok(mem.some((m) => /💛/.test(m.text) && m.categoria === "momento"));
  assert.equal((await reactDiary(sql, id, T0 + 32 * H)).ja, true, "segunda reação não soma de novo");
  assert.equal((await reactDiary(sql, "nao_existe", T0)).ok, false);
  await markDiaryRead(sql, "todos");
  assert.equal((await listDiary(sql)).nao_lidos, 0);
  console.log("diário (ler/lido/💛): OK");
}

// ---------- cron: push com orçamento, silêncio, sem repetição, registra no chat ----------
{
  const enviados = [];
  const sendPush = async (subs, payload) => { enviados.push(payload); return subs.length; };
  const subs = [{ endpoint: "https://push/1" }];
  const base = (extra = {}) => ({ ...comBase(extra), [PEDRO_KEYS.pushSubs]: subs });

  // silêncio (03h SP): nenhum push, mas o Pedro vive e o diário é escrito
  const noite = Date.parse("2026-11-13T06:00:00Z");
  let sql = fakeSql(base({ ultimoTick: new Date(noite - 30 * H).toISOString() }));
  let r = await runCronTick(sql, noite, { sendPush, vapidOk: true });
  assert.equal(r.push, null); assert.equal(enviados.length, 0); assert.ok(r.entradas > 0, "diário continua no silêncio");

  // dia: com novidade marcante e Gustavo ausente há muito => 1 push; o orçamento e o intervalo valem
  let achou = false;
  for (let d = 0; d < 30 && !achou; d++) {
    const inicio = Date.parse("2026-11-12T13:00:00Z") + d * 3333333;
    sql = fakeSql(base({ ultimoTick: new Date(inicio).toISOString(), visto: new Date(inicio - 40 * H).toISOString(), ultimaInteracao: new Date(inicio - 40 * H).toISOString() }));
    enviados.length = 0;
    r = await runCronTick(sql, inicio + 3 * H, { sendPush, vapidOk: true });
    if (r.push) achou = true;
  }
  assert.ok(achou && enviados.length === 1 && r.sent === 1);
  assert.equal(enviados[0].title, "Pedro 🐾"); assert.equal(enviados[0].data.pedro, true); assert.ok(enviados[0].body.length > 5 && enviados[0].body.length <= 150);
  const pet = sql.read(PEDRO_KEYS.pet); assert.equal(pet.push.n, 1); assert.equal(pet.push.ultimoTipo, r.push);
  const chat = sql.read(PEDRO_KEYS.chat); assert.equal(chat.at(-1).from, "pedro"); assert.equal(chat.at(-1).espontanea, true);
  // logo depois (30 min): bloqueado pelo intervalo mínimo de 2 h
  const antes = enviados.length;
  r = await runCronTick(sql, Date.parse(pet.ultimoTick) + 30 * 60e3, { sendPush, vapidOk: true });
  assert.equal(enviados.length, antes); assert.equal(r.push, null);

  // app aberto há pouco: cancela
  const aberto = fakeSql(base({ ultimoTick: new Date(T0).toISOString(), visto: new Date(T0 + 11 * H).toISOString() }));
  enviados.length = 0;
  assert.equal((await runCronTick(aberto, T0 + 12 * H, { sendPush, vapidOk: true })).push, null);

  // sem VAPID / sem inscrições: não quebra e não conta no orçamento
  const semVapid = fakeSql(base({ ultimoTick: new Date(T0).toISOString(), visto: new Date(T0 - 40 * H).toISOString(), ultimaInteracao: new Date(T0 - 40 * H).toISOString() }));
  const rv = await runCronTick(semVapid, T0 + 4 * H, { sendPush, vapidOk: false });
  assert.ok([null, "sem_vapid"].includes(rv.push)); assert.equal(semVapid.read(PEDRO_KEYS.pet).push.n, 0);
  console.log("cron (push/orçamento/silêncio/chat): OK");
}

// ---------- chat conhece o estado e o diário (e continua só em pedro_*) ----------
{
  const ORIGINAL_FETCH = globalThis.fetch;
  process.env.GROQ_API_KEY = "g"; delete process.env.OPENAI_API_KEY;
  let sistema = "";
  globalThis.fetch = async (url, init) => { const b = JSON.parse(init.body); sistema = b.messages[0].content; return { ok: true, json: async () => ({ choices: [{ message: { role: "assistant", content: "Miau 🐾" } }] }) }; };
  const sql = fakeSql(comBase({ necessidades: { fome: 12, sede: 80, energia: 80, diversao: 80, afeto: 80, higiene: 80 } }));
  await tickPedro(sql, T0 + 30 * H);
  const r = await handleChat(sql, { message: "oi pedrinho", history: [] });
  assert.equal(r.status, 200);
  assert.match(sistema, /Seu estado agora/); assert.match(sistema, /fome \d+/); assert.match(sistema, /100 = satisfeito/);
  assert.match(sistema, /seu diário recente/);
  assert.ok(sql.read(PEDRO_KEYS.pet).ultimaInteracao, "chat conta como interação (adia push)");
  assert.ok([...sql.touched].every((k) => k.startsWith("pedro_")));
  globalThis.fetch = ORIGINAL_FETCH; delete process.env.GROQ_API_KEY;
  console.log("chat com estado e diário: OK");
}

console.log("_pedro-life.test.mjs: todos os testes passaram");
