export const config = { runtime: "edge" };
import { neon } from "@neondatabase/serverless";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

export async function ensureTable(sql) {
  await sql`CREATE TABLE IF NOT EXISTS outlook_auth (
    account TEXT PRIMARY KEY,
    access_token TEXT,
    refresh_token TEXT,
    expires_at BIGINT,
    updated_at TEXT
  )`;
}

export async function getValidToken(sql, account) {
  const rows = await sql`SELECT * FROM outlook_auth WHERE account=${account}`;
  const row = rows[0];
  if (!row || !row.access_token) return null;

  // Still valid for at least another minute
  if (Date.now() < Number(row.expires_at) - 60000) return row.access_token;
  if (!row.refresh_token) return null;

  const res = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.OUTLOOK_CLIENT_ID,
      client_secret: process.env.OUTLOOK_CLIENT_SECRET,
      refresh_token: row.refresh_token,
      grant_type: "refresh_token",
      scope: "offline_access User.Read Calendars.ReadWrite Mail.Read",
    }),
  });
  const data = await res.json();
  if (!data.access_token) {
    await sql`DELETE FROM outlook_auth WHERE account=${account}`;
    return null;
  }

  const expiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  const newRefresh = data.refresh_token || row.refresh_token;
  await sql`UPDATE outlook_auth SET access_token=${data.access_token}, refresh_token=${newRefresh}, expires_at=${expiresAt}, updated_at=${new Date().toISOString()} WHERE account=${account}`;
  return data.access_token;
}

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const sql = neon(process.env.DATABASE_URL);
    await ensureTable(sql);
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");
    const account = searchParams.get("account") === "corporate" ? "corporate" : "personal";

    if (action === "status") {
      const token = await getValidToken(sql, account);
      return new Response(JSON.stringify({ connected: !!token }), { headers: CORS });
    }

    if (action === "disconnect") {
      await sql`DELETE FROM outlook_auth WHERE account=${account}`;
      return new Response(JSON.stringify({ ok: true }), { headers: CORS });
    }

    const token = await getValidToken(sql, account);
    if (!token) {
      return new Response(JSON.stringify({ error: "not_connected" }), { status: 401, headers: CORS });
    }

    const MGRAPH_EVENTS = "https://graph.microsoft.com/v1.0/me/events";

    if (req.method === "GET") {
      const timeMin = searchParams.get("timeMin") || new Date(Date.now() - 30 * 86400000).toISOString();
      const timeMax = searchParams.get("timeMax") || new Date(Date.now() + 180 * 86400000).toISOString();
      const url = `https://graph.microsoft.com/v1.0/me/calendarview?startDateTime=${encodeURIComponent(timeMin)}&endDateTime=${encodeURIComponent(timeMax)}&$orderby=start/dateTime&$top=250`;
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="America/Sao_Paulo"' },
      });
      if (!r.ok) {
        const detail = await r.text();
        return new Response(JSON.stringify({ error: "outlook_api_error", status: r.status, detail }), { status: 502, headers: CORS });
      }
      const d = await r.json();
      return new Response(JSON.stringify(d.value || []), { headers: CORS });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const r = await fetch(MGRAPH_EVENTS, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) return new Response(JSON.stringify({ error: "outlook_api_error", status: r.status, detail: d }), { status: 502, headers: CORS });
      return new Response(JSON.stringify(d), { headers: CORS });
    }

    if (req.method === "PUT") {
      const oid = searchParams.get("id");
      const body = await req.json();
      // Microsoft Graph uses PATCH for partial updates on events
      const r = await fetch(`${MGRAPH_EVENTS}/${encodeURIComponent(oid)}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) return new Response(JSON.stringify({ error: "outlook_api_error", status: r.status, detail: d }), { status: 502, headers: CORS });
      return new Response(JSON.stringify(d), { headers: CORS });
    }

    if (req.method === "DELETE") {
      const oid = searchParams.get("id");
      const r = await fetch(`${MGRAPH_EVENTS}/${encodeURIComponent(oid)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok && r.status !== 404) {
        const detail = await r.text();
        return new Response(JSON.stringify({ error: "outlook_api_error", status: r.status, detail }), { status: 502, headers: CORS });
      }
      return new Response(JSON.stringify({ ok: true }), { headers: CORS });
    }

    return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
