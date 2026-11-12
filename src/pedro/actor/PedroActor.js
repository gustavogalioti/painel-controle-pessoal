// PedroActor — interface única do gato na cena (spec §4.5). Hoje implementada sobre a lib
// threejs-procedural-animals (MIT, vendorizada em ../vendor). Se um dia a lib for trocada
// (plano B: gato procedural próprio), só este arquivo muda: a cena e o comportamento só
// conhecem: moveTo, lookAt, face, play, stopAction, comeToCamera, setMood, setOutfit.
import * as THREE from "three";
import { createAnimal } from "../vendor/procedural-animals/index.js";
import { groundHeight, clampToRoom } from "../world/pois.js";

// "Receita" do Pedro (ver docs/PEDRO-VIRTUAL.md): gato ginger rajado, macho, focinho/queixo brancos,
// olhos dourados. Mudou aqui => rodar `node scripts/pedro-bake.mjs` pra regerar o .animal.
export const PEDRO_LOOK = { seed: 2, sex: "male", variant: "ginger", overrides: { muzzleWhite: true, white: 0.8, eye: "gold" } };
const ARRIVE_R = 0.3; // igual ao raio de parada da lib (0.35 * k)
export const BAKED_URL = "/pedro/pedro-cat-medium.animal";

export class PedroActor {
  static async create({ parent, onProgress, position = new THREE.Vector3(0.1, 0, 0.5), heading = 0 }) {
    const common = { ...PEDRO_LOOK, ground: groundHeight, position, heading, castShadow: true, receiveShadow: true, onProgress };
    let animal = null, source = "baked";
    try {
      const baked = fetch(BAKED_URL).then((r) => { if (!r.ok) throw new Error(`bake ${r.status}`); return r.arrayBuffer(); });
      baked.catch(() => {}); // a falha é tratada abaixo (fallback em runtime); evita 'unhandled rejection'
      animal = await createAnimal("cat", { ...common, baked });
    } catch (e) {
      console.warn("Pedro: bake indisponível, gerando em runtime:", e?.message || e);
      source = "runtime";
      try { animal = await createAnimal("cat", { ...common, quality: "medium" }); }
      catch { animal = await createAnimal("cat", { ...common, quality: "medium", worker: false }); }
    }
    parent.add(animal.object);
    return new PedroActor(animal, source);
  }

  constructor(animal, source) {
    this.animal = animal; this.source = source;
    this.object = animal.object;
    this._moveSeq = 0; this._moveDone = null; this._target = null;
    this.mood = "calmo"; this.outfit = null;
    animal.on("arrive", () => { const d = this._moveDone; this._moveDone = null; d?.("arrive"); });
  }

  get position() { return this.animal.position; }
  get heading() { return this.animal.heading; }
  get posture() { return this.animal.state?.posture; }
  get gears() { return this.animal.gears || {}; }
  get stats() { return this.animal.stats; }

  update(dt) {
    this.animal.update(dt);
    const t = this._target;
    if (t) {
      t.t += dt;
      if (Math.hypot(this.position.x - t.x, this.position.z - t.z) < ARRIVE_R) { this.animal.stop(); t.finish("arrive"); }
      else if (t.t > t.timeoutS) { this.animal.stop(); t.finish("timeout"); }
    }
  }

  // Vai até (x,z) (dentro da sala). Resolve "arrive" | "cancelled" | "timeout".
  // Chegou = evento `arrive` da lib OU a menos de ARRIVE_R do alvo (a lib às vezes orbita um alvo
  // apertado ou nem dispara o evento quando o gato já está lá). Timeout em tempo de CENA (pausa com a aba).
  moveTo(x, z, { speed = this.gears.walk || 0.6, timeoutS = 25 } = {}) {
    this.cancelMove();
    const [cx, cz] = clampToRoom(x, z, 0.2);
    if (Math.hypot(this.position.x - cx, this.position.z - cz) < ARRIVE_R) return Promise.resolve("arrive");
    const seq = ++this._moveSeq;
    return new Promise((resolve) => {
      const finish = (why) => { if (this._moveSeq === seq) { this._moveDone = null; this._target = null; } resolve(why); };
      this._moveDone = finish;
      this._target = { x: cx, z: cz, t: 0, timeoutS, finish };
      this.animal.moveTo(new THREE.Vector3(cx, 0, cz), { speed });
    });
  }
  cancelMove() { const d = this._moveDone; this._moveDone = null; this._target = null; this._moveSeq++; d?.("cancelled"); }

  walkSpeed() { return this.gears.walk || 0.6; }
  runSpeed() { return this.gears.trot || this.gears.bound || this.gears.walk || 1.2; }

  lookAt(target) { this.animal.lookAt(target); }
  // Gira no lugar até olhar na direção `heading` (rad; 0 = +z).
  face(heading) { this.cancelMove(); this.animal.move({ speed: 0, heading }); }
  faceToward(point) { this.face(Math.atan2(point.x - this.position.x, point.z - this.position.z)); }
  play(name, opts) { return this.animal.play(name, opts); }
  stopAction(name) { this.animal.stopAction(name); }
  stop() { this.cancelMove(); this.animal.stop(); }

  // Vem até perto da câmera, olha pra ela, senta e pisca devagar.
  async comeToCamera(camera, { run = false } = {}) {
    const f = new THREE.Vector3(); camera.getWorldDirection(f); f.y = 0;
    if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
    f.normalize();
    const spot = camera.position.clone().addScaledVector(f, 1.05); // ~1 m à frente da câmera
    await this.moveTo(spot.x, spot.z, { speed: run ? this.runSpeed() : this.walkSpeed(), timeoutS: 12 });
    this.lookAt(camera.position);
    this.faceToward(camera.position);
  }

  // Ganchos de fases futuras (humor visual e roupinha de biscoito de gengibre).
  setMood(mood) { this.mood = mood; }
  setOutfit(id) { this.outfit = id; }

  setQuality(tier) { this.animal.setQuality(tier); }
  setLod(l) { this.animal.setLod(l); }

  dispose() { this.cancelMove(); this.animal.dispose(); }
}
