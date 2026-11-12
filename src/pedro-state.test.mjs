import assert from "node:assert/strict";
import { defaultPet, normalizePet, moodFor, applyDecay, applyEvent, reaction, comprar, gastarPetisco, vestir, PISO, CATALOGO } from "./pedro/pet-state.js";
import { pickNext, needsBoost, activityWeights, mulberry32 } from "./pedro/behavior/brain.js";

const T0 = Date.parse("2026-11-12T12:00:00Z");

// ---------- normalização: preserva campos desconhecidos (seeds do servidor) e clampa ----------
{
  const p = normalizePet({ seeds: { manias_v1: "x" }, apelidos: ["pedro"], necessidades: { fome: 500, sede: -5 }, inventario: { moedas: "7.9" } });
  assert.deepEqual(p.seeds, { manias_v1: "x" });
  assert.deepEqual(p.apelidos, ["pedro"]);
  assert.equal(p.necessidades.fome, 100); assert.equal(p.necessidades.sede, PISO);
  assert.equal(p.inventario.moedas, 7);
  assert.ok(p.inventario.itens.includes("bolinha"));
  assert.equal(normalizePet(null).versao, 1);
  console.log("normalizePet: OK");
}

// ---------- decaimento: sem game over, teto de 48 h ----------
{
  const p = applyDecay(defaultPet(), T0); // 1º tick só marca o relógio
  assert.equal(p.ultimoTick, new Date(T0).toISOString());
  assert.equal(p.necessidades.fome, 80);
  const dez = applyDecay(p, T0 + 10 * 3600e3);
  assert.equal(dez.necessidades.fome, 40); assert.equal(dez.necessidades.sede, 35);
  const mes = applyDecay(p, T0 + 30 * 24 * 3600e3);
  for (const v of Object.values(mes.necessidades)) assert.ok(v >= PISO, "nunca abaixo do piso (sem game over)");
  assert.deepEqual(applyDecay(p, T0 + 48 * 3600e3).necessidades, mes.necessidades, "catch-up limitado a 48 h");
  assert.deepEqual(applyDecay(p, T0 - 5000).necessidades, p.necessidades, "relógio voltando não quebra");
  console.log("applyDecay: OK");
}

// ---------- humor: manhoso/dorminhoco, nunca doente ----------
{
  const base = { fome: 80, sede: 80, energia: 80, diversao: 80, afeto: 80, higiene: 80 };
  assert.equal(moodFor(base), "feliz");
  assert.equal(moodFor({ ...base, fome: 10 }), "manhoso");
  assert.equal(moodFor({ ...base, energia: 10 }), "sonolento");
  assert.equal(moodFor({ ...base, diversao: 10 }), "brincalhao");
  assert.equal(moodFor({ ...base, afeto: 10 }), "manhoso");
  const todos = new Set(); for (let v = 8; v <= 100; v += 7) for (const k of Object.keys(base)) todos.add(moodFor({ ...base, [k]: v }));
  for (const m of todos) assert.ok(["feliz", "calmo", "brincalhao", "sonolento", "manhoso", "curioso"].includes(m), `humor ${m} não permitido`);
  console.log("moodFor: OK");
}

