import assert from "node:assert/strict";
import { advancePet, advancePetSeeded, STEP_MIN } from "./pedro/sim.js";
import { normalizePet, defaultPet, PISO } from "./pedro/pet-state.js";
import { mulberry32 } from "./pedro/behavior/brain.js";
import { POIS } from "./pedro/world/pois.js";
import { eventoTexto, ehMarcante, turnoDe, buildEntries, mergeEntries, diaryPrompt, sanitizarTextoLlm, resumoTexto } from "./pedro/diary-lib.js";
import { decidePush, registrarPush, emSilencio } from "./pedro/push-policy.js";

const H = 3600e3;
const T0 = Date.parse("2026-11-12T12:00:00Z"); // 09:00 em SP
const petEm = (ms, extra = {}) => normalizePet({ ...extra, ultimoTick: new Date(ms).toISOString() });

// ---------- determinismo ----------
{
  const a = advancePet(petEm(T0), T0 + 12 * H, mulberry32(42)), b = advancePet(petEm(T0), T0 + 12 * H, mulberry32(42));
  assert.deepEqual(a, b, "mesmo seed => mesmo resultado");
  const c = advancePet(petEm(T0), T0 + 12 * H, mulberry32(43));
  assert.notDeepEqual(a.eventos, c.eventos, "seed diferente => outra vida");
  const s1 = advancePetSeeded(petEm(T0), T0 + 5 * H), s2 = advancePetSeeded(petEm(T0), T0 + 5 * H);
  assert.deepEqual(s1, s2);
  console.log("advancePet determinístico: OK");
}

// ---------- 12 h sem abrir: local consistente, necessidades válidas, eventos coerentes ----------
{
  const { pet, eventos } = advancePetSeeded(petEm(T0), T0 + 12 * H);
  assert.ok(POIS[pet.local.poi], "local é um POI real");
  assert.equal(pet.atividade.poi, pet.local.poi, "onde está = onde faz a atividade atual");
  assert.ok(Date.parse(pet.atividade.ate) > T0 + 12 * H - 1, "atividade atual não terminou ainda");
  assert.equal(pet.ultimoTick, new Date(T0 + 12 * H).toISOString());
  for (const v of Object.values(pet.necessidades)) assert.ok(v >= PISO && v <= 100);
  assert.ok(eventos.length >= 8 && eventos.length <= 12 * 6, `quantidade plausível: ${eventos.length}`);
  for (const e of eventos) { assert.ok(POIS[e.poi]); assert.ok(Date.parse(e.t) > T0 && Date.parse(e.t) <= T0 + 12 * H, "evento dentro do intervalo"); assert.match(e.id, /^ev_\d+_\w+$/); }
  const ids = eventos.map((e) => e.id); assert.equal(new Set(ids).size, ids.length, "ids únicos");
  assert.ok(eventos.some((e) => e.tipo === "dormir") && eventos.some((e) => e.tipo === "comer" || e.tipo === "beber"), "rotina de gato: dorme e come");
  console.log("12 h de ausência: OK");
}

// ---------- rotina por hora: dorme mais de madrugada do que ao entardecer; brinca mais ao entardecer ----------
{
  const okNec = { fome: 90, sede: 90, energia: 70, diversao: 70, afeto: 90, higiene: 90 };
  const minutos = (horaSP, tipo) => { // minutos totais na atividade `tipo` em janelas de 4 h começando em horaSP
    let n = 0;
    for (let i = 0; i < 60; i++) {
      const t0 = Date.parse("2026-11-12T00:00:00-03:00") + horaSP * H;
      const { eventos } = advancePet(petEm(t0, { necessidades: okNec }), t0 + 4 * H, mulberry32(i));
      n += eventos.filter((e) => e.tipo === tipo).reduce((s, e) => s + e.minutos, 0);
    }
    return n;
  };
  assert.ok(minutos(0, "dormir") > minutos(17, "dormir"), "dorme mais de madrugada");
  assert.ok(minutos(17, "brincar") > minutos(1, "brincar"), "brinca mais ao entardecer");
  console.log("rotina por hora: OK");
}

