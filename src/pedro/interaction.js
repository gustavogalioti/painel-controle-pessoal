// Interações do Pedro (Fase 3) — métodos acrescentados ao PedroScene (this = cena).
// Gestos por TOQUE primeiro (mouse equivale): carinho (arrastar devagar sobre ele), "incomoda" (arrastar rápido),
// colo (segurar), tocar nele (oi), tocar no chão (olha/vem), tigelas (comida/água), caixa/mala/caminha (convite),
// e brinquedos arrastados da bandeja (bolinha, ratinho, pena). Cada coisa vira um evento `onPetEvent`
// que a UI converte em necessidades/biscoitos (pet-state.js). Gato é gato: ele pode recusar.
import * as THREE from "three";
import { POIS, ROOM, clampToRoom } from "./world/pois.js";
import { Hearts, makeToy, makeOutfit } from "./fx.js";
import { meow, startPurr, stopPurr, chomp, lap, pop, hiss, vibrate, setSoundEnabled, unlockAudio } from "./audio.js";
import { reaction } from "./pet-state.js";

const HOTSPOTS = { comida: "feed", agua: "drink", caixa: "invite", mala: "invite", caminha: "invite", poltrona: "invite", papeis: "invite" };
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const FLOOR = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

export const interactionMethods = {
  // ---------- infra ----------
  _initFx() {
    this.hearts = new Hearts(this.scene, this.reduced ? 5 : 14);
    this._toys = []; this._ghost = null; this._zb = 1; this._zbT = 1; this._cfg = this._cfg || { som: true, vibracao: true };
  },
  setNeeds(n) { this.needs = n || null; },
  setConfig(c) { this._cfg = { ...this._cfg, ...c }; setSoundEnabled(this._cfg.som !== false); },
  _vib(ms) { vibrate(ms, this._cfg?.vibracao !== false); },
  _emit(ev) { this.onPetEvent?.(ev); },
  _head() { const p = this.actor.position; return V(p.x, 0.42, p.z); },
  _says(text) { this._emit({ type: "fala", text }); },

  setOutfit(id) { this._outfitId = id || null; this._applyOutfit(); },
  _applyOutfit() {
    if (!this.actor) return;
    if (this._outfitMesh) { this._outfitMesh.parent?.remove(this._outfitMesh); this._outfitMesh.geometry.dispose(); this._outfitMesh.material.map?.dispose(); this._outfitMesh.material.dispose(); this._outfitMesh = null; }
    if (this._outfitId !== "roupinha") return;
    const anchor = this.actor.animal.attachments?.back || this.actor.object;
    const m = makeOutfit(); anchor.add(m); this._outfitMesh = m;
  },

  _updateFx(dt) {
    this.hearts.update(dt);
    this._zb += (this._zbT - this._zb) * (1 - Math.exp(-dt * 4));
    this._updateToys(dt);
    if (this._colo) { this._coloT += dt; if (this._coloT > 1.5) { this._coloT = 0; this.hearts.spawn(this._head(), 1, { calm: true }); this._vib(8); } }
  },

  _floorPoint(cx, cy) {
    const rect = this.canvas.getBoundingClientRect();
    const px = cx - rect.left, py = cy - rect.top;
    if (px < 0 || py < 0 || px > rect.width || py > rect.height) return null;
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2((px / this._w) * 2 - 1, -(py / this._h) * 2 + 1), this.camera);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(FLOOR, hit)) return null;
    const [x, z] = clampToRoom(hit.x, hit.z, 0.2);
    return { x, z, px, py };
  },

  _catHit(px, py, k = 1) {
    const b = this.actor.position.clone(); b.y += 0.2; b.project(this.camera);
    const bx = (b.x * 0.5 + 0.5) * this._w, by = (-b.y * 0.5 + 0.5) * this._h;
    return Math.hypot(px - bx, py - by) < Math.max(56, Math.min(this._w, this._h) * 0.13) * k;
  },

  _busy() { this._interrupt(); this._brainOn = false; return this._gen; },

  // ---------- gestos ----------
  _bindInput() {
    const c = this.canvas; c.style.touchAction = "none";
    const local = (e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const down = (e) => {
      unlockAudio();
      c.setPointerCapture?.(e.pointerId);
      const [px, py] = local(e);
      const p = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), lt: performance.now(), btn: e.button, moved: false, mode: null, sp: 0 };
      this._ptrs.set(e.pointerId, p); this._pinch0 = null;
      if (this._ptrs.size === 1 && e.button !== 2 && this._catHit(px, py)) {
        p.onCat = true;
        p.lp = setTimeout(() => { p.lp = null; if (this._ptrs.get(e.pointerId) === p && !p.moved && this._ptrs.size === 1 && !p.mode) { p.mode = "colo"; this._beginColo(); } }, 600);
      }
    };
    const move = (e) => {
      const p = this._ptrs.get(e.pointerId); if (!p) return;
      const now = performance.now(), dx = e.clientX - p.x, dy = e.clientY - p.y, dtm = Math.max(1, now - p.lt);
      p.lt = now; p.x = e.clientX; p.y = e.clientY;
      if (this._ptrs.size === 2) {
        const [a, b] = [...this._ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2;
        if (this._pinch0) { this._zoom = THREE.MathUtils.clamp(this._zoom * (this._pinch0.d / d), 0.8, 1.3); this._orbit = THREE.MathUtils.clamp(this._orbit - (mx - this._pinch0.mx) * 0.004, -0.4, 0.4); }
        this._pinch0 = { d, mx }; p.moved = true; return;
      }
      if (p.btn === 2) { this._orbit = THREE.MathUtils.clamp(this._orbit - dx * 0.004, -0.4, 0.4); p.moved = true; return; }
      if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 10) { p.moved = true; if (p.lp) { clearTimeout(p.lp); p.lp = null; } }
      if (p.onCat && p.moved && p.mode !== "colo" && p.mode !== "irritado") {
        if (p.mode !== "pet") { p.mode = "pet"; this._beginPet(); }
        const [px, py] = local(e);
        p.sp = p.sp * 0.7 + (Math.hypot(dx, dy) / dtm * 1000) * 0.3;
        if (this._petMove(px, py, p.sp, dtm / 1000) === "irritado") p.mode = "irritado";
      }
    };
    const up = (e) => {
      const p = this._ptrs.get(e.pointerId); this._ptrs.delete(e.pointerId); this._pinch0 = null;
      if (!p) return;
      if (p.lp) clearTimeout(p.lp);
      if (p.mode === "pet") this._endPet();
      else if (p.mode === "colo") this._endColo();
      else if (!p.moved && !p.mode && this._ptrs.size === 0 && performance.now() - p.t < 500 && p.btn !== 2) { const [px, py] = local(e); this._tap(px, py); }
    };
    const wheel = (e) => { e.preventDefault(); this._zoom = THREE.MathUtils.clamp(this._zoom * (e.deltaY > 0 ? 1.06 : 0.94), 0.8, 1.3); };
    c.addEventListener("pointerdown", down); c.addEventListener("pointermove", move); c.addEventListener("pointerup", up); c.addEventListener("pointercancel", up);
    c.addEventListener("wheel", wheel, { passive: false }); c.addEventListener("contextmenu", (e) => e.preventDefault());
    this._unbind = () => { c.removeEventListener("pointerdown", down); c.removeEventListener("pointermove", move); c.removeEventListener("pointerup", up); c.removeEventListener("pointercancel", up); c.removeEventListener("wheel", wheel); };
  },

  _tap(px, py) {
    this.onStatus?.({ tap: { px, py } });
    if (this._catHit(px, py)) { this.sayHi(); return; }
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2((px / this._w) * 2 - 1, -(py / this._h) * 2 + 1), this.camera);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(FLOOR, hit)) return;
    const [x, z] = clampToRoom(hit.x, hit.z, 0.25);
    for (const [id, what] of Object.entries(HOTSPOTS)) {
      const poi = POIS[id];
      if (Math.hypot(x - poi.x, z - poi.z) < 0.45) {
        if (what === "feed") return this.feed("comida");
        if (what === "drink") return this.drink();
        return this.invite(id);
      }
    }
    this.attention({ x, z });
  },

  // ---------- carinho ----------
  _beginPet() {
    this._busy(); const a = this.actor;
    this._petActive = true; this._petSecs = 0; this._petAcc = 0; this._petFast = 0; this._kneaded = false; this._purring = false;
    a.lookAt(this.camera.position);
    if (a.posture === "stand" || a.posture === "standing-up") a.play("sit");
  },
  _petMove(px, py, sp, dt) {
    const scale = Math.min(this._w, this._h) / 400;
    if (sp > 1800 * scale) { this._petFast += dt; if (this._petFast > 0.5) { this._incomodo(); return "irritado"; } } else this._petFast = Math.max(0, this._petFast - dt);
    if (this._catHit(px, py, 1.6) && sp > 20 && sp < 1500 * scale) {
      this._petSecs += dt; this._petAcc += dt;
      if (!this._purring) { this._purring = true; startPurr(); }
      if (this._petAcc > 0.9) { this._petAcc = 0; this.hearts.spawn(this._head(), this.reduced ? 1 : 2); this._vib(12); }
      if (!this._kneaded && this._petSecs > 5 && (this.needs?.afeto ?? 60) > 45) { this._kneaded = true; this.actor.play("knead"); }
    }
    return null;
  },
  _endPet() {
    if (!this._petActive) return;
    this._petActive = false; stopPurr(); this.actor.lookAt(null);
    if (this._petSecs >= 1.5) this._emit({ type: "carinho", secs: this._petSecs });
    this._resumeBrainLater(3.5);
  },
  async _incomodo() { // arrastou rápido/bagunçado: ele só se afasta (nunca pune)
    this._petActive = false; stopPurr(); hiss();
    this._emit({ type: "incomodo" });
    const gen = this._busy(), a = this.actor;
    const [x, z] = clampToRoom(a.position.x + (this._rng() - 0.5) * 1.6, a.position.z - 0.5 - this._rng() * 0.5, 0.3);
    a.lookAt(null); await a.moveTo(x, z, { speed: a.walkSpeed(), timeoutS: 6 });
    if (this._alive(gen)) this._resumeBrainLater(5);
  },

  // ---------- colo (segurar) ----------
  _beginColo() {
    this._busy(); const a = this.actor, n = this.needs;
    this._colo = true; this._coloT = 0; this._zbT = 0.72; this._vib(25);
    a.lookAt(this.camera.position);
    if (n && n.diversao < 35 && n.energia > 60) { // sem vontade de colo: se debate e sai correndo
      this._coloStruggle = true; a.play("jump"); this._says("Agora não, quero correr! 😹");
      this.wait(0.7).then(() => { if (this._colo) this._endColo(); });
    } else { this._coloStruggle = false; a.play("loaf"); startPurr(); }
  },
  _endColo() {
    if (!this._colo) return;
    this._colo = false; this._zbT = 1; stopPurr(); this.actor.lookAt(null);
    this._emit(this._coloStruggle ? { type: "incomodo" } : { type: "colo" });
    this._resumeBrainLater(4);
  },

  // ---------- recusas, comida, água, convite ----------
  _recusa(what, texto) {
    this._emit({ type: "recusa", what });
    this._says(texto);
    this._busy(); this.actor.lookAt(this.camera.position); this.actor.play("slowblink");
    this._resumeBrainLater(5);
  },
  _fala(tipo) { return { comida: "Tô sem fome agora 😸", agua: "Tô sem sede, obrigado 🐾", brincar: "Tô cansado... depois a gente brinca 😴" }[tipo]; },

  async feed(kind = "comida") {
    if (reaction({ necessidades: this.needs || {} }, "comida") === "recusa" && this.needs) return this._recusa("comida", this._fala("comida"));
    const gen = this._busy();
    await this._doActivity({ poi: "comida", ativ: "comer", duracao: 6 }, gen, true, kind);
    if (this._alive(gen)) this._resumeBrainLater(5);
  },
  async drink() {
    if (this.needs && reaction({ necessidades: this.needs }, "agua") === "recusa") return this._recusa("agua", this._fala("agua"));
    const gen = this._busy();
    await this._doActivity({ poi: "agua", ativ: "beber", duracao: 5 }, gen, true);
    if (this._alive(gen)) this._resumeBrainLater(5);
  },
  async invite(poiId) { // tocou na caixa/mala/caminha/poltrona: se tiver sono ou curiosidade, entra e se acomoda
    const gen = this._busy();
    const sleepy = !this.needs || this.needs.energia < 75 || this._rng() > 0.4;
    await this._doActivity({ poi: poiId, ativ: sleepy ? "dormir" : "esconder", duracao: sleepy ? 28 : 20 }, gen, true);
    if (this._alive(gen)) this._resumeBrainLater(3);
  },
  async eatCookie(at) { // petisco: aparece onde caiu, ele vem e come
    if (this.needs && reaction({ necessidades: this.needs }, "petisco") === "recusa") { this._emit({ type: "recusa", what: "petisco", devolve: true }); return this._recusa("petisco", "Tô cheio, guarda pra depois 😸"); }
    const gen = this._busy(), a = this.actor;
    const cookie = makeToy("petisco"); const [x, z] = clampToRoom(at.x, at.z, 0.3); cookie.position.set(x, 0, z); this.scene.add(cookie);
    await a.moveTo(x, z, { speed: a.walkSpeed(), timeoutS: 10 }); if (!this._alive(gen)) { this.scene.remove(cookie); return; }
    cookie.visible = false; a.play("eat", { duration: 3 }); chomp(); this.wait(1.1).then(chomp);
    await this.wait(3.4); this.scene.remove(cookie);
    if (!this._alive(gen)) return;
    this._emit({ type: "refeicao", kind: "petisco" }); this.hearts.spawn(this._head(), 2);
    a.stopAction(); this._resumeBrainLater(4);
  },

  // ---------- brinquedos (arrastados da bandeja) ----------
  _setGhost(kind) {
    if (this._ghost?.userData.kind === kind) return this._ghost;
    if (this._ghost) this.scene.remove(this._ghost);
    this._ghost = makeToy(kind); this.scene.add(this._ghost); return this._ghost;
  },
  dragToy(kind, cx, cy) {
    unlockAudio();
    const p = this._floorPoint(cx, cy);
    if (!p) { if (this._ghost) this._ghost.visible = false; return; }
    const g = this._setGhost(kind); g.visible = true; g.position.set(p.x, kind === "pena" ? 0 : 0.14, p.z);
    const s = (this._dragS = this._dragS || []); s.push({ t: performance.now(), x: p.x, z: p.z }); if (s.length > 5) s.shift();
    if (kind === "pena") this._chaseFeather(p);
  },
  _chaseFeather(p) {
    const a = this.actor, now = performance.now();
    if (!this._feather) { this._busy(); this._feather = { swats: 0, lastSwat: 0, lastMove: 0 }; }
    const f = this._feather, d = Math.hypot(a.position.x - p.x, a.position.z - p.z);
    a.lookAt(V(p.x, 0.28, p.z));
    if (d > 0.4 && now - f.lastMove > 350) { f.lastMove = now; a.moveTo(p.x, p.z, { speed: a.runSpeed(), timeoutS: 3 }); }
    else if (d <= 0.4 && now - f.lastSwat > 1300) { f.lastSwat = now; f.swats++; a.play(f.swats % 3 === 0 ? "jump" : "attack", { target: V(p.x, 0.25, p.z) }); pop(); this._vib(10); }
  },
  async dropToy(kind, cx, cy) {
    const samples = this._dragS || []; this._dragS = [];
    if (this._ghost) { this.scene.remove(this._ghost); this._ghost = null; }
    const p = this._floorPoint(cx, cy);
    const feather = this._feather; this._feather = null;
    if (kind === "pena") {
      if (feather) { this.actor.lookAt(null); if (feather.swats >= 2) this._emit({ type: "brincou", toy: "pena" }); this._resumeBrainLater(5); }
      return;
    }
    if (!p) return this._emit({ type: "cancelado", toy: kind });
    if (this.needs && reaction({ necessidades: this.needs }, "brincar") === "recusa") return this._recusa("brincar", this._fala("brincar"));
    const toy = { kind, mesh: makeToy(kind), x: p.x, z: p.z, vx: 0, vz: 0, ttl: 70 };
    if (kind === "bolinha" && samples.length >= 2) { // arremesso: velocidade do dedo no chão
      const a = samples[0], b = samples.at(-1), dt = Math.max(0.03, (b.t - a.t) / 1000);
      toy.vx = THREE.MathUtils.clamp(((b.x - a.x) / dt) * 0.5, -3.2, 3.2); toy.vz = THREE.MathUtils.clamp(((b.z - a.z) / dt) * 0.5, -3.2, 3.2);
    }
    toy.mesh.position.set(toy.x, 0, toy.z); this.scene.add(toy.mesh); this._toys.push(toy);
    this._playWithToy(toy);
  },
  tapToy(kind) { // toque (sem arrastar) na bandeja: joga o brinquedo perto dele
    const pos = this.actor.position, ang = this._rng() * Math.PI * 2;
    const [x, z] = clampToRoom(pos.x + Math.sin(ang) * 0.9, pos.z + Math.cos(ang) * 0.9 + 0.3, 0.3);
    this._dragS = []; this._dropAt(kind, x, z);
  },
  _dropAt(kind, x, z) { // solta direto em coordenadas de mundo
    if (kind === "pena") return;
    if (this.needs && reaction({ necessidades: this.needs }, "brincar") === "recusa") return this._recusa("brincar", this._fala("brincar"));
    const toy = { kind, mesh: makeToy(kind), x, z, vx: kind === "bolinha" ? (this._rng() - 0.5) * 2.4 : 0, vz: kind === "bolinha" ? (this._rng() - 0.5) * 2.4 : 0, ttl: 70 };
    toy.mesh.position.set(x, 0, z); this.scene.add(toy.mesh); this._toys.push(toy); this._playWithToy(toy);
  },

  _updateToys(dt) {
    const mx = ROOM.w / 2 - 0.12, mz = ROOM.d / 2 - 0.12;
    for (let i = this._toys.length - 1; i >= 0; i--) {
      const t = this._toys[i]; t.ttl -= dt;
      if (t.ttl <= 0) { this.scene.remove(t.mesh); this._toys.splice(i, 1); continue; }
      if (t.vx || t.vz) {
        t.x += t.vx * dt; t.z += t.vz * dt;
        if (Math.abs(t.x) > mx) { t.x = Math.sign(t.x) * mx; t.vx *= -0.6; pop(); }
        if (t.z > mz || t.z < -mz) { t.z = Math.sign(t.z) * mz; t.vz *= -0.6; pop(); }
        const k = Math.exp(-1.7 * dt); t.vx *= k; t.vz *= k;
        if (Math.hypot(t.vx, t.vz) < 0.04) t.vx = t.vz = 0;
        t.mesh.rotation.z -= t.vx * dt * 20; t.mesh.rotation.x += t.vz * dt * 20;
        t.mesh.position.set(t.x, 0, t.z);
      }
    }
  },

  async _playWithToy(toy) {
    const gen = this._busy(), a = this.actor;
    const rounds = toy.kind === "bolinha" ? 4 : 2;
    for (let i = 0; i < rounds && this._alive(gen); i++) {
      a.play("stalk");
      await a.moveTo(toy.x, toy.z, { speed: toy.kind === "bolinha" ? a.runSpeed() : a.walkSpeed(), timeoutS: 6 });
      if (!this._alive(gen)) return;
      const tgt = V(toy.x, 0.04, toy.z);
      a.lookAt(tgt); a.play(i % 2 ? "attack" : "jump", { target: tgt }); pop(); this._vib(15);
      await this.wait(0.35); if (!this._alive(gen)) return;
      if (toy.kind === "bolinha") { const ang = Math.atan2(toy.x - a.position.x, toy.z - a.position.z) + (this._rng() - 0.5) * 1.4; toy.vx = Math.sin(ang) * 1.7; toy.vz = Math.cos(ang) * 1.7; }
      else { toy.x += (this._rng() - 0.5) * 0.3; toy.z += (this._rng() - 0.5) * 0.3; [toy.x, toy.z] = clampToRoom(toy.x, toy.z, 0.25); toy.mesh.position.set(toy.x, 0, toy.z); }
      await this.wait(0.9 + this._rng() * 0.6);
    }
    if (!this._alive(gen)) return;
    this._emit({ type: "brincou", toy: toy.kind }); this.hearts.spawn(this._head(), 2);
    a.lookAt(null); a.play("sit"); this._resumeBrainLater(6);
  },

  _disposeFx() {
    stopPurr(); this.hearts?.dispose();
    for (const t of this._toys || []) this.scene.remove(t.mesh);
    if (this._ghost) this.scene.remove(this._ghost);
  },
};
