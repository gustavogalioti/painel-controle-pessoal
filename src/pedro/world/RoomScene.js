// Sala do Pedro — tudo modelado aqui com primitivas do three + texturas procedurais (canvas).
// Nenhum asset de terceiros (nem da Nintendo). Janelão com esquadria que projeta sombra no chão,
// tapete colorido, planta, caminha de vime, tigelas, caixa de papelão, mala aberta, poltrona preta,
// mesa com papéis, arranhador, caixa de areia (discreta) e abajur (luz noturna).
import * as THREE from "three";
import { ROOM, POIS } from "./pois.js";

const W = ROOM.w, D = ROOM.d, H = ROOM.h;
const WIN = { x0: -0.95, x1: 0.55, y0: 0.8, y1: 2.05 }; // abertura da janela na parede dos fundos

function canvasTex(w, h, draw, { repeat = null, srgb = true } = {}) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.anisotropy = 4;
  return t;
}
const rnd = (seed) => { let a = seed; return () => (a = (a * 16807) % 2147483647) / 2147483647; };

function woodTexture() {
  return canvasTex(512, 512, (g, w, h) => {
    const r = rnd(11); g.fillStyle = "#d9b98a"; g.fillRect(0, 0, w, h);
    const planks = 6, ph = h / planks;
    for (let i = 0; i < planks; i++) {
      const tone = 200 + r() * 30; g.fillStyle = `rgb(${tone},${tone - 38},${tone - 88})`; g.fillRect(0, i * ph, w, ph);
      for (let k = 0; k < 40; k++) { g.strokeStyle = `rgba(120,80,40,${0.04 + r() * 0.08})`; g.lineWidth = 1; g.beginPath(); const y = i * ph + r() * ph; g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + r() * 4 - 2, w * 0.6, y + r() * 4 - 2, w, y); g.stroke(); }
      g.fillStyle = "rgba(90,58,30,0.55)"; g.fillRect(0, i * ph, w, 2);
      const j = r() * w; g.fillRect(j, i * ph, 2, ph);
    }
  }, { repeat: [2, 2] });
}
function wallTexture() {
  return canvasTex(256, 256, (g, w, h) => {
    const r = rnd(5); g.fillStyle = "#fbf1df"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { const a = r() * 0.07; g.fillStyle = r() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(150,120,80,${a})`; g.fillRect(r() * w, r() * h, 2 + r() * 5, 2 + r() * 5); }
  }, { repeat: [3, 2] });
}
function rugTexture() {
  return canvasTex(512, 512, (g, w, h) => {
    const cols = ["#c9684d", "#ecc58a", "#6fa39c", "#f1e6cf", "#a8708f", "#f1e6cf"];
    for (let i = 0; i < cols.length; i++) { g.fillStyle = cols[i]; g.beginPath(); g.arc(w / 2, h / 2, (w / 2) * (1 - i / cols.length) - 1, 0, 7); g.fill(); }
    const r = rnd(3); for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(255,255,255,${r() * 0.06})`; g.fillRect(r() * w, r() * h, 1.5, 3); }
  });
}
function paperTexture(seed) {
  return canvasTex(128, 170, (g, w, h) => {
    const r = rnd(seed); g.fillStyle = "#fbfaf5"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(40,50,90,0.55)"; g.lineWidth = 1;
    for (let y = 14; y < h - 8; y += 7) { g.beginPath(); g.moveTo(10, y); let x = 10; while (x < w - 12) { x += 2 + r() * 3; g.lineTo(x, y + (r() - 0.5) * 2); } g.stroke(); }
    g.fillStyle = "rgba(70,140,200,0.3)"; g.fillRect(12, 20 + r() * 50, 50, 5);
  });
}

const std = (color, rough = 0.85, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra });

