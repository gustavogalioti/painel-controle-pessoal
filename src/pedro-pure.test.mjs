import assert from "node:assert/strict";
import { detectCall, DEFAULT_APELIDOS } from "./pedro/names.js";
import { lightingFor, saoPauloHour } from "./pedro/time.js";
import { pickNext, activityWeights, mulberry32 } from "./pedro/behavior/brain.js";
import { weatherFor, CLIMAS } from "./pedro/weather.js";
import { POIS, ROOM, YARD, DOOR, groundHeight, clampToRoom, clampToWorld, ambienteDe, routePoints } from "./pedro/world/pois.js";

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

// ---------- mundo: sala + quintal ----------
{
  for (const p of Object.values(POIS)) {
    if (p.ambiente === "sala") assert.ok(Math.abs(p.x) < ROOM.w / 2 && Math.abs(p.z) < ROOM.d / 2, `${p.id} dentro da sala`);
    else assert.ok(p.x > YARD.x0 && p.x < YARD.x1 && p.z > YARD.z0 && p.z < YARD.z1, `${p.id} dentro do quintal`);
    assert.ok(groundHeight(p.x, p.z) < 0.1);
    assert.equal(p.ambiente, ambienteDe(p.x));
    assert.deepEqual(clampToWorld(p.x, p.z, 0.2).map((v) => +v.toFixed(3)), [p.x, p.z].map((v) => +v.toFixed(3)), `${p.id} já é alcançável (dentro dos limites)`);
  }
  assert.ok(Object.values(POIS).some((p) => p.ambiente === "quintal") && Object.values(POIS).some((p) => p.ambiente === "sala"));
  assert.ok(groundHeight(POIS.caminha.x, POIS.caminha.z) > 0.05, "caminha eleva os pés");
  assert.equal(groundHeight(0, -1.5), 0);
  assert.ok(groundHeight(2.7, 1.1) > 0.02, "varanda é um deque");
  assert.deepEqual(clampToRoom(10, -10), [ROOM.w / 2 - 0.25, -ROOM.d / 2 + 0.25]);
  // limites do mundo: no quintal usa os limites do quintal
  const [cx, cz] = clampToWorld(50, -50); assert.ok(cx <= YARD.x1 && cz >= YARD.z0);
  // rota: mesmo ambiente = reta; trocar de ambiente passa pela porta
  assert.deepEqual(routePoints({ x: 0, z: 0 }, { x: 1, z: 1 }), [{ x: 1, z: 1 }]);
  const ida = routePoints({ x: 0, z: 0 }, { x: 4.3, z: 1 });
  assert.equal(ida.length, 3); assert.equal(ida[0].x, DOOR.dentro.x); assert.equal(ida[1].x, DOOR.fora.x); assert.equal(ida[0].z, DOOR.zc); assert.deepEqual(ida[2], { x: 4.3, z: 1 });
  const volta = routePoints({ x: 4.3, z: 1 }, { x: 0, z: 0 });
  assert.equal(volta[0].x, DOOR.fora.x); assert.equal(volta[1].x, DOOR.dentro.x);
  assert.ok(DOOR.z0 < DOOR.zc && DOOR.zc < DOOR.z1 && DOOR.dentro.x < ROOM.w / 2 && DOOR.fora.x > ROOM.w / 2, "porta liga os dois lados");
  console.log("pois/ground/rotas (sala + quintal): OK");
}

// ---------- clima (sem API; determinístico) ----------
{
  const t = Date.parse("2026-11-12T15:00:00Z");
  assert.deepEqual(weatherFor(t), weatherFor(t), "determinístico");
  for (let i = 0; i < 400; i++) { const w = weatherFor(t + i * 5 * 3600e3); assert.ok(CLIMAS.includes(w.tipo)); assert.ok(w.forca >= 0.4 && w.forca <= 1); }
  const cont = {}; for (let i = 0; i < 2000; i++) { const k = weatherFor(t + i * 3 * 3600e3).tipo; cont[k] = (cont[k] || 0) + 1; }
  assert.ok(cont.sol > cont.chuva && cont.sol > cont.nublado, `sol predomina: ${JSON.stringify(cont)}`);
  assert.ok(cont.chuva > 80 && cont.nublado > 80 && cont.vento > 30, "todos os climas aparecem");
  // dias úmidos chovem mais
  let umChuva = 0, umN = 0, secChuva = 0, secN = 0;
  for (let d = 0; d < 400; d++) for (const h of [3, 9, 15, 21]) { const w = weatherFor(t + d * 86400e3 + (h - 12) * 3600e3); if (w.umido) { umN++; if (w.tipo === "chuva") umChuva++; } else { secN++; if (w.tipo === "chuva") secChuva++; } }
  assert.ok(umChuva / umN > 3 * (secChuva / secN), "dia úmido chove bem mais");
  assert.ok(weatherFor(t).bloco === weatherFor(t + 60e3).bloco, "estável dentro do bloco de 3 h");
  console.log("weatherFor: OK");
}

// ---------- cérebro: quintal só de dia, sem chuva ----------
{
  const w = (h, c) => activityWeights(h, c);
  for (const k of ["tomar_sol", "passear", "cacar", "cheirar", "observar_passaro"]) {
    assert.equal(w(22, "sol")[k], 0, `${k} não de noite`); assert.equal(w(3, null)[k], 0);
    assert.equal(w(12, "chuva")[k], 0, `${k} não na chuva`);
    assert.ok(w(12, "sol")[k] > 0, `${k} de dia com sol`);
  }
  assert.ok(w(12, "sol").tomar_sol > w(12, "nublado").tomar_sol * 2, "sol chama mais pro sol");
  assert.ok(w(10, "chuva").descansar_janela > w(10, "sol").descansar_janela, "olha a chuva da janela");
  for (let i = 0; i < 300; i++) { const p = pickNext({ hour: 23, clima: "sol", rng: mulberry32(i) }); assert.equal(POIS[p.poi].ambiente, "sala", "à noite fica em casa"); }
  for (let i = 0; i < 300; i++) { const p = pickNext({ hour: 12, clima: "chuva", rng: mulberry32(i) }); assert.equal(POIS[p.poi].ambiente, "sala", "na chuva fica em casa"); }
  let fora = 0; for (let i = 0; i < 300; i++) if (POIS[pickNext({ hour: 12, clima: "sol", rng: mulberry32(i) }).poi].ambiente === "quintal") fora++;
  assert.ok(fora > 60, `de dia com sol sai bastante: ${fora}`);
  for (let i = 0; i < 300; i++) { const p = pickNext({ hour: 12, clima: "sol", rng: mulberry32(i) }); assert.ok(POIS[p.poi].ativ.includes(p.ativ)); }
  console.log("brain quintal/clima: OK");
}
console.log("pedro-pure.test.mjs: todos os testes passaram");
