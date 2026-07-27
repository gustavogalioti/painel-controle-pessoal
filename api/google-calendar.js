export const config = { runtime: "edge" };
import { neon } from "@neondatabase/serverless";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

async function ensureTable(sql) {
  await sql`CREATE TABLE IF NOT EXISTS google_auth (
    id INT PRIMARY KEY DEFAULT 1,
    access_token TEXT,
    refresh_token TEXT,
    expires_at BIGINT,
    updated_at TEXT
  )`;
}

async function getValidToken(sql) {
  const rows = await sql`SELECT * FROM google_auth WHERE id=1`;
  const row = rows[0];
  if (!row || !row.access_token) return null;

  // Still valid for at least another minute
  if (Date.now() < Number(row.expires_at) - 60000) return row.access_token;
  if (!row.refresh_token) return null;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: row.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) return null;

  const expiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  await sql`UPDATE google_auth SET access_token=${data.access_token}, expires_at=${expiresAt}, updated_at=${new Date().toISOString()} WHERE id=1`;
  return data.access_token;
}

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const sql = neon(process.env.DATABASE_URL);
    await ensureTable(sql);
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");

    if (action === "status") {
      const rows = await sql`SELECT refresh_token, updated_at FROM google_auth WHERE id=1`;
      const connected = !!(rows[0] && rows[0].refresh_token);
      return new Response(JSON.stringify({ connected, updated_at: rows[0]?.updated_at || null }), { headers: CORS });
    }

    if (action === "disconnect") {
      await sql`DELETE FROM google_auth WHERE id=1`;
      return new Response(JSON.stringify({ ok: true }), { headers: CORS });
    }

    const token = await getValidToken(sql);
    if (!token) {
      return new Response(JSON.stringify({ error: "not_connected" }), { status: 401, headers: CORS });
    }

    const GCAL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

    if (req.method === "GET") {
      const timeMin = searchParams.get("timeMin") || new Date(Date.now() - 30 * 86400000).toISOString();
      const timeMax = searchParams.get("timeMax") || new Date(Date.now() + 180 * 86400000).toISOString();
      const url = `${GCAL}?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime&maxResults=250`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      return new Response(JSON.stringify(d.items || []), { headers: CORS });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const r = await fetch(GCAL, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      return new Response(JSON.stringify(d), { headers: CORS });
    }

    if (req.method === "PUT") {
      const gid = searchParams.get("id");
      const body = await req.json();
      const r = await fetch(`${GCAL}/${encodeURIComponent(gid)}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      return new Response(JSON.stringify(d), { headers: CORS });
    }

    if (req.method === "DELETE") {
      const gid = searchParams.get("id");
      await fetch(`${GCAL}/${encodeURIComponent(gid)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      return new Response(JSON.stringify({ ok: true }), { headers: CORS });
    }

    return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
