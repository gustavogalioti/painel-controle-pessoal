// Efeitos visuais leves: corações (carinho), "+1" de biscoito, brinquedos 3D. Pool pequeno, sem alocar por frame.
import * as THREE from "three";

function heartTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d");
  g.fillStyle = "#ff6b8a"; g.beginPath(); g.moveTo(32, 54); g.bezierCurveTo(2, 34, 8, 8, 32, 20); g.bezierCurveTo(56, 8, 62, 34, 32, 54); g.fill();
  g.fillStyle = "rgba(255,255,255,0.45)"; g.beginPath(); g.ellipse(21, 24, 6, 4, -0.6, 0, 7); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Hearts {
  constructor(scene, max = 14) {
    this.tex = heartTexture(); this.items = [];
    for (let i = 0; i < max; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false; s.scale.setScalar(0.08); scene.add(s); this.items.push({ s, t: 0, life: 0, vx: 0, vz: 0 });
    }
  }
  spawn(pos, n = 1, { calm = false } = {}) {
    for (let k = 0; k < n; k++) {
      const it = this.items.find((x) => x.life <= 0); if (!it) return;
      it.life = it.t = calm ? 1.0 : 1.5; it.vx = (Math.random() - 0.5) * (calm ? 0.04 : 0.14); it.vz = (Math.random() - 0.5) * 0.06;
      it.s.position.set(pos.x + (Math.random() - 0.5) * 0.12, pos.y, pos.z + (Math.random() - 0.5) * 0.12); it.s.visible = true;
    }
  }
  update(dt) {
    for (const it of this.items) {
      if (it.life <= 0) continue;
      it.life -= dt; const u = 1 - it.life / it.t;
      it.s.position.y += dt * 0.22; it.s.position.x += it.vx * dt; it.s.position.z += it.vz * dt;
      it.s.material.opacity = u < 0.15 ? u / 0.15 : Math.max(0, 1 - (u - 0.4) / 0.6);
      it.s.scale.setScalar(0.07 + 0.05 * Math.sin(Math.min(1, u * 3) * 1.57));
      if (it.life <= 0) it.s.visible = false;
    }
  }
  dispose() { this.tex.dispose(); this.items.forEach((i) => { i.s.material.dispose(); i.s.parent?.remove(i.s); }); }
}

// Brinquedos 3D (primitivas). Todos com origem no chão.
export function makeToy(kind) {
  const g = new THREE.Group(); g.userData.kind = kind;
  if (kind === "bolinha") {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.035, 18, 14), new THREE.MeshStandardMaterial({ color: 0xe04f5f, roughness: 0.5 }));
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.004, 6, 24), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 })); stripe.rotation.x = Math.PI / 2;
    m.position.y = 0.035; stripe.position.y = 0.035; m.castShadow = true; g.add(m, stripe);
  } else if (kind === "ratinho") {
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.04, 14, 10), new THREE.MeshStandardMaterial({ color: 0x9a9aa3, roughness: 0.95 })); body.scale.set(1.5, 0.9, 0.9); body.position.y = 0.035; body.castShadow = true;
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.01, 8, 6), new THREE.MeshStandardMaterial({ color: 0xe58a9a })); nose.position.set(0.058, 0.04, 0);
    const earMat = new THREE.MeshStandardMaterial({ color: 0xd9a0ac, roughness: 0.9 });
    [0.022, -0.022].forEach((z) => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), earMat); e.position.set(0.035, 0.065, z); g.add(e); });
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.09, 6), earMat); tail.rotation.z = Math.PI / 2; tail.position.set(-0.1, 0.02, 0);
    g.add(body, nose, tail);
  } else if (kind === "petisco") {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.012, 14), new THREE.MeshStandardMaterial({ color: 0xc98a4a, roughness: 0.9 })); m.position.y = 0.008;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.006, 6, 4), new THREE.MeshStandardMaterial({ color: 0x6b3f1c })); dot.position.set(0.01, 0.016, 0.005); g.add(m, dot);
  } else { // pena na varinha
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.35, 6), new THREE.MeshStandardMaterial({ color: 0x8a6b45 })); stick.position.set(0, 0.2, 0); stick.rotation.z = 0.4;
    const fm = new THREE.MeshStandardMaterial({ color: 0x5fb8d6, roughness: 0.8, side: THREE.DoubleSide });
    for (let i = 0; i < 4; i++) { const f = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.12), fm); f.position.set(-0.07 - i * 0.004, 0.37, (i - 1.5) * 0.012); f.rotation.set(0.3 * i, 0, 0.9 - i * 0.2); g.add(f); }
    const tip = new THREE.Object3D(); tip.name = "tip"; tip.position.set(-0.07, 0.37, 0); g.add(stick, tip);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  return g;
}

// Pijama de biscoito de gengibre (azul-marinho com biscoitinhos) — cilindro/cápsula sobre o tronco.
export function makeOutfit() {
  const c = document.createElement("canvas"); c.width = 256; c.height = 128; const g = c.getContext("2d");
  g.fillStyle = "#243a6e"; g.fillRect(0, 0, 256, 128);
  const man = (x, y, r) => { g.save(); g.translate(x, y); g.rotate(r); g.fillStyle = "#d9a15f"; g.beginPath(); g.arc(0, -11, 6, 0, 7); g.fill(); g.fillRect(-6, -6, 12, 13); g.fillRect(-14, -5, 28, 5); g.fillRect(-8, 6, 5, 11); g.fillRect(3, 6, 5, 11); g.fillStyle = "#fff"; g.fillRect(-2, -12, 1.6, 1.6); g.fillRect(2, -12, 1.6, 1.6); g.restore(); };
  const cane = (x, y) => { g.strokeStyle = "#fff"; g.lineWidth = 3; g.beginPath(); g.moveTo(x, y + 10); g.lineTo(x, y); g.arc(x + 4, y, 4, Math.PI, 0); g.stroke(); g.strokeStyle = "#e0404a"; g.setLineDash([3, 4]); g.stroke(); g.setLineDash([]); };
  for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) { const x = 25 + i * 52 + (j % 2) * 24, y = 28 + j * 38; man(x, y, ((i + j) % 3 - 1) * 0.3); if ((i + j) % 2) cane(x + 20, y - 8); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping;
  const geo = new THREE.CapsuleGeometry(0.068, 0.2, 6, 16); geo.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
  m.scale.set(1, 0.92, 1); m.castShadow = true; m.name = "outfit";
  return m;
}
