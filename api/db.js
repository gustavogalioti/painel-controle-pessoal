// ─── Database API — Neon Postgres ─────────────────────────────────────────────
// All CRUD operations for the painel go through here

import { neon } from "@neondatabase/serverless";

export const config = { runtime: "edge" };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const TABLES = `
  CREATE TABLE IF NOT EXISTS diary (
    id BIGINT PRIMARY KEY, text TEXT NOT NULL,
    mood VARCHAR(10) DEFAULT '🙂', date TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS ideas (
    id BIGINT PRIMARY KEY, text TEXT NOT NULL,
    mood VARCHAR(10) DEFAULT '🙂', date TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS reminders (
    id BIGINT PRIMARY KEY, text TEXT NOT NULL,
    mood VARCHAR(10) DEFAULT '🙂', date TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id BIGINT PRIMARY KEY, text TEXT NOT NULL,
    prio VARCHAR(20) DEFAULT 'normal',
    done BOOLEAN DEFAULT FALSE, date TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS bills (
    id BIGINT PRIMARY KEY, name TEXT NOT NULL,
    value NUMERIC DEFAULT 0, due_day INT,
    cat VARCHAR(50), recurrent BOOLEAN DEFAULT TRUE, paid BOOLEAN DEFAULT FALSE
  );
  CREATE TABLE IF NOT EXISTS events (
    id BIGINT PRIMARY KEY, title TEXT NOT NULL,
    date TEXT, time TEXT DEFAULT '', local TEXT DEFAULT '',
    cat VARCHAR(50), notes TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS curiosities (
    id BIGINT PRIMARY KEY, title TEXT NOT NULL,
    content TEXT DEFAULT '', link TEXT DEFAULT '',
    image_url TEXT DEFAULT '', tag TEXT DEFAULT '',
    updates JSONB DEFAULT '[]', created TEXT
  );
  CREATE TABLE IF NOT EXISTS documents (
    id BIGINT PRIMARY KEY, name TEXT NOT NULL,
    cat VARCHAR(50) DEFAULT 'Pessoal', tags JSONB DEFAULT '[]',
    notes TEXT DEFAULT '', file_data TEXT DEFAULT '',
    file_name TEXT DEFAULT '', file_size INT DEFAULT 0,
    file_type TEXT DEFAULT '', date TEXT
  );
`;

const VALID_TABLES = ["diary","ideas","reminders","tasks","bills","events","curiosities","documents"];

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const sql = neon(process.env.DATABASE_URL);

    // Init tables on every cold start (idempotent)
    await sql.transaction([sql(TABLES)]);

    const { searchParams } = new URL(req.url);
    const table  = searchParams.get("table");
    const action = searchParams.get("action") || "list";

    if (!VALID_TABLES.includes(table)) {
      return new Response(JSON.stringify({ error: "Invalid table" }), { status: 400, headers: CORS });
    }

    // ── GET — list all ──────────────────────────────────────────────────────
    if (req.method === "GET") {
      const rows = await sql`SELECT * FROM ${sql(table)} ORDER BY id DESC`;
      return new Response(JSON.stringify(rows), { headers: CORS });
    }

    const body = await req.json();

    // ── POST — insert ───────────────────────────────────────────────────────
    if (req.method === "POST") {
      const { id, ...rest } = body;
      const cols = Object.keys(rest);
      const vals = Object.values(rest);
      const row = await sql`
        INSERT INTO ${sql(table)} ${sql({ id, ...rest })}
        ON CONFLICT (id) DO NOTHING
        RETURNING *
      `;
      return new Response(JSON.stringify(row[0] || body), { headers: CORS });
    }

    // ── PUT — update ────────────────────────────────────────────────────────
    if (req.method === "PUT") {
      const { id, ...rest } = body;
      await sql`UPDATE ${sql(table)} SET ${sql(rest)} WHERE id = ${id}`;
      return new Response(JSON.stringify({ ok: true }), { headers: CORS });
    }

    // ── DELETE ──────────────────────────────────────────────────────────────
    if (req.method === "DELETE") {
      const id = searchParams.get("id");
      await sql`DELETE FROM ${sql(table)} WHERE id = ${id}`;
      return new Response(JSON.stringify({ ok: true }), { headers: CORS });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: CORS });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
