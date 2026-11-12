// PedroScene — canvas, câmera (3ª pessoa, baixa e próxima, damping), luzes pela hora real de
// São Paulo, loop com pausa em aba oculta, qualidade adaptativa e gestos. Zero React aqui.
import * as THREE from "three";
import { buildRoom } from "./world/RoomScene.js";
import { ROOM, POIS, clampToRoom } from "./world/pois.js";
import { PedroActor } from "./actor/PedroActor.js";
import { pickNext, mulberry32 } from "./behavior/brain.js";
import { lightingFor, saoPauloHour } from "./time.js";
import { interactionMethods } from "./interaction.js";
import { meow, chomp, lap } from "./audio.js";

const WIN_TARGET = new THREE.Vector3(-0.2, 1.3, -ROOM.d / 2);
// níveis de qualidade (0 = máximo). O gato é gerado/baked em `medium`; os níveis mexem no resto.
const LEVELS = [
  { pr: 2, shadow: 2048, shadows: true,  fps: 60, lod: 0 },
  { pr: 1.5, shadow: 1024, shadows: true, fps: 60, lod: 0 },
  { pr: 1, shadow: 1024, shadows: true,  fps: 60, lod: 1 },
  { pr: 1, shadow: 512,  shadows: false, fps: 30, lod: 1 },
];

export class PedroScene {
  constructor({ canvas, onFrame, onStatus, hourOverride = null, debug = false, forceLevel = null, initial = null }) {
    this.initial = initial; // { poi, tipo, ate }: onde o servidor diz que o Pedro está e o que ele faz agora
    this.canvas = canvas; this.onFrame = onFrame; this.onStatus = onStatus; this.hourOverride = hourOverride; this.debug = debug;
    this.reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
    this.level = forceLevel != null ? Math.min(LEVELS.length - 1, Math.max(0, forceLevel)) : this.coarse ? 1 : 0;
    this.lockLevel = forceLevel != null; // debug: não deixa a qualidade adaptativa mexer
    this._gen = 0; this._waiters = []; this._running = false; this._disposed = false;
    this._inset = 0; this._insetTarget = 0; this._orbit = 0; this._zoom = 1; this._look = new THREE.Vector3(); this._camInit = false;
    this._rng = mulberry32((Date.now() / 1000) | 0);
    this._ptrs = new Map(); this._fpsAcc = 0; this._fpsN = 0; this._lastRender = 0; this._lightT = 99;
    this.fps = 0;
    this.needs = null; this.onPetEvent = null; this._outfitId = null; // Fase 3: necessidades (comportamento) e eventos de cuidado
  }