// ---------- ausência longa: teto de 48 h, sem explodir, sem game over ----------
{
  const t = Date.now();
  const { pet, eventos } = advancePet(petEm(T0), T0 + 60 * 24 * H, mulberry32(1));
  assert.ok(eventos.length <= 48 * 6, "no máx. 48 h de eventos");
  for (const v of Object.values(pet.necessidades)) assert.ok(v >= PISO);
  assert.ok(Date.now() - t < 500, "rápido");
  console.log("ausência de 60 dias: OK");
}

// ---------- reprocessar o mesmo trecho gera os mesmos ids (dedupe do diário) ----------
{
  const a = advancePetSeeded(petEm(T0), T0 + 6 * H).eventos.map((e) => e.id);
  const b = advancePetSeeded(petEm(T0), T0 + 6 * H).eventos.map((e) => e.id);
  assert.deepEqual(a, b);
  // passos parciais: avançar em duas etapas dá o mesmo que de uma vez só? (não exigido) mas o estado intermediário é coerente
  const meio = advancePetSeeded(petEm(T0), T0 + 3 * H);
  const fim = advancePetSeeded(meio.pet, T0 + 6 * H);
  assert.equal(fim.pet.ultimoTick, new Date(T0 + 6 * H).toISOString());
  assert.ok(POIS[fim.pet.local.poi]);
  console.log("ids estáveis e etapas: OK");
}

// ---------- efeitos: comeu => fome sobe; dormiu => energia sobe; presentes ----------
{
  let fomeSubiu = false, achou = false, energiaSubiu = false;
  for (let i = 0; i < 60; i++) {
    const base = petEm(T0, { necessidades: { fome: 20, sede: 20, energia: 20, diversao: 50, afeto: 50, higiene: 50 } });
    const { pet, eventos } = advancePet(base, T0 + 10 * H, mulberry32(i));
    if (eventos.some((e) => e.tipo === "comer") && pet.necessidades.fome > 40) fomeSubiu = true;
    if (eventos.some((e) => e.tipo === "dormir") && pet.necessidades.energia > 40) energiaSubiu = true;
    if (eventos.some((e) => e.achado)) { achou = true; assert.ok(pet.inventario.presentes.length >= 1); assert.ok(pet.stats.descobertas >= 1); }
  }
  assert.ok(fomeSubiu && energiaSubiu && achou);
  console.log("efeitos dos eventos: OK");
}