export function buildRoom() {
  const root = new THREE.Group(); root.name = "room";
  const shadowers = []; // meshes que lançam/recebem sombra
  const add = (mesh, { x = 0, y = 0, z = 0, ry = 0, cast = true, receive = true, parent = root } = {}) => {
    mesh.position.set(x, y, z); mesh.rotation.y = ry; mesh.castShadow = cast; mesh.receiveShadow = receive; parent.add(mesh); shadowers.push(mesh); return mesh;
  };
  const box = (w, h, d, mat, o) => add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat), { ...o, y: (o?.y ?? 0) + h / 2 });
  const cyl = (rt, rb, h, mat, o, seg = 24) => add(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat), { ...o, y: (o?.y ?? 0) + h / 2 });

  // ---- piso
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), std(0xffffff, 0.7, { map: woodTexture() }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; root.add(floor);

  // ---- paredes (fundos com abertura de janela; esquerda e direita; a frente fica aberta p/ a câmera)
  const wallMat = std(0xffffff, 0.95, { map: wallTexture() });
  const T = 0.12, zb = -D / 2 - T / 2;
  const wb = (x0, x1, y0, y1) => box(x1 - x0, y1 - y0, T, wallMat, { x: (x0 + x1) / 2, y: y0, z: zb });
  wb(-W / 2 - T, WIN.x0, 0, H); wb(WIN.x1, W / 2 + T, 0, H); wb(WIN.x0, WIN.x1, 0, WIN.y0); wb(WIN.x0, WIN.x1, WIN.y1, H);
  box(T, H, D + T, wallMat, { x: -W / 2 - T / 2, z: 0 }); box(T, H, D + T, wallMat, { x: W / 2 + T / 2, z: 0 });
  // rodapé
  const baseMat = std(0xfaf3e6, 0.6);
  box(W, 0.09, 0.025, baseMat, { z: -D / 2 + 0.0125, cast: false });
  box(0.025, 0.09, D, baseMat, { x: -W / 2 + 0.0125, cast: false }); box(0.025, 0.09, D, baseMat, { x: W / 2 - 0.0125, cast: false });

  // ---- janela: esquadria (projeta sombra), peitoril, "lá fora" e cortinas
  const frame = std(0xf6efe2, 0.5), fw = 0.045, wz = -D / 2 + 0.01;
  const ww = WIN.x1 - WIN.x0, wh = WIN.y1 - WIN.y0, cxw = (WIN.x0 + WIN.x1) / 2;
  box(ww, fw, 0.07, frame, { x: cxw, y: WIN.y0, z: wz }); box(ww, fw, 0.07, frame, { x: cxw, y: WIN.y1 - fw, z: wz });
  box(fw, wh, 0.07, frame, { x: WIN.x0 + fw / 2, y: WIN.y0, z: wz }); box(fw, wh, 0.07, frame, { x: WIN.x1 - fw / 2, y: WIN.y0, z: wz });
  box(fw * 0.8, wh, 0.05, frame, { x: cxw, y: WIN.y0, z: wz }); box(ww, fw * 0.8, 0.05, frame, { x: cxw, y: WIN.y0 + wh * 0.55, z: wz });
  box(ww + 0.16, 0.035, 0.2, std(0xe9dcc4, 0.6), { x: cxw, y: WIN.y0 - 0.035, z: -D / 2 + 0.07 });
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(14, 8), new THREE.MeshBasicMaterial({ color: 0xbfe0ff, fog: false }));
  outside.position.set(cxw, 2, -D / 2 - 3.2); root.add(outside);
  // copa de árvore (silhueta verde lá fora)
  const treeMat = new THREE.MeshBasicMaterial({ color: 0x5f8f4e, fog: false });
  root.userData.treeMat = treeMat;
  [[-1.2, 1.15, 0.4], [-0.55, 1.5, 0.32], [0.25, 1.25, 0.45], [0.7, 1.05, 0.3]].forEach(([x, y, r]) => { const m = new THREE.Mesh(new THREE.CircleGeometry(r, 24), treeMat); m.position.set(x, y, -D / 2 - 3.1); root.add(m); });
  const curtain = std(0xe8b27a, 0.95);
  [WIN.x0 - 0.13, WIN.x1 + 0.13].forEach((x) => box(0.2, wh + 0.3, 0.05, curtain, { x, y: WIN.y0 - 0.05, z: -D / 2 + 0.12, receive: false }));
  box(ww + 0.8, 0.025, 0.025, std(0x6b4a2f, 0.5), { x: cxw, y: WIN.y1 + 0.2, z: -D / 2 + 0.12, cast: false });

  // ---- tapete
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1, 48), std(0xffffff, 1, { map: rugTexture() }));
  rug.rotation.x = -Math.PI / 2; rug.scale.set(0.75, 0.5, 1); rug.position.set(0.3, 0.004, 0.55); rug.receiveShadow = true; root.add(rug);

  // ---- caminha de vime
  const bed = new THREE.Group(); bed.position.set(POIS.caminha.x, 0, POIS.caminha.z); root.add(bed);
  const wicker = std(0xb98a52, 0.9), cushion = std(0xe9d5b5, 1);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.06, 12, 36), wicker); ring.rotation.x = Math.PI / 2; ring.position.y = 0.12; add(ring, { parent: bed });
  for (let i = 0; i < 3; i++) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.035, 8, 36), wicker); t.rotation.x = Math.PI / 2; t.position.y = 0.03 + i * 0.05; add(t, { parent: bed }); }
  const bedBase = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.37, 0.07, 32), wicker); add(bedBase, { y: 0.035, parent: bed });
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.06, 32), cushion); add(pad, { y: 0.09, parent: bed });

  // ---- tigelas (comida e água)
  const bowl = (poi, color, content) => {
    const g = new THREE.Group(); g.position.set(poi.x, 0, poi.z + 0.06); root.add(g);
    const pts = [[0.001, 0], [0.07, 0], [0.095, 0.025], [0.105, 0.055], [0.1, 0.058], [0.09, 0.05], [0.07, 0.03], [0.001, 0.03]].map(([x, y]) => new THREE.Vector2(x, y));
    add(new THREE.Mesh(new THREE.LatheGeometry(pts, 24), std(color, 0.35, { side: THREE.DoubleSide })), { parent: g });
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.083, 0.083, 0.01, 24), std(content, content === 0x7fb8d8 ? 0.15 : 0.9)), { y: 0.038, parent: g, cast: false });
  };
  bowl(POIS.comida, 0xd6704f, 0x7a4a2a); bowl(POIS.agua, 0x5f8fa8, 0x7fb8d8);

  // ---- caixa de papelão (aberta) e mala aberta
  const card = std(0xb98b5a, 0.95);
  { const g = new THREE.Group(); g.position.set(POIS.caixa.x - 0.08, 0, POIS.caixa.z); g.rotation.y = 0.15; root.add(g);
    box(0.5, 0.3, 0.02, card, { z: 0.24, parent: g }); box(0.5, 0.3, 0.02, card, { z: -0.24, parent: g });
    box(0.02, 0.3, 0.46, card, { x: 0.24, parent: g }); box(0.02, 0.3, 0.46, card, { x: -0.24, parent: g }); box(0.46, 0.01, 0.46, std(0x9a6f45, 1), { y: 0, parent: g, cast: false });
    const fl = box(0.5, 0.01, 0.2, card, { z: 0.34, y: 0.27, parent: g }); fl.rotation.x = -0.5; }
  { const g = new THREE.Group(); g.position.set(POIS.mala.x, 0, POIS.mala.z); g.rotation.y = 0.5; root.add(g);
    const shell = std(0x3d6b8f, 0.55), lining = std(0xd8c8a8, 1);
    box(0.7, 0.05, 0.46, shell, { parent: g }); box(0.7, 0.14, 0.03, shell, { z: 0.215, parent: g }); box(0.7, 0.14, 0.03, shell, { z: -0.215, parent: g });
    box(0.03, 0.14, 0.46, shell, { x: 0.335, parent: g }); box(0.03, 0.14, 0.46, shell, { x: -0.335, parent: g }); box(0.62, 0.025, 0.4, lining, { y: 0.05, parent: g, cast: false });
    const lid = box(0.7, 0.05, 0.46, shell, { y: 0, z: -0.46, parent: g }); lid.rotation.x = -1.7; lid.position.set(0, 0.35, -0.3); }

  // ---- poltrona preta
  { const g = new THREE.Group(); g.position.set(-W / 2 + 0.5, 0, POIS.poltrona.z - 0.15); g.rotation.y = Math.PI / 2 - 0.15; root.add(g);
    const fab = std(0x1b1a1c, 1);
    box(0.78, 0.2, 0.7, fab, { y: 0.18, parent: g }); box(0.78, 0.5, 0.18, fab, { y: 0.3, z: -0.3, parent: g });
    box(0.16, 0.3, 0.64, fab, { x: 0.32, y: 0.18, parent: g }); box(0.16, 0.3, 0.64, fab, { x: -0.32, y: 0.18, parent: g });
    [[0.3, 0.3], [-0.3, 0.3], [0.3, -0.25], [-0.3, -0.25]].forEach(([x, z]) => cyl(0.02, 0.016, 0.18, std(0xaaaaaa, 0.3, { metalness: 0.8 }), { x, z, parent: g }, 8)); }

  // ---- mesa de estudo com papéis (+ papéis no chão, onde o Pedro dorme "em cima dos papéis")
  { const g = new THREE.Group(); g.position.set(W / 2 - 0.4, 0, -0.75); root.add(g);
    const top = std(0xcfae7d, 0.7);
    box(0.7, 0.04, 1.5, top, { y: 0.72, parent: g });
    [[0.3, 0.7], [-0.3, 0.7], [0.3, -0.7], [-0.3, -0.7]].forEach(([x, z]) => box(0.04, 0.72, 0.04, std(0x2b2b2e, 0.5), { x, z, parent: g }));
    const sheet = (x, z, ry, y, seed) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.297), std(0xffffff, 0.9, { map: paperTexture(seed) })); m.rotation.x = -Math.PI / 2; m.rotation.z = ry; m.position.set(x, y, z); m.receiveShadow = true; m.castShadow = true; g.add(m); };
    [[0.05, 0.3, 0.3, 1], [-0.1, 0.05, -0.4, 2], [0.1, -0.3, 0.9, 3], [-0.05, -0.55, 0.1, 4]].forEach(([x, z, r, s]) => sheet(x, z, r, 0.745, s));
    cyl(0.04, 0.04, 0.1, std(0x444a52, 0.5), { x: 0.2, z: 0.62, y: 0.74, parent: g }, 12);
    // folhas no chão (POI papeis)
    const floorSheet = (dx, dz, r, s) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.297), std(0xffffff, 0.9, { map: paperTexture(s + 9) })); m.rotation.x = -Math.PI / 2; m.rotation.z = r; m.position.set(POIS.papeis.x - g.position.x + dx, 0.012, POIS.papeis.z - g.position.z + dz); m.receiveShadow = true; g.add(m); };
    [[-0.1, 0.05, 0.4, 1], [0.12, -0.06, -0.5, 2], [0.0, 0.14, 1.3, 3], [-0.12, -0.14, 0.1, 4]].forEach((a) => floorSheet(...a)); }

  // ---- planta
  { const g = new THREE.Group(); g.position.set(W / 2 - 0.3, 0, 0.35); root.add(g);
    cyl(0.14, 0.1, 0.26, std(0xc2623f, 0.8), { parent: g }); cyl(0.12, 0.12, 0.02, std(0x3a2a1f, 1), { y: 0.25, parent: g, cast: false });
    const leaf = std(0x3f8f4a, 0.7), leaf2 = std(0x5fae5a, 0.7);
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2, tilt = 0.35 + (i % 3) * 0.18; const m = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), i % 2 ? leaf : leaf2); m.scale.set(0.55, 1.9, 0.12); m.position.set(Math.cos(a) * 0.1, 0.5 + (i % 3) * 0.07, Math.sin(a) * 0.1); m.rotation.set(Math.sin(a) * tilt, a, -Math.cos(a) * tilt); add(m, { parent: g }); } }

  // ---- arranhador
  { const g = new THREE.Group(); g.position.set(POIS.arranhador.x + 0.28, 0, POIS.arranhador.z); root.add(g);
    box(0.4, 0.04, 0.4, std(0xe0d2b8, 1), { parent: g }); cyl(0.07, 0.07, 0.6, std(0xc9a46b, 1), { y: 0.04, parent: g }, 16);
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 10), std(0xe0d2b8, 1)); add(top, { y: 0.68, parent: g }); }

  // ---- caixa de areia (discreta, canto do fundo à direita)
  { const g = new THREE.Group(); g.position.set(W / 2 - 0.35, 0, -D / 2 + 0.3); root.add(g);
    const shell = std(0x9bb3b0, 0.6);
    box(0.4, 0.14, 0.03, shell, { z: 0.185, parent: g }); box(0.4, 0.14, 0.03, shell, { z: -0.185, parent: g }); box(0.03, 0.14, 0.34, shell, { x: 0.185, parent: g }); box(0.03, 0.14, 0.34, shell, { x: -0.185, parent: g });
    box(0.36, 0.08, 0.34, std(0xdccfb0, 1), { parent: g, cast: false }); }

  // ---- abajur (mesinha ao lado da poltrona) com luz noturna
  const lampLight = new THREE.PointLight(0xffc27a, 0, 4, 1.4);
  { const g = new THREE.Group(); g.position.set(-W / 2 + 0.3, 0, POIS.poltrona.z - 0.85); root.add(g);
    cyl(0.17, 0.17, 0.42, std(0xb08a5a, 0.7), { parent: g });
    cyl(0.025, 0.025, 0.25, std(0x3a3a3a, 0.4), { y: 0.42, parent: g }, 8);
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 0.2, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0xf4dcb0, emissive: 0xffb866, emissiveIntensity: 0, side: THREE.DoubleSide, roughness: 0.9 }));
    shade.position.y = 0.78; g.add(shade); lampLight.position.set(0, 0.8, 0); g.add(lampLight); root.userData.lampShade = shade; }

  root.userData.lampLight = lampLight;
  root.userData.outside = outside;
  root.userData.shadowers = shadowers;
  return root;
}
