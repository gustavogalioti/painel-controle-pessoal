import assert from "node:assert/strict";
import { detectCall, DEFAULT_APELIDOS } from "./pedro/names.js";
import { lightingFor, saoPauloHour } from "./pedro/time.js";
import { pickNext, activityWeights, mulberry32 } from "./pedro/behavior/brain.js";
import { POIS, ROOM, groundHeight, clampToRoom } from "./pedro/world/pois.js";

// ---------- chamar pelo nome ----------
{
  const yes = ["Pedro!", "pedruxo", "vem cá, Pedrão", "Pedrinho vem aqui", "oi pedro, tudo bem?", "PEDRUXOOOO", "cadê você Pedro", "ei Pedro Timóti", "pedro timoti!!", "e aí pedrão", "Pédro", "pedrão?", "vem pedrinhoo"];
  for (const t of yes) assert.equal(detectCall(t).called, true, `deveria chamar: "${t}"`);
  const no = ["o pedro foi ao mercado hoje de manhã cedo", "oi tudo bem", "", "   ", "ontem o pedrão do trabalho me ligou cedo", "petala de rosa"];
  for (const t of no) assert.equal(detectCall(t).called, false, `não deveria chamar: "${t}"`);
  assert.equal(detectCall("vem cá, Pedro Timóti").name, "pedro timoti");
  assert.equal(detectCall("apelido novo: fofão", ["fofão"]).called, true, "apelidos configuráveis");
  assert.deepEqual(DEFAULT_APELIDOS.length, 5);
  console.log("detectCall: OK");
}

// ---------- luz por hora ----------
{
  const noon = lightingFor(13), night = lightingFor(23.5), dawn = lightingFor(6.8), dusk = lightingFor(18.5);
  assert.ok(noon.sunIntensity > night.sunIntensity + 2);
  assert.ok(night.lamp > noon.lamp + 0.9);
  assert.ok(dawn.sunIntensity > 0.5 && dusk.sunIntensity > 0.5, "manhã dourada e tarde alaranjada têm sol");
  assert.equal(lightingFor(25).hour, 1);
  assert.deepEqual(lightingFor(0).sky, lightingFor(24).sky, "continuidade na virada do dia");
  for (let h = 0; h < 24; h += 0.25) { const l = lightingFor(h); assert.ok(Number.isFinite(l.sunIntensity) && l.sky >= 0 && l.sky <= 0xffffff); }
  const h = saoPauloHour(new Date("2026-11-12T15:30:00Z")); // 12:30 em SP (UTC-3)
  assert.ok(Math.abs(h - 12.5) < 0.01, `hora SP: ${h}`);
  console.log("lightingFor / saoPauloHour: OK");
}

// ---------- cérebro: determinismo, pesos por hora, POIs válidos ----------
{
  const a = pickNext({ hour: 14, rng: mulberry32(7) }), b = pickNext({ hour: 14, rng: mulberry32(7) });
  assert.deepEqual(a, b, "determinístico com mesmo seed");
  for (let i = 0; i < 300; i++) {
    const p = pickNext({ hour: (i * 7) % 24, last: i % 3 ? { poi: "caixa", ativ: "dormir" } : null, rng: mulberry32(i) });
    assert.ok(POIS[p.poi], "POI existe");
    assert.ok(POIS[p.poi].ativ.includes(p.ativ), `${p.ativ} é possível em ${p.poi}`);
    assert.ok(p.duracao > 0);
  }
  const count = (hour, ativ) => { let n = 0; const r = mulberry32(99); for (let i = 0; i < 600; i++) if (pickNext({ hour, rng: r }).ativ === ativ) n++; return n; };
  assert.ok(count(3, "dormir") > count(19, "dormir"), "dorme mais de madrugada que ao entardecer");
  assert.ok(count(19, "brincar") > count(14, "brincar"), "brinca mais ao entardecer");
  assert.ok(activityWeights(15).dormir > activityWeights(15).brincar);
  console.log("brain: OK");
}

// ---------- mundo ----------
{
  for (const p of Object.values(POIS)) {
    assert.ok(Math.abs(p.x) < ROOM.w / 2 && Math.abs(p.z) < ROOM.d / 2, `${p.id} dentro da sala`);
    assert.ok(groundHeight(p.x, p.z) < 0.1);
  }
  assert.ok(groundHeight(POIS.caminha.x, POIS.caminha.z) > 0.05, "caminha eleva os pés");
  assert.equal(groundHeight(0, -1.5), 0);
  assert.deepEqual(clampToRoom(10, -10), [ROOM.w / 2 - 0.25, -ROOM.d / 2 + 0.25]);
  console.log("pois/ground: OK");
}
console.log("pedro-pure.test.mjs: todos os testes passaram");
