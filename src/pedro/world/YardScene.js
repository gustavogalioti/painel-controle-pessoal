// Quintal/varanda do Pedro — primitivas do three + texturas procedurais (nada de assets de terceiros).
// Liga-se à sala pela PORTA da parede direita (ver RoomScene). Tem varanda (deque), gramado, cerca, árvore com sombra,
// vasos de flores, comedouro de passarinhos, pedra, borboletas e passarinhos animados, nuvens, chuva e vento.
import * as THREE from "three";
import { ROOM, YARD, POIS } from "./pois.js";

const rnd = (seed) => { let a = seed; return () => (a = (a * 16807) % 2147483647) / 2147483647; };
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.anisotropy = 4; return t;
}
const grassTexture = () => canvasTex(256, 256, (g, w, h) => {
  const r = rnd(21); g.fillStyle = "#6fae52"; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 5000; i++) { const t = r(); g.fillStyle = t > 0.6 ? `rgba(120,190,80,${0.25 + r() * 0.3})` : `rgba(50,110,40,${0.2 + r() * 0.3})`; g.fillRect(r() * w, r() * h, 1.5, 3 + r() * 5); }
}, [3, 3]);
const deckTexture = () => canvasTex(256, 256, (g, w, h) => {
  const r = rnd(8); const n = 6, ph = h / n;
  for (let i = 0; i < n; i++) { const t = 150 + r() * 30; g.fillStyle = `rgb(${t},${t - 40},${t - 80})`; g.fillRect(0, i * ph, w, ph); g.fillStyle = "rgba(60,38,20,0.55)"; g.fillRect(0, i * ph, w, 2); for (let k = 0; k < 20; k++) { g.strokeStyle = `rgba(80,50,25,${0.05 + r() * 0.1})`; g.beginPath(); const y = i * ph + r() * ph; g.moveTo(0, y); g.lineTo(w, y + r() * 3 - 1.5); g.stroke(); } }
}, [1, 1.2]);
const std = (color, rough = 0.9, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, ...extra });

