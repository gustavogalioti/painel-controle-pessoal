export const config = { runtime: "edge" };
import { neon } from "@neondatabase/serverless";
import {
  hasValidSession, createSessionCookie, clearSessionCookie,
  constantTimeEqual, getClientIp, checkRateLimit, recordFailedAttempt, clearRateLimit,
} from "./_auth-lib.js";

// ─────────────────────────────────────────────────────────────────────────
// Login de usuário único (o Gustavo) pro painel.
//   GET    /api/auth  -> { authenticated: bool }
//   POST   /api/auth  { password } -> 200 + cookie de sessão, ou 401/429
//   DELETE /api/auth  -> encerra a sessão (apaga o cookie)
//
// Mesma origem do painel, então sem Access-Control-Allow-Origin liberado —
// só o próprio painel (navegador) chama isso.
// ─────────────────────────────────────────────────────────────────────────

const CORS = { "Content-Type": "application/json" };

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, ...extraHeaders } });
}

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  if (req.method === "GET") {
    const authenticated = await hasValidSession(req);
    return json({ authenticated });
  }

  if (req.method === "DELETE") {
    return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
  }

  if (req.method === "POST") {
    if (!process.env.PAINEL_PASSWORD || !process.env.SESSION_SECRET) {
      return json({ error: "auth_not_configured" }, 500);
    }

    const sql = neon(process.env.DATABASE_URL);
    const ip = getClientIp(req);

    const rl = await checkRateLimit(sql, ip);
    if (rl.blocked) {
      return json({ error: "too_many_attempts", retryAfterSeconds: rl.retryAfterSeconds }, 429);
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    const password = typeof body?.password === "string" ? body.password : "";

    const valid = password.length > 0 && (await constantTimeEqual(password, process.env.PAINEL_PASSWORD));
    if (!valid) {
      const count = await recordFailedAttempt(sql, ip);
      // Atraso crescente, capado em 3s — não trava o edge indefinidamente, só desacelera.
      const delayMs = Math.min(count * 300, 3000);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return json({ error: "invalid_password" }, 401);
    }

    await clearRateLimit(sql, ip);
    const cookie = await createSessionCookie(process.env.SESSION_SECRET);
    return json({ ok: true }, 200, { "Set-Cookie": cookie });
  }

  return json({ error: "method_not_allowed" }, 405);
}
