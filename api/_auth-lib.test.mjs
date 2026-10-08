import assert from "node:assert/strict";
import * as A from "./_auth-lib.js";

const SECRET = "test-secret-nao-usar-em-producao";
const req = (cookieValue) => ({ headers: { get: (name) => (name === "cookie" ? cookieValue : null) } });

function b64urlEncode(bytesOrStr) {
  const bytes = typeof bytesOrStr === "string" ? new TextEncoder().encode(bytesOrStr) : bytesOrStr;
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Replica a assinatura de _auth-lib.js (mesmo formato de token) só pra montar
// casos de teste (ex: token já expirado) que as funções exportadas não geram.
async function signTestToken(payloadObj, secret) {
  const payloadB64 = b64urlEncode(JSON.stringify(payloadObj));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  const sigB64 = b64urlEncode(new Uint8Array(sigBuf));
  return `${payloadB64}.${sigB64}`;
}

function makeMockSql() {
  const store = new Map();
  const sql = (strings, ...values) => {
    const text = strings.join(" ");
    if (text.includes("SELECT value FROM sync_kv")) {
      const key = values[0];
      return Promise.resolve(store.has(key) ? [{ value: store.get(key) }] : []);
    }
    if (text.includes("INSERT INTO sync_kv")) {
      const [key, value] = values;
      store.set(key, value);
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  };
  return { sql, store };
}

// ---------- cookie: válido ----------
{
  const cookie = await A.createSessionCookie(SECRET);
  const token = cookie.match(/painel_session=([^;]+)/)[1];
  assert.equal(await A.hasValidSession(req(`painel_session=${token}`)), false, "sem SESSION_SECRET configurado, deve negar");

  process.env.SESSION_SECRET = SECRET;
  assert.equal(await A.hasValidSession(req(`painel_session=${token}`)), true, "cookie recém-criado deve validar");
  delete process.env.SESSION_SECRET;
}

// ---------- cookie: adulterado ----------
{
  process.env.SESSION_SECRET = SECRET;
  const cookie = await A.createSessionCookie(SECRET);
  const token = cookie.match(/painel_session=([^;]+)/)[1];
  const tampered = token.slice(0, -1) + (token.slice(-1) === "A" ? "B" : "A");
  assert.equal(await A.hasValidSession(req(`painel_session=${tampered}`)), false, "assinatura adulterada deve ser rejeitada");
  delete process.env.SESSION_SECRET;
}

// ---------- cookie: expirado ----------
{
  process.env.SESSION_SECRET = SECRET;
  const expiredToken = await signTestToken({ exp: Date.now() - 1000 }, SECRET);
  assert.equal(await A.hasValidSession(req(`painel_session=${expiredToken}`)), false, "token com exp no passado deve ser rejeitado");
  delete process.env.SESSION_SECRET;
}

// ---------- cookie: secret errado ----------
{
  process.env.SESSION_SECRET = SECRET;
  const cookie = await A.createSessionCookie("outro-secret-completamente-diferente");
  const token = cookie.match(/painel_session=([^;]+)/)[1];
  assert.equal(await A.hasValidSession(req(`painel_session=${token}`)), false, "assinado com secret diferente deve ser rejeitado");
  delete process.env.SESSION_SECRET;
}

// ---------- constantTimeEqual ----------
{
  assert.equal(await A.constantTimeEqual("abc123", "abc123"), true);
  assert.equal(await A.constantTimeEqual("abc123", "abc124"), false);
  assert.equal(await A.constantTimeEqual("abc", "abcdef"), false);
  assert.equal(await A.constantTimeEqual("", ""), true);
}

// ---------- rate limit ----------
{
  const { sql } = makeMockSql();
  const ip = "1.2.3.4";
  let rl = await A.checkRateLimit(sql, ip);
  assert.equal(rl.blocked, false);

  for (let i = 0; i < 4; i++) await A.recordFailedAttempt(sql, ip);
  rl = await A.checkRateLimit(sql, ip);
  assert.equal(rl.blocked, false, "4 falhas ainda não bloqueia (limite é 5)");

  await A.recordFailedAttempt(sql, ip);
  rl = await A.checkRateLimit(sql, ip);
  assert.equal(rl.blocked, true, "5ª falha deve bloquear");
  assert.ok(rl.retryAfterSeconds > 0);

  await A.clearRateLimit(sql, ip);
  rl = await A.checkRateLimit(sql, ip);
  assert.equal(rl.blocked, false, "clearRateLimit deve destravar");
}

// ---------- requireSession respeita AUTH_ENFORCE ----------
{
  delete process.env.AUTH_ENFORCE;
  assert.equal(A.authEnforced(), false);
  assert.equal(await A.requireSession(req("")), true, "sem AUTH_ENFORCE, passa mesmo sem sessão");

  process.env.AUTH_ENFORCE = "1";
  assert.equal(A.authEnforced(), true);
  assert.equal(await A.requireSession(req("")), false, "com AUTH_ENFORCE=1 e sem cookie, nega");

  process.env.SESSION_SECRET = SECRET;
  const cookie = await A.createSessionCookie(SECRET);
  const token = cookie.match(/painel_session=([^;]+)/)[1];
  assert.equal(await A.requireSession(req(`painel_session=${token}`)), true, "com AUTH_ENFORCE=1 e cookie válido, aceita");

  delete process.env.AUTH_ENFORCE;
  delete process.env.SESSION_SECRET;
}

// ---------- OAuth state (CSRF) ----------
{
  const state = await A.signOAuthState(SECRET);
  const verified = await A.verifyOAuthState(SECRET, state, false);
  assert.ok(verified, "state assinado deve verificar");

  const stateWithExtra = await A.signOAuthState(SECRET, "corporate");
  const verifiedExtra = await A.verifyOAuthState(SECRET, stateWithExtra, true);
  assert.equal(verifiedExtra.extra, "corporate", "prefixo 'extra' (conta) deve ser recuperado");

  const tamperedState = state.slice(0, -1) + (state.slice(-1) === "A" ? "B" : "A");
  assert.equal(await A.verifyOAuthState(SECRET, tamperedState, false), null, "state adulterado deve falhar");

  assert.equal(await A.verifyOAuthState("secret-errado", state, false), null, "state verificado com secret errado deve falhar");
}

console.log("_auth-lib.test.mjs: todos os testes passaram");
