// Sons do Pedro — 100% sintetizados com WebAudio (nada de samples, nada de jogos). O áudio só liga
// depois do primeiro gesto do usuário (política dos navegadores) e respeita o "mudo" da config.
let ctx = null, master = null, enabled = true, purr = null, noiseBuf = null;

export function setSoundEnabled(on) { enabled = !!on; if (!on) stopPurr(); if (master) master.gain.value = on ? 0.9 : 0; }

// chamar dentro de um handler de gesto (pointerdown/click)
export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
      ctx = new AC(); master = ctx.createGain(); master.gain.value = enabled ? 0.9 : 0; master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === "suspended") ctx.resume();
    return true;
  } catch { return false; }
}

const ok = () => enabled && ctx && ctx.state === "running";
function env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }

// miado curto: serra com glissando + filtro passa-banda (formante "ê-ou")
export function meow(kind = "oi") {
  if (!ok()) return;
  const t = ctx.currentTime, len = kind === "longo" ? 0.7 : 0.42, base = kind === "manhoso" ? 620 : 520;
  const o = ctx.createOscillator(); o.type = "sawtooth";
  o.frequency.setValueAtTime(base, t); o.frequency.linearRampToValueAtTime(base * 1.7, t + len * 0.35); o.frequency.linearRampToValueAtTime(base * 1.05, t + len);
  const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 5; f.frequency.setValueAtTime(900, t); f.frequency.linearRampToValueAtTime(1800, t + len * 0.4); f.frequency.linearRampToValueAtTime(1000, t + len);
  const g = ctx.createGain(); env(g, t, 0.05, 0.35, len);
  o.connect(f).connect(g).connect(master); o.start(t); o.stop(t + len + 0.1);
}

export function startPurr() {
  if (!ok() || purr) return;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 220;
  const am = ctx.createGain(); am.gain.value = 0.0;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 24; const lg = ctx.createGain(); lg.gain.value = 0.22; lfo.connect(lg).connect(am.gain);
  const out = ctx.createGain(); out.gain.value = 0.0001; out.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 0.5);
  src.connect(lp).connect(am).connect(out).connect(master); src.start(); lfo.start();
  purr = { src, lfo, out };
}
export function stopPurr() {
  if (!purr) return;
  const { src, lfo, out } = purr; purr = null;
  try { const t = ctx.currentTime; out.gain.cancelScheduledValues(t); out.gain.setValueAtTime(out.gain.value, t); out.gain.exponentialRampToValueAtTime(0.0001, t + 0.4); src.stop(t + 0.5); lfo.stop(t + 0.5); } catch {}
}

function noiseBurst(t, dur, freq, q, peak) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); env(g, t, 0.005, peak, dur); s.connect(f).connect(g).connect(master); s.start(t, Math.random() * 0.5, dur + 0.05);
}
export function chomp() { if (!ok()) return; const t = ctx.currentTime; for (let i = 0; i < 3; i++) noiseBurst(t + i * 0.16, 0.07, 2400 - i * 300, 2, 0.28); }
export function lap() { if (!ok()) return; const t = ctx.currentTime; for (let i = 0; i < 4; i++) { const o = ctx.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(380 + i * 40, t + i * 0.13); o.frequency.exponentialRampToValueAtTime(200, t + i * 0.13 + 0.08); const g = ctx.createGain(); env(g, t + i * 0.13, 0.01, 0.12, 0.08); o.connect(g).connect(master); o.start(t + i * 0.13); o.stop(t + i * 0.13 + 0.12); } }
export function pop() { if (!ok()) return; const t = ctx.currentTime, o = ctx.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(330, t); o.frequency.exponentialRampToValueAtTime(120, t + 0.09); const g = ctx.createGain(); env(g, t, 0.004, 0.3, 0.1); o.connect(g).connect(master); o.start(t); o.stop(t + 0.15); }
export function jingle() { if (!ok()) return; const t = ctx.currentTime; [880, 1318].forEach((fr, i) => { const o = ctx.createOscillator(); o.type = "triangle"; o.frequency.value = fr; const g = ctx.createGain(); env(g, t + i * 0.09, 0.01, 0.14, 0.22); o.connect(g).connect(master); o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.3); }); }
export function hiss() { if (!ok()) return; const t = ctx.currentTime; noiseBurst(t, 0.35, 5200, 0.8, 0.12); }

// chuva ambiente (ruído filtrado, bem baixinho) — só com áudio liberado e som ligado
let rain = null;
export function startRain() {
  if (!ok() || rain) return;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 900; const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 6500;
  const g = ctx.createGain(); g.gain.value = 0.0001; g.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 1.5);
  src.connect(hp).connect(lp).connect(g).connect(master); src.start(); rain = { src, g };
}
export function stopRain() {
  if (!rain) return; const { src, g } = rain; rain = null;
  try { const t = ctx.currentTime; g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8); src.stop(t + 1); } catch {}
}

export function vibrate(ms, on = true) { try { if (on && navigator.vibrate) navigator.vibrate(ms); } catch {} }
