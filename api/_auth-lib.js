// ─────────────────────────────────────────────────────────────────────────
// Autenticação de usuário único (o Gustavo) pro painel — sessão por cookie
// assinado (HMAC-SHA256 via Web Crypto, runtime edge, sem dependências).
//
// Arquivo com "_" no início do nome — não vira rota na Vercel, é só um
// módulo importado pelos handlers que precisam exigir sessão.
//
// AUTH_ENFORCE controla se a sessão é realmente EXIGIDA (ver requireSession):
// enquanto "0"/ausente, os handlers aceitam chamadas sem sessão (pro Gustavo
// testar o login sem ficar trancado fora); com "1", passam a exigir.
// ─────────────────────────────────────────────────────────────────────────

export const SESSION_COOKIE = "painel_session";
const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60; // 30 dias
const RATE_LIMIT_KEY_PREFIX = "auth_rl:";
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutos
const RATE_LIMIT_MAX_ATTEMPTS = 5;

export function authEnforced() {
  return process.env.AUTH_ENFORCE === "1";
}

// ---------- base64url (Edge runtime tem btoa/atob globais, como no navegador) ----------
function base64UrlEncode(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (str.length % 4)) % 4);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// Compara duas strings em tempo constante — nunca por igualdade direta (===),
// que pode vazar tempo proporcional ao prefixo em comum. Hashear primeiro
// normaliza o tamanho da comparação, independente do tamanho das entradas.
async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(str)));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function constantTimeEqual(a, b) {
  const [ha, hb] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

// Token = base64url(JSON do payload) + "." + base64url(HMAC-SHA256 do payload).
// Autocontido: não precisa de armazenamento no servidor pra verificar (nem
// sessão em banco, nem KV) — só o SESSION_SECRET.
async function signPayload(payloadObj, secret) {
  const payloadB64 = base64UrlEncode(JSON.stringify(payloadObj));
  const key = await hmacKey(secret);
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  const sigB64 = base64UrlEncode(new Uint8Array(sigBuf));
  return `${payloadB64}.${sigB64}`;
}

async function verifyToken(token, secret) {
  if (!token || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);
  if (!payloadB64 || !sigB64) return null;

  const key = await hmacKey(secret);
  const expectedSigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  const expectedSigB64 = base64UrlEncode(new Uint8Array(expectedSigBuf));
  // HMAC-SHA256 sempre produz a mesma quantidade de bytes — comparar char a
  // char sem early-exit aqui já é seguro (mesmo raciocínio do constantTimeEqual).
  if (sigB64.length !== expectedSigB64.length) return null;
  let diff = 0;
  for (let i = 0; i < sigB64.length; i++) diff |= sigB64.charCodeAt(i) ^ expectedSigB64.charCodeAt(i);
  if (diff !== 0) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(payloadB64));
    if (typeof payload.exp !== "number" || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function createSessionCookie(secret) {
  const token = await signPayload({ exp: Date.now() + SESSION_MAX_AGE_S * 1000 }, secret);
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_S}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function parseCookie(req, name) {
  const header = req.headers.get("cookie") || "";
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export async function hasValidSession(req) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return false;
  const token = parseCookie(req, SESSION_COOKIE);
  if (!token) return false;
  const payload = await verifyToken(token, secret);
  return !!payload;
}

// Gate principal usado pelos handlers chamados pelo navegador. Com AUTH_ENFORCE
// desligado, sempre devolve true (não trava nada) — é só isso que muda entre
// "testando" e "valendo de verdade".
export async function requireSession(req) {
  if (!authEnforced()) return true;
  return hasValidSession(req);
}

// ---------- limite de tentativas de login (5 falhas / 10 min / IP) ----------
export function getClientIp(req) {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

async function getKvJson(sql, key) {
  const rows = await sql`SELECT value FROM sync_kv WHERE key=${key}`;
  if (!rows[0]) return null;
  try { return JSON.parse(rows[0].value); } catch { return null; }
}

async function setKvJson(sql, key, obj) {
  const value = JSON.stringify(obj);
  const ts = new Date().toISOString();
  await sql`INSERT INTO sync_kv (key, value, updated_at) VALUES (${key}, ${value}, ${ts})
            ON CONFLICT (key) DO UPDATE SET value=${value}, updated_at=${ts}`;
}

// Devolve o estado ATUAL (sem incrementar) — usado pra decidir se bloqueia
// antes mesmo de checar a senha.
export async function checkRateLimit(sql, ip) {
  const key = RATE_LIMIT_KEY_PREFIX + ip;
  const state = await getKvJson(sql, key);
  if (!state || Date.now() - state.firstFailAt > RATE_LIMIT_WINDOW_MS) {
    return { blocked: false, count: 0 };
  }
  if (state.count >= RATE_LIMIT_MAX_ATTEMPTS) {
    const retryAfterSeconds = Math.ceil((state.firstFailAt + RATE_LIMIT_WINDOW_MS - Date.now()) / 1000);
    return { blocked: true, count: state.count, retryAfterSeconds: Math.max(1, retryAfterSeconds) };
  }
  return { blocked: false, count: state.count };
}

export async function recordFailedAttempt(sql, ip) {
  const key = RATE_LIMIT_KEY_PREFIX + ip;
  const state = await getKvJson(sql, key);
  const now = Date.now();
  if (!state || now - state.firstFailAt > RATE_LIMIT_WINDOW_MS) {
    await setKvJson(sql, key, { count: 1, firstFailAt: now });
    return 1;
  }
  const count = state.count + 1;
  await setKvJson(sql, key, { count, firstFailAt: state.firstFailAt });
  return count;
}

export async function clearRateLimit(sql, ip) {
  const key = RATE_LIMIT_KEY_PREFIX + ip;
  await setKvJson(sql, key, { count: 0, firstFailAt: 0 });
}

// ---------- state assinado pro fluxo OAuth (Google/Outlook) — CSRF ----------
// Autocontido como o cookie de sessão: não precisa guardar nada no servidor
// entre o redirect de ida e o de volta, só verificar a assinatura e a validade.
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutos é mais que suficiente pro fluxo de consentimento

export async function signOAuthState(secret, extra = "") {
  const token = await signPayload({ exp: Date.now() + OAUTH_STATE_MAX_AGE_MS }, secret);
  return extra ? `${extra}.${token}` : token;
}

// `extra` precisa vir SEM pontos (ex: "personal"/"corporate") — é usado como
// prefixo opcional antes do token assinado (ver outlook-auth.js/outlook-callback.js).
export async function verifyOAuthState(secret, state, hasExtraPrefix = false) {
  if (!state || !secret) return null;
  let token = state;
  let extra = null;
  if (hasExtraPrefix) {
    const firstDot = state.indexOf(".");
    if (firstDot < 0) return null;
    extra = state.slice(0, firstDot);
    token = state.slice(firstDot + 1);
  }
  const payload = await verifyToken(token, secret);
  if (!payload) return null;
  return { extra, payload };
}