// ---------- diário: textos, turnos, resumos, dedupe ----------
{
  assert.match(eventoTexto({ tipo: "explorar", achado: "uma meia perdida", poi: "centro" }), /meia perdida/);
  assert.match(eventoTexto({ tipo: "descansar_janela", passarinho: true, poi: "janela" }), /passarinho/);
  assert.match(eventoTexto({ tipo: "dormir", poi: "papeis" }, () => 0), /papéis/);
  assert.match(eventoTexto({ tipo: "dormir", poi: "mala", sonho: 0 }), /sonhei/);
  for (const tipo of ["dormir", "descansar_janela", "comer", "beber", "limpar", "amassar", "brincar", "explorar", "arranhar", "esconder", "sentar", "xyz"]) {
    const t = eventoTexto({ tipo, poi: "caixa" }, mulberry32(3));
    assert.ok(t.length > 8 && !/agenda|tarefa|painel|saudade|triste|morr|doente/i.test(t), `texto limpo para ${tipo}: ${t}`);
  }
  assert.equal(ehMarcante({ score: 2 }), true); assert.equal(ehMarcante({ score: 1.2 }), false);
  assert.equal(turnoDe(Date.parse("2026-11-12T12:00:00Z")).nome, "manhã"); // 09h SP
  assert.equal(turnoDe(Date.parse("2026-11-12T18:00:00Z")).nome, "tarde"); // 15h SP
  assert.equal(turnoDe(Date.parse("2026-11-13T03:00:00Z")).nome, "noite"); // 00h SP do dia 13
  assert.equal(turnoDe(Date.parse("2026-11-13T03:00:00Z")).chave, "2026-11-12:noite", "madrugada pertence à noite anterior");

  const { eventos } = advancePetSeeded(petEm(T0), T0 + 30 * H);
  const agora = T0 + 30 * H;
  const r = buildEntries({ eventos, agoraMs: agora, rng: mulberry32(9) });
  assert.ok(r.entries.length > 0);
  const marc = r.entries.filter((e) => e.marcante), res = r.entries.filter((e) => e.tipo === "resumo");
  assert.ok(res.length >= 2, "resumos dos turnos já encerrados");
  assert.ok(r.entries.length < eventos.length, "agrupar reduz o spam");
  for (const e of r.entries) { assert.ok(e.id && e.texto && e.quando && e.lido === false); assert.ok(!/undefined|\[object/.test(e.texto)); }
  for (const m of marc) assert.ok(m.score >= 2);
  // pendentes só do turno atual
  for (const p of r.pendentes) assert.equal(turnoDe(Date.parse(p.t)).chave, turnoDe(agora).chave);
  // idempotência: reprocessar não duplica
  const merged = mergeEntries(mergeEntries([], r.entries), buildEntries({ eventos, agoraMs: agora, rng: mulberry32(9) }).entries);
  assert.equal(merged.length, r.entries.length);
  assert.equal(mergeEntries([], Array.from({ length: 400 }, (_, i) => ({ id: `x${i}`, quando: new Date(T0 + i * 1000).toISOString() }))).length, 300, "teto de 300");
  assert.match(resumoTexto([{ tipo: "comer" }, { tipo: "dormir" }, { tipo: "comer" }], "manhã"), /^De manhã eu comi e tirei uma soneca\.$/);
  console.log("diário (textos/turnos/resumos/dedupe): OK");
}

// ---------- LLM do diário: prompt sem alucinação, sanitização ----------
{
  const entry = { evento: "explorar", local: "centro", texto: "Achei uma meia", ev: { achado: "uma meia perdida" } };
  const msgs = diaryPrompt(entry, { hora: "tarde", memorias: ["dorme em cima de papéis"] });
  assert.match(msgs[0].content, /NÃO invente fatos/); assert.match(msgs[0].content, /nunca cobre/);
  assert.match(msgs[1].content, /uma meia perdida/); assert.match(msgs[1].content, /papéis/);
  assert.equal(sanitizarTextoLlm("Achei uma meia! 🧦 Que tesouro."), "Achei uma meia! 🧦 Que tesouro.");
  assert.equal(sanitizarTextoLlm("Vi sua agenda de hoje"), null);
  assert.equal(sanitizarTextoLlm("- um\n- dois\n1. três"), null);
  assert.equal(sanitizarTextoLlm("x".repeat(400)), null);
  assert.equal(sanitizarTextoLlm("“Oi, mundo!”"), "Oi, mundo!");
  console.log("diaryPrompt/sanitizar: OK");
}

// ---------- política de push ----------
{
  const base = (extra = {}) => normalizePet({ ultimoTick: new Date(T0).toISOString(), visto: new Date(T0 - 20 * H).toISOString(), ultimaInteracao: new Date(T0 - 20 * H).toISOString(), ...extra });
  const noite = (hSP) => Date.parse("2026-11-12T00:00:00-03:00") + hSP * H; // hSP em horário de SP
  const marcante = (score = 3, texto = "Achei uma meia! 🎁") => [{ marcante: true, score, texto }];

  assert.equal(emSilencio(23), true); assert.equal(emSilencio(3), true); assert.equal(emSilencio(8), false); assert.equal(emSilencio(21), false); assert.equal(emSilencio(10, 9, 12), true);
  // silêncio 22h–8h
  assert.equal(decidePush({ pet: base(), novasEntradas: marcante(), agoraMs: noite(23) }), null);
  assert.equal(decidePush({ pet: base(), novasEntradas: marcante(), agoraMs: noite(7) }), null);
  // fora do silêncio: descoberta
  let d = decidePush({ pet: base(), novasEntradas: marcante(3), agoraMs: noite(10) });
  assert.equal(d.tipo, "descoberta"); assert.match(d.texto, /meia/); assert.equal(d.tag, "pedro-descoberta");
  assert.equal(decidePush({ pet: base(), novasEntradas: marcante(2), agoraMs: noite(10) }).tipo, "diario");
  // desligado
  assert.equal(decidePush({ pet: base({ config: { push: { ligado: false } } }), novasEntradas: marcante(), agoraMs: noite(10) }), null);
  // app aberto há pouco: cancela
  assert.equal(decidePush({ pet: base({ visto: new Date(noite(10) - 5 * 60e3).toISOString() }), novasEntradas: marcante(), agoraMs: noite(10) }), null);
  assert.equal(decidePush({ pet: base({ ultimaInteracao: new Date(noite(10) - 10 * 60e3).toISOString() }), novasEntradas: marcante(), agoraMs: noite(10) }), null);
  // teto diário (3) e intervalo mínimo (2 h)
  let pet = base(); let t = noite(9); const tipos = [];
  for (let i = 0; i < 8; i++) { const x = decidePush({ pet, novasEntradas: marcante(i % 2 ? 3 : 2), agoraMs: t, rng: () => 0 }); if (x) { tipos.push(x.tipo); pet = { ...pet, push: registrarPush(pet, x.tipo, t) }; } t += 2.5 * H; if (t > noite(21)) break; }
  assert.ok(tipos.length <= 3, `máx 3/dia: ${tipos}`);
  for (let i = 1; i < tipos.length; i++) assert.notEqual(tipos[i], tipos[i - 1], "nunca o mesmo tipo em sequência");
  assert.equal(decidePush({ pet: { ...base(), push: registrarPush(base(), "diario", noite(10)) }, novasEntradas: marcante(3), agoraMs: noite(11) }), null, "menos de 2 h depois do último");
  assert.ok(decidePush({ pet: { ...base(), push: registrarPush(base(), "diario", noite(10)) }, novasEntradas: marcante(3), agoraMs: noite(12.5) }), "depois de 2 h pode");
  // novo dia zera o contador
  const cheio = { ...base(), push: { dia: "2026-11-11", n: 3, ultimo: new Date(noite(20) - 24 * H).toISOString(), ultimoTipo: "diario" } };
  assert.ok(decidePush({ pet: cheio, novasEntradas: marcante(3), agoraMs: noite(10) }));
  // saudade leve após muitas horas, sem culpa; e só uma por dia
  d = decidePush({ pet: base(), novasEntradas: [], agoraMs: noite(10), rng: () => 0 });
  assert.equal(d.tipo, "saudade"); assert.ok(!/sumiu|cadê você|triste|saudade de mais|abandon|esqueceu/i.test(d.texto), d.texto);
  const aposSaudade = { ...base(), push: registrarPush(base(), "saudade", noite(10)) };
  assert.equal(decidePush({ pet: aposSaudade, novasEntradas: [], agoraMs: noite(14) }), null, "saudade não repete no mesmo dia");
  // fome rara
  d = decidePush({ pet: base({ visto: new Date(noite(10) - 3 * H).toISOString(), ultimaInteracao: new Date(noite(10) - 3 * H).toISOString(), necessidades: { fome: 10 } }), novasEntradas: [], agoraMs: noite(10), rng: () => 0 });
  assert.equal(d.tipo, "fome");
  // nada de novo e pouco tempo: nada
  assert.equal(decidePush({ pet: base({ visto: new Date(noite(10) - 3 * H).toISOString(), ultimaInteracao: new Date(noite(10) - 3 * H).toISOString() }), novasEntradas: [], agoraMs: noite(10) }), null);
  // texto cortado
  assert.ok(decidePush({ pet: base(), novasEntradas: marcante(3, "a".repeat(500)), agoraMs: noite(10) }).texto.length <= 150);
  console.log("política de push: OK");
}
console.log("pedro-sim.test.mjs: todos os testes passaram");