  async init({ onProgress } = {}) {
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: "high-performance" });
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); this.stop(); this.onStatus?.({ error: "webgl-perdido" }); });

    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x222222);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 40);

    this.room = buildRoom(); scene.add(this.room);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x886644, 1); scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2); this.sun.castShadow = true; scene.add(this.sun, this.sun.target);
    const sc = this.sun.shadow.camera; sc.left = -3; sc.right = 3; sc.top = 3; sc.bottom = -3; sc.near = 0.5; sc.far = 14; this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.02;
    this._applyLevel(); this._applyLighting(true);
    this._initFx();

    const ini = this.initial && POIS[this.initial.poi] ? POIS[this.initial.poi] : null;
    this.actor = await PedroActor.create({ parent: scene, onProgress, ...(ini ? { position: new THREE.Vector3(ini.x, 0, ini.z), heading: ini.heading } : {}) });
    this._applyLevel(); this._applyOutfit();
    this._bindInput();
    this.resize();
    this._look.copy(this.actor.position).add(new THREE.Vector3(0, 0.26, 0));
    this._visHandler = () => { if (document.hidden) this.stop(); else this.start(); };
    document.addEventListener("visibilitychange", this._visHandler);
    this.onStatus?.({ ready: true, source: this.actor.source, stats: this.actor.stats });
  }

  // ---------- ciclo ----------
  start() {
    if (this._running || this._disposed || !this.renderer || document.hidden) return;
    this._running = true; this._last = performance.now(); this._fpsAcc = 0; this._fpsN = 0; this._fpsT = this._last;
    this.renderer.setAnimationLoop((now) => this._frame(now));
    if (!this._brainOn) { this._brainOn = true; this._brainLoop(this._gen); }
  }
  stop() { this._running = false; this.renderer?.setAnimationLoop(null); }

  _frame(now) {
    const lv = LEVELS[this.level];
    if (lv.fps < 60 && now - this._lastRender < 1000 / lv.fps - 2) return;
    this._lastRender = now;
    const dt = Math.min(0.1, (now - this._last) / 1000); this._last = now;
    this._tickWaiters(dt);
    this.actor.update(dt);
    this._updateFx(dt);
    this._updateCamera(dt);
    this._lightT += dt; if (this._lightT > 30) this._applyLighting(false);
    this.renderer.render(this.scene, this.camera);
    this.onFrame?.(this);
    // medição de FPS -> qualidade adaptativa
    this._fpsAcc += dt; this._fpsN++;
    if (now - this._fpsT > 3000) {
      this.fps = this._fpsN / this._fpsAcc; this._fpsAcc = 0; this._fpsN = 0; this._fpsT = now;
      if (!this._warm) this._warm = 1; else if (!this.lockLevel && this.fps < (LEVELS[this.level].fps === 30 ? 24 : 27) && this.level < LEVELS.length - 1) { this.level++; this._applyLevel(); this.onStatus?.({ level: this.level, fps: this.fps }); }
      else this.onStatus?.({ fps: this.fps });
    }
  }

  _applyLevel() {
    const lv = LEVELS[this.level], r = this.renderer; if (!r) return;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, lv.pr));
    r.shadowMap.enabled = lv.shadows;
    if (this.sun) { this.sun.castShadow = lv.shadows; this.sun.shadow.mapSize.set(lv.shadow, lv.shadow); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; }
    if (this.actor) { this.actor.setLod(lv.lod); if (this.level >= 2) this.actor.setQuality("low"); }
    this.scene?.traverse((o) => { if (o.material && !Array.isArray(o.material)) o.material.needsUpdate = true; });
    if (this.canvas.clientWidth) this.resize();
  }

  _hour() { return this.hourOverride ?? saoPauloHour(new Date()); }

  _applyLighting() {
    this._lightT = 0;
    const L = lightingFor(this._hour());
    this.scene.background.setHex(L.sky);
    this.room.userData.outside.material.color.setHex(L.sky).multiplyScalar(0.82);
    const luma = (((L.sky >> 16) & 255) + ((L.sky >> 8) & 255) + (L.sky & 255)) / 3;
    this.room.userData.treeMat.color.setHex(0x5f8f4e).multiplyScalar(0.2 + 0.8 * Math.min(1, luma / 170));
    this.hemi.color.setHex(L.hemiSky); this.hemi.groundColor.setHex(L.hemiGround); this.hemi.intensity = L.hemiIntensity;
    // sol entra pela janela dos fundos: azimute -90..90 (esq/dir), elevação em graus
    const az = THREE.MathUtils.degToRad(L.sunAzimuth), el = THREE.MathUtils.degToRad(Math.max(6, L.sunElevation));
    const dist = 9;
    this.sun.position.set(Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, -Math.cos(az) * Math.cos(el) * dist);
    this.sun.target.position.set(0, 0, 0);
    this.sun.color.setHex(L.sun); this.sun.intensity = L.sunIntensity; this.sun.visible = L.sunIntensity > 0.02;
    this.renderer.toneMappingExposure = L.exposure;
    this.room.userData.lampLight.intensity = L.lamp * 11;
    this.room.userData.lampShade.material.emissiveIntensity = L.lamp * 1.4;
    this.room.userData.lampLight.visible = L.lamp > 0.03;
  }

  resize() {
    const r = this.renderer; if (!r) return;
    const w = this.canvas.clientWidth || 360, h = this.canvas.clientHeight || 640;
    r.setSize(w, h, false);
    this.camera.aspect = w / h;
    // retrato: abre o FOV vertical pra caber a cena
    this.camera.fov = w / h < 0.8 ? 58 : 48;
    this._w = w; this._h = h; this._updateViewOffset();
  }
  // espaço (px) ocupado pelo chat embaixo — a cena "sobe" pra o Pedro ficar visível acima dele
  setInset(px) { this._insetTarget = Math.max(0, px || 0); if (this.reduced) this._inset = this._insetTarget; }
  _updateViewOffset() {
    const cam = this.camera;
    if (this._inset > 0.5) cam.setViewOffset(this._w, this._h, 0, this._inset * 0.5, this._w, this._h);
    else cam.clearViewOffset();
    cam.updateProjectionMatrix();
  }

  _updateCamera(dt) {
    const k = 1 - Math.exp(-dt * (this.reduced ? 8 : 3));
    const target = this.actor.position.clone(); target.y += 0.26;
    [target.x, target.z] = clampToRoom(target.x, target.z, 0.05);
    this._look.lerp(target, k);
    const dist = 1.2 * this._zoom * this._zb;
    const x = this._look.x + Math.sin(this._orbit) * dist, z = this._look.z + Math.cos(this._orbit) * dist;
    this.camera.position.set(Math.min(ROOM.w / 2 - 0.2, Math.max(-ROOM.w / 2 + 0.2, x)), 0.42 + 0.1 * this._zoom, Math.min(ROOM.d / 2 + 1.1, z));
    this.camera.lookAt(this._look);
    if (Math.abs(this._inset - this._insetTarget) > 0.5) { this._inset += (this._insetTarget - this._inset) * k; this._updateViewOffset(); }
  }

  // posição do topo da cabeça na tela (px dentro do canvas) — pro balão de fala
  headScreen() {
    const v = this.actor.position.clone(); v.y += this.actor.posture === "sleep" || this.actor.posture === "lie" ? 0.3 : 0.5;
    v.project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this._w, y: (-v.y * 0.5 + 0.5) * this._h - (this._inset > 0 ? 0 : 0), visible: v.z < 1 };
  }

  // ---------- comportamento ----------
  _tickWaiters(dt) {
    for (let i = this._waiters.length - 1; i >= 0; i--) { const w = this._waiters[i]; w.t -= dt; if (w.t <= 0) { this._waiters.splice(i, 1); w.res(true); } }
  }
  wait(s) { return new Promise((res) => this._waiters.push({ t: s, res })); }
  _interrupt() { this._gen++; const ws = this._waiters.splice(0); ws.forEach((w) => w.res(false)); this.actor.cancelMove(); this.actor.stopAction(); this.actor.lookAt(null); }

  async _brainLoop(gen) {
    let last = null;
    await this.wait(1.5);
    while (!this._disposed && gen === this._gen) {
      let next;
      if (this.initial) { // 1ª atividade = a que o servidor diz que ele está fazendo agora (consistência ao abrir o app)
        const i = this.initial; this.initial = null;
        const restanteMin = Math.max(0, (Date.parse(i.ate) - Date.now()) / 60000);
        next = POIS[i.poi] && ["dormir", "descansar_janela", "esconder", "limpar", "amassar", "sentar", "comer", "beber", "brincar", "explorar", "arranhar"].includes(i.tipo)
          ? { poi: i.poi, ativ: i.tipo, duracao: Math.min(70, Math.max(12, restanteMin * 0.7)) } : null;
      }
      if (!next) next = pickNext({ hour: this._hour(), last, rng: this._rng, needs: this.needs });
      last = next;
      try { await this._doActivity(next, gen); } catch (e) { console.warn("Pedro brain:", e); await this.wait(2); }
    }
    this._brainOn = gen !== this._gen ? this._brainOn : false;
  }

  _alive(gen) { return !this._disposed && gen === this._gen; }

  // manual = veio de um toque do Gustavo (rende biscoito); senão é o Pedro fazendo por conta própria (auto).
  async _doActivity({ poi: poiId, ativ, duracao }, gen, manual = false, kind = "comida") {
    const poi = POIS[poiId], a = this.actor;
    const ok = await a.moveTo(poi.x, poi.z, { speed: ativ === "brincar" ? a.runSpeed() : a.walkSpeed() });
    if (!this._alive(gen) || ok === "cancelled") return;
    a.face(poi.heading); await this.wait(0.6); if (!this._alive(gen)) return;
    const hold = async (s) => { await this.wait(s); };
    const idleBlinks = async (total) => { let t = 0; while (t < total && this._alive(gen)) { const s = 5 + this._rng() * 6; await this.wait(Math.min(s, total - t)); t += s; if (this._alive(gen) && t < total) a.play("slowblink"); } };
    switch (ativ) {
      case "dormir": a.play("sleep", { side: this._rng() > 0.5 ? 1 : -1 }); await hold(duracao); break;
      case "esconder": a.play("loaf"); await hold(duracao); break;
      case "descansar_janela": a.play("sit"); a.lookAt(WIN_TARGET); await idleBlinks(duracao); a.lookAt(null); break;
      case "comer": a.play("eat", { duration: duracao }); this._loopSound(chomp, 1.2, duracao, gen); await hold(duracao + 1); break;
      case "beber": a.play("drink", { duration: duracao }); this._loopSound(lap, 1.3, duracao, gen); await hold(duracao + 1); break;
      case "limpar": a.play("groom"); await hold(duracao); break;
      case "amassar": a.play("knead"); await hold(duracao); break;
      case "arranhar": for (let i = 0; i < 3 && this._alive(gen); i++) { a.play("attack", { target: new THREE.Vector3(poi.x + 0.28, 0.4, poi.z) }); await hold(1.6); } break;
      case "brincar": {
        for (let i = 0; i < 3 && this._alive(gen); i++) {
          const [tx, tz] = clampToRoom((this._rng() - 0.5) * 2.2, (this._rng() - 0.5) * 2.2, 0.4);
          a.play("stalk"); await a.moveTo(tx, tz, { speed: a.runSpeed(), timeoutS: 8 }); if (!this._alive(gen)) return;
          a.play("jump", { target: new THREE.Vector3(tx + 0.2, 0, tz) }); await hold(1.2);
        }
        break;
      }
      default: a.play("sit"); await idleBlinks(duracao);
    }
    if (this._alive(gen)) {
      a.stopAction();
      // necessidades atendidas pelo próprio Pedro (ou por um toque) viram eventos de cuidado
      const ev = { comer: { type: "refeicao", kind }, beber: { type: "bebeu" }, dormir: duracao >= 20 ? { type: "dormiu" } : null, limpar: { type: "limpou" }, brincar: { type: "brincou", toy: "zoomies" } }[ativ];
      if (ev) this._emit({ ...ev, auto: !manual });
      if (ativ === "comer" || ativ === "beber") this.hearts.spawn(this._head(), 1);
    }
  }

  async _loopSound(fn, every, total, gen) { fn(); for (let t = every; t < total && this._alive(gen); t += every) { await this.wait(every); if (this._alive(gen)) fn(); } }

  // ---------- interações (Fase 2: olhar, "oi" e vir quando chamado; o resto é da Fase 3) ----------
  _resumeBrainLater(s) { const gen = ++this._gen; this.wait(s).then((ok) => { if (ok && gen === this._gen && !this._disposed) { this._brainOn = true; this._brainLoop(gen); } }); }

  // Chamado pelo nome no chat: vira a cabeça, vem andando até a câmera e fica olhando/piscando.
  async callPedro() {
    this._interrupt(); const gen = this._gen; this._brainOn = false;
    await this.actor.comeToCamera(this.camera, { run: false });
    if (!this._alive(gen)) return;
    this.actor.play("sit"); this.actor.lookAt(this.camera.position); meow("oi");
    await this.wait(1.2); if (!this._alive(gen)) return;
    this.actor.play("slowblink");
    this._resumeBrainLater(14);
  }

  // Toque no Pedro: "Oi!" — olha pra você e pisca devagar.
  async sayHi() {
    this._interrupt(); const gen = this._gen; this._brainOn = false;
    this.actor.lookAt(this.camera.position); this.actor.faceToward(this.camera.position);
    await this.wait(0.5); if (!this._alive(gen)) return;
    meow(this.needs && Math.min(this.needs.fome, this.needs.afeto) < 35 ? "manhoso" : "oi"); this._vib(15);
    this.actor.play("slowblink");
    this._resumeBrainLater(6);
  }

  // Toque no chão: ele olha e, se for perto, vem.
  async attention(point) {
    this._interrupt(); const gen = this._gen; this._brainOn = false;
    const p = new THREE.Vector3(point.x, 0.05, point.z);
    this.actor.lookAt(p);
    const near = this.actor.position.distanceTo(p) < 1.6;
    if (near) { await this.actor.moveTo(p.x, p.z, { timeoutS: 8 }); if (!this._alive(gen)) return; this.actor.lookAt(this.camera.position); }
    this._resumeBrainLater(near ? 8 : 4);
  }

  dispose() {
    this._disposed = true; this._gen++; this.stop();
    document.removeEventListener("visibilitychange", this._visHandler);
    this._unbind?.(); this._disposeFx(); this._waiters.splice(0).forEach((w) => w.res(false));
    this.actor?.dispose();
    this.scene?.traverse((o) => { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach((x) => { x.map?.dispose?.(); x.dispose?.(); }); });
    this.renderer?.dispose();
  }
}

Object.assign(PedroScene.prototype, interactionMethods);