export function buildYard() {
  const root = new THREE.Group(); root.name = "yard";
  const sway = []; // { obj, base, amp, ph } balançam com o vento
  const add = (mesh, { x = 0, y = 0, z = 0, ry = 0, cast = true, receive = true, parent = root } = {}) => { mesh.position.set(x, y, z); mesh.rotation.y = ry; mesh.castShadow = cast; mesh.receiveShadow = receive; parent.add(mesh); return mesh; };
  const box = (w, h, d, mat, o) => add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat), { ...o, y: (o?.y ?? 0) + h / 2 });
  const cyl = (rt, rb, h, mat, o, seg = 16) => add(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat), { ...o, y: (o?.y ?? 0) + h / 2 });
  const W = YARD.x1 - YARD.x0, D = YARD.z1 - YARD.z0, cx = (YARD.x0 + YARD.x1) / 2;

  // ---- gramado
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(W + 2.6, D + 2.2), std(0xffffff, 1, { map: grassTexture() }));
  grass.rotation.x = -Math.PI / 2; grass.position.set(cx + 0.6, -0.002, 0); grass.receiveShadow = true; root.add(grass);
  // tufos de grama (instanciados)
  { const geo = new THREE.ConeGeometry(0.014, 0.075, 4); geo.translate(0, 0.037, 0);
    const im = new THREE.InstancedMesh(geo, std(0x4f9a3f, 1), 520); const m = new THREE.Matrix4(), r = rnd(5), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let i = 0; i < 520; i++) { e.set((r() - 0.5) * 0.4, r() * 6, (r() - 0.5) * 0.4); q.setFromEuler(e); m.compose(new THREE.Vector3(YARD.x0 + 1.9 + r() * (W - 2.2), 0, YARD.z0 + 0.2 + r() * (D - 0.4)), q, new THREE.Vector3(1, 0.7 + r() * 0.9, 1)); im.setMatrixAt(i, m); }
    im.receiveShadow = true; root.add(im); }
  // caminho de pedras da porta ao gramado
  const stone = std(0xb9b2a4, 0.95);
  [[3.9, 0.9], [4.35, 0.55], [4.8, 0.2]].forEach(([x, z]) => add(new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.03, 12), stone), { x, y: 0.012, z, cast: false }));

  // ---- varanda (deque) junto da porta + degrau
  const deck = box(YARD.x0 + 1.75 - YARD.x0, 0.03, 2.5, std(0xffffff, 0.8, { map: deckTexture() }), { x: YARD.x0 + 0.875, z: 1.1 });
  box(0.35, 0.015, 2.5, std(0xd6b98a, 0.8), { x: YARD.x0 + 1.9, z: 1.1, cast: false });
  // capacho
  box(0.7, 0.012, 0.45, std(0xa8483c, 1), { x: 2.5, y: 0.03, z: 0.7, cast: false });

  // ---- cerca (fundos e direita)
  const wood = std(0xe8dcc3, 0.9);
  for (let x = YARD.x0 + 0.1; x <= YARD.x1; x += 0.22) box(0.14, 1.15 + ((x * 7) % 0.1), 0.03, wood, { x, z: YARD.z0 });
  for (let z = YARD.z0; z <= YARD.z1; z += 0.22) box(0.03, 1.15 + ((z * 7) % 0.1), 0.14, wood, { x: YARD.x1, z });
  box(W, 0.05, 0.05, wood, { x: cx, y: 0.3, z: YARD.z0 - 0.02, cast: false }); box(W, 0.05, 0.05, wood, { x: cx, y: 0.8, z: YARD.z0 - 0.02, cast: false });

  // ---- árvore (sombra) em POIS.arvore
  { const t = POIS.arvore;
    cyl(0.11, 0.16, 1.7, std(0x6b4a2f, 1), { x: t.x + 0.45, z: t.z - 0.1 }, 10);
    const leaves = new THREE.Group(); leaves.position.set(t.x + 0.45, 1.9, t.z - 0.1); root.add(leaves);
    [[0, 0.2, 0, 0.85], [0.55, -0.1, 0.1, 0.62], [-0.5, 0, -0.2, 0.68], [0.1, 0.5, 0.4, 0.58], [-0.2, 0.1, 0.55, 0.55]].forEach(([x, y, z, r], i) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), std(i % 2 ? 0x4f9a46 : 0x5fae55, 0.95)); add(m, { x, y, z, parent: leaves }); });
    sway.push({ obj: leaves, amp: 0.05, ph: 0.3 }); }

  // ---- vasos de flores ao longo da cerca dos fundos
  const potMat = std(0xc2623f, 0.85), flowerCols = [0xf4c542, 0xe0589b, 0xf6f0e6, 0xa273e0];
  [2.9, 3.35, 3.8].forEach((x, i) => {
    const g = new THREE.Group(); g.position.set(x, 0, -2.3); root.add(g);
    cyl(0.12, 0.09, 0.2, potMat, { parent: g }); cyl(0.105, 0.105, 0.02, std(0x3a2a1f, 1), { y: 0.19, parent: g, cast: false });
    const stems = new THREE.Group(); g.add(stems);
    for (let k = 0; k < 6; k++) { const a = (k / 6) * 6.28, h = 0.28 + (k % 3) * 0.07; const s = cyl(0.006, 0.006, h, std(0x3f8f4a), { x: Math.cos(a) * 0.05, z: Math.sin(a) * 0.05, y: 0.2, parent: stems }, 5); const f = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), std(flowerCols[(i + k) % 4], 0.7)); f.position.set(Math.cos(a) * 0.05, 0.2 + h, Math.sin(a) * 0.05); f.castShadow = true; stems.add(f); }
    sway.push({ obj: stems, amp: 0.1, ph: i });
  });
  // arbustos
  [[3.2, -2.0, 0.45], [6.4, -2.1, 0.55], [6.45, 1.9, 0.5]].forEach(([x, z, r], i) => add(new THREE.Mesh(new THREE.SphereGeometry(r, 12, 9), std(0x468c3d, 1)), { x, y: r * 0.7, z }));
  // pedra de sol
  { const p = POIS.pedra; const m = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 8), std(0x9a9a98, 0.95)); m.scale.set(1.2, 0.35, 0.95); add(m, { x: p.x, y: 0.1, z: p.z }); }

  // ---- comedouro de passarinhos
  const feederPos = new THREE.Vector3(POIS.comedouro.x, 0, POIS.comedouro.z - 0.15);
  cyl(0.025, 0.025, 1.0, std(0x6b4a2f), { x: feederPos.x, z: feederPos.z }, 8);
  box(0.34, 0.03, 0.26, std(0xb98a52), { x: feederPos.x, y: 1.0, z: feederPos.z });
  box(0.44, 0.03, 0.34, std(0xa8483c), { x: feederPos.x, y: 1.28, z: feederPos.z, ry: 0 });
  [[-0.15, -0.11], [0.15, -0.11], [-0.15, 0.11], [0.15, 0.11]].forEach(([dx, dz]) => cyl(0.006, 0.006, 0.26, std(0x6b4a2f), { x: feederPos.x + dx, y: 1.02, z: feederPos.z + dz }, 4));
  root.userData.feederTop = new THREE.Vector3(feederPos.x, 1.05, feederPos.z);

  // ---- borboletas
  const butterflies = [];
  const wingMat = (c) => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide });
  [0xf2a33a, 0x6ab7e8, 0xf6e45a].forEach((c, i) => {
    const g = new THREE.Group(); const wl = new THREE.Mesh(new THREE.CircleGeometry(0.05, 8), wingMat(c)), wr = wl.clone();
    wl.position.x = -0.045; wr.position.x = 0.045; g.add(wl, wr);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.07, 5), new THREE.MeshBasicMaterial({ color: 0x3a2a1f })); body.rotation.x = Math.PI / 2; g.add(body);
    root.add(g); butterflies.push({ g, wl, wr, ph: i * 2.1, cx: 3.9 + i * 0.7, cz: 0.8 + (i - 1) * 0.9, r: 0.8 + i * 0.25, h: 0.5 + i * 0.18, sp: 0.5 + i * 0.12 });
  });

  // ---- passarinhos (pousam no comedouro, na cerca e na árvore; saem voando de vez em quando)
  const perches = [root.userData.feederTop.clone().add(new THREE.Vector3(0.1, 0.03, 0)), new THREE.Vector3(5.0, 1.2, YARD.z0), new THREE.Vector3(6.2, 1.2, YARD.z0), new THREE.Vector3(POIS.arvore.x + 0.2, 2.6, POIS.arvore.z + 0.2), new THREE.Vector3(YARD.x1, 1.2, -0.5)];
  const birds = [0, 1].map((k) => {
    const g = new THREE.Group(); const col = k ? 0x6a7fa8 : 0xa8673a;
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), std(col, 0.8)); body.scale.set(1, 0.9, 1.4);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), std(col, 0.8)); head.position.set(0, 0.04, 0.06);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.01, 0.03, 5), std(0xf0a82a)); beak.rotation.x = Math.PI / 2; beak.position.set(0, 0.04, 0.095);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.01, 0.07), std(col * 0.7 | 0)); tail.position.set(0, 0.0, -0.1);
    g.add(body, head, beak, tail); g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); root.add(g);
    return { g, from: perches[k].clone(), to: perches[k].clone(), t: 1, wait: 3 + k * 4, idx: k };
  });

  // ---- nuvens e chuva
  const clouds = new THREE.Group(); root.add(clouds);
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, fog: false });
  for (let i = 0; i < 7; i++) { const c = new THREE.Group(); for (let k = 0; k < 4; k++) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.9 + k * 0.15, 10, 8), cloudMat); s.scale.set(1.6, 0.6, 0.9); s.position.set(k * 0.9 - 1.3, (k % 2) * 0.15, 0); c.add(s); } c.position.set(-6 + i * 3.4, 4.2 + (i % 3) * 0.6, -9 - (i % 2) * 2); clouds.add(c); }
  const N = 700, rainPos = new Float32Array(N * 3), rr = rnd(77);
  for (let i = 0; i < N; i++) { rainPos[i * 3] = -3 + rr() * 11; rainPos[i * 3 + 1] = rr() * 4.5; rainPos[i * 3 + 2] = -4 + rr() * 8; }
  const rainGeo = new THREE.BufferGeometry(); rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({ color: 0xbfd7ee, size: 0.035, transparent: true, opacity: 0.0, depthWrite: false, fog: false }));
  rain.frustumCulled = false; rain.visible = false; root.add(rain);

  let t = 0;
  const state = { vento: 0.15, chuva: false };
  root.userData.butterflyPositions = () => butterflies.map((b) => b.g.position.clone());
  root.userData.setWeather = (w) => {
    const tipo = w?.tipo || "sol", f = w?.forca ?? 0.6;
    state.vento = tipo === "vento" ? 0.9 + 0.5 * f : 0.12 + 0.1 * f; state.chuva = tipo === "chuva";
    rain.visible = state.chuva; rain.material.opacity = state.chuva ? 0.35 + 0.35 * f : 0;
    cloudMat.color.setHex(tipo === "chuva" ? 0x6c7684 : tipo === "nublado" ? 0xb9bfc8 : 0xffffff); cloudMat.opacity = tipo === "sol" ? 0.75 : tipo === "vento" ? 0.85 : 0.95;
    clouds.children.forEach((c, i) => { c.visible = tipo === "sol" ? i % 3 === 0 : tipo === "vento" ? i % 2 === 0 : true; });
    state.tipo = tipo;
  };
  root.userData.update = (dt, { reduced = false } = {}) => {
    t += dt; const k = reduced ? 0.4 : 1;
    for (const s of sway) { s.obj.rotation.z = Math.sin(t * (1.2 + state.vento * 2) + s.ph) * s.amp * (0.4 + state.vento * 1.6) * k; s.obj.rotation.x = Math.cos(t * 0.9 + s.ph) * s.amp * 0.5 * state.vento * k; }
    for (const b of butterflies) {
      const a = t * b.sp + b.ph; b.g.position.set(b.cx + Math.cos(a) * b.r, b.h + Math.sin(a * 2.3) * 0.12, b.cz + Math.sin(a * 1.3) * b.r * 0.8);
      b.g.rotation.y = -a + Math.PI / 2; const f = 0.35 + Math.abs(Math.sin(t * 14 + b.ph)) * 1.0; b.wl.rotation.y = f; b.wr.rotation.y = -f;
      b.g.visible = state.tipo !== "chuva";
    }
    for (const b of birds) { // máquina de estados simples: pousa -> espera -> voa pra outro poleiro
      if (state.tipo === "chuva") { b.g.visible = false; continue; }
      b.g.visible = true;
      if (b.t < 1) { b.t = Math.min(1, b.t + dt / 0.9); const u = b.t; b.g.position.lerpVectors(b.from, b.to, u); b.g.position.y += Math.sin(u * Math.PI) * 0.35; b.g.lookAt(b.to.x, b.g.position.y, b.to.z); }
      else { b.wait -= dt; b.g.position.copy(b.to); b.g.rotation.x = Math.sin(t * 3 + b.idx) * 0.05; if (b.wait <= 0) { b.from.copy(b.to); b.to.copy(perches[(Math.random() * perches.length) | 0]); b.t = 0; b.wait = 5 + Math.random() * 9; } }
    }
    clouds.children.forEach((c, i) => { c.position.x += dt * (0.12 + state.vento * 0.5) * (1 + (i % 3) * 0.2); if (c.position.x > 14) c.position.x = -9; });
    if (rain.visible) { const p = rainGeo.attributes.position.array; for (let i = 0; i < N; i++) { p[i * 3 + 1] -= dt * 5.5; p[i * 3] -= dt * state.vento * 0.8; if (p[i * 3 + 1] < 0) { p[i * 3 + 1] = 4.5; } } rainGeo.attributes.position.needsUpdate = true; }
  };
  root.userData.setWeather({ tipo: "sol", forca: 0.6 });
  return root;
}