// ---------- eventos e biscoitos ----------
{
  const p = normalizePet({ necessidades: { fome: 30, sede: 30, energia: 80, diversao: 30, afeto: 30, higiene: 80 } });
  let r = applyEvent(p, { type: "carinho", secs: 5 }, T0);
  assert.equal(r.pet.necessidades.afeto, 50); assert.equal(r.moedas, 1); assert.equal(r.pet.stats.carinhos, 1);
  assert.equal(applyEvent(r.pet, { type: "carinho", secs: 1 }, T0).moedas, 0, "carinho curto não rende biscoito");
  r = applyEvent(p, { type: "refeicao", kind: "comida" }, T0);
  assert.equal(r.pet.necessidades.fome, 85); assert.equal(r.moedas, 2); assert.equal(r.pet.stats.refeicoes, 1);
  assert.equal(applyEvent(r.pet, { type: "refeicao", kind: "comida", auto: true }, T0).moedas, 0, "comer sozinho não rende");
  assert.equal(applyEvent(normalizePet({ necessidades: { fome: 95 } }), { type: "refeicao", kind: "comida" }, T0).moedas, 0, "sem necessidade, sem biscoito (anti-farm)");
  r = applyEvent(p, { type: "brincou", toy: "bolinha" }, T0);
  assert.equal(r.pet.necessidades.diversao, 58); assert.ok(r.pet.necessidades.energia < 80); assert.equal(r.moedas, 2);
  r = applyEvent(p, { type: "bebeu" }, T0); assert.equal(r.pet.necessidades.sede, 85); assert.equal(r.moedas, 1);
  assert.equal(applyEvent(p, { type: "dormiu" }, T0).pet.necessidades.energia, 100);
  assert.equal(applyEvent(p, { type: "incomodo" }, T0).moedas, 0);
  assert.equal(applyEvent(p, { type: "xyz" }, T0).moedas, 0);
  assert.equal(applyEvent(p, { type: "carinho", secs: 5, auto: true }, T0).pet.ultimaInteracao, p.ultimaInteracao);
  console.log("applyEvent: OK");
}

// ---------- gato é gato: recusa quando não precisa ----------
{
  assert.equal(reaction({ necessidades: { fome: 99 } }, "comida"), "recusa");
  assert.equal(reaction({ necessidades: { fome: 40 } }, "comida"), "aceita");
  assert.equal(reaction({ necessidades: { energia: 10 } }, "brincar"), "recusa");
  assert.equal(reaction({ necessidades: { sede: 95 } }, "agua"), "recusa");
  console.log("reaction: OK");
}

// ---------- loja ----------
{
  const p = normalizePet({ inventario: { moedas: 30 } });
  let r = comprar(p, "roupinha"); assert.equal(r.ok, true); assert.equal(r.pet.inventario.moedas, 5); assert.deepEqual(r.pet.inventario.desbloqueados, ["roupinha"]);
  assert.equal(comprar(r.pet, "roupinha").motivo, "ja_tem");
  assert.equal(comprar(normalizePet({ inventario: { moedas: 2 } }), "petisco").motivo, "sem_biscoitos");
  assert.equal(comprar(p, "nao_existe").motivo, "item_invalido");
  r = comprar(p, "petisco"); assert.equal(r.pet.inventario.petiscos, 1); assert.equal(r.pet.inventario.moedas, 30 - CATALOGO.petisco.preco);
  const g = gastarPetisco(r.pet); assert.equal(g.ok, true); assert.equal(g.pet.inventario.petiscos, 0); assert.equal(gastarPetisco(g.pet).ok, false);
  assert.equal(vestir(p, "roupinha").inventario.vestindo, null, "não veste o que não tem");
  const comRoupa = vestir(comprar(p, "roupinha").pet, "roupinha"); assert.equal(comRoupa.inventario.vestindo, "roupinha");
  assert.equal(vestir(comRoupa, null).inventario.vestindo, null);
  console.log("loja: OK");
}

// ---------- necessidades puxam o comportamento ----------
{
  const count = (needs, ativ, hour = 14) => { let n = 0; const r = mulberry32(5); for (let i = 0; i < 800; i++) if (pickNext({ hour, rng: r, needs }).ativ === ativ) n++; return n; };
  const ok = { fome: 90, sede: 90, energia: 90, diversao: 90, afeto: 90, higiene: 90 };
  assert.ok(count({ ...ok, fome: 15 }, "comer") > 2 * count(ok, "comer"), "com fome, come mais");
  assert.ok(count({ ...ok, sede: 15 }, "beber") > 2 * count(ok, "beber"));
  assert.ok(count({ ...ok, energia: 10 }, "dormir") > count(ok, "dormir"));
  assert.ok(count({ ...ok, diversao: 10 }, "brincar", 19) > count(ok, "brincar", 19));
  assert.deepEqual(needsBoost(activityWeights(10), null), activityWeights(10));
  const a = pickNext({ hour: 9, rng: mulberry32(3), needs: ok }), b = pickNext({ hour: 9, rng: mulberry32(3), needs: ok });
  assert.deepEqual(a, b);
  console.log("brain com necessidades: OK");
}
console.log("pedro-state.test.mjs: todos os testes passaram");
