// Hora do dia (America/Sao_Paulo) -> parâmetros de luz da sala. Funções puras.
export function saoPauloHour(date = new Date()) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  const g = (t) => parseInt(p.find((x) => x.type === t)?.value || "0", 10);
  return (g("hour") % 24) + g("minute") / 60;
}

// hora, céu, sol (cor/intensidade/elevação°/azimute°), hemisfério (céu/chão/intensidade), abajur 0..1, exposição
const KEYS = [
  { h: 0,    sky: 0x0d1530, sun: 0x6f86c9, si: 0.0,  el: 20, az: -35, hs: 0x2a3566, hg: 0x15121c, hi: 0.55, lamp: 1,   ex: 0.95 },
  { h: 5,    sky: 0x1a2447, sun: 0x8a96d0, si: 0.0,  el: 8,  az: -50, hs: 0x34406e, hg: 0x1c1720, hi: 0.6,  lamp: 0.9, ex: 0.95 },
  { h: 6.5,  sky: 0xf4b987, sun: 0xffb36b, si: 1.5,  el: 9,  az: -55, hs: 0xffd2a6, hg: 0x8a6b4a, hi: 0.8,  lamp: 0.3, ex: 1.0 },
  { h: 9,    sky: 0xbfe0ff, sun: 0xffdca0, si: 2.6,  el: 32, az: -42, hs: 0xfff0d8, hg: 0x9a7b56, hi: 1.05, lamp: 0,   ex: 1.0 },
  { h: 13,   sky: 0xcfe8ff, sun: 0xfff1d6, si: 3.0,  el: 52, az: -15, hs: 0xfff6e8, hg: 0xa38460, hi: 1.15, lamp: 0,   ex: 1.0 },
  { h: 16.5, sky: 0xf8d9a8, sun: 0xffc27a, si: 2.7,  el: 28, az: 35,  hs: 0xffe3bf, hg: 0x98764f, hi: 1.0,  lamp: 0.05, ex: 1.0 },
  { h: 18.5, sky: 0xf29a6b, sun: 0xff8f4a, si: 1.9,  el: 9,  az: 52,  hs: 0xffc592, hg: 0x7d5a46, hi: 0.8,  lamp: 0.5, ex: 1.0 },
  { h: 20,   sky: 0x3a3f7a, sun: 0x8a8fd0, si: 0.0,  el: 8,  az: 55,  hs: 0x56609a, hg: 0x2b2230, hi: 0.65, lamp: 0.9, ex: 0.97 },
  { h: 22,   sky: 0x141b3d, sun: 0x7088cc, si: 0.0,  el: 15, az: 20,  hs: 0x2d3868, hg: 0x17131d, hi: 0.55, lamp: 1,   ex: 0.95 },
  { h: 24,   sky: 0x0d1530, sun: 0x6f86c9, si: 0.0,  el: 20, az: -35, hs: 0x2a3566, hg: 0x15121c, hi: 0.55, lamp: 1,   ex: 0.95 },
];

const lerp = (a, b, t) => a + (b - a) * t;
function lerpHex(a, b, t) {
  const c = (x, s) => (x >> s) & 255;
  const ch = (s) => Math.round(lerp(c(a, s), c(b, s), t));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

export function lightingFor(hour) {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && h >= KEYS[i + 1].h) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = Math.min(1, Math.max(0, (h - a.h) / (b.h - a.h)));
  return {
    hour: h,
    sky: lerpHex(a.sky, b.sky, t), sun: lerpHex(a.sun, b.sun, t), sunIntensity: lerp(a.si, b.si, t),
    sunElevation: lerp(a.el, b.el, t), sunAzimuth: lerp(a.az, b.az, t),
    hemiSky: lerpHex(a.hs, b.hs, t), hemiGround: lerpHex(a.hg, b.hg, t), hemiIntensity: lerp(a.hi, b.hi, t),
    lamp: lerp(a.lamp, b.lamp, t), exposure: lerp(a.ex, b.ex, t),
  };
}
