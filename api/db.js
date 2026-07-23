export const config = { runtime: "edge" };
import { neon } from "@neondatabase/serverless";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const VALID = ["diary","ideas","reminders","tasks","bills","events","curiosities","documents","music"];

async function initTables(sql) {
  await sql`CREATE TABLE IF NOT EXISTS diary      (id BIGINT PRIMARY KEY, text TEXT NOT NULL, mood VARCHAR(10) DEFAULT '🙂', date TEXT)`;
  await sql`CREATE TABLE IF NOT EXISTS ideas      (id BIGINT PRIMARY KEY, text TEXT NOT NULL, mood VARCHAR(10) DEFAULT '🙂', date TEXT)`;
  await sql`CREATE TABLE IF NOT EXISTS reminders  (id BIGINT PRIMARY KEY, text TEXT NOT NULL, mood VARCHAR(10) DEFAULT '🙂', date TEXT)`;
  await sql`CREATE TABLE IF NOT EXISTS tasks      (id BIGINT PRIMARY KEY, text TEXT NOT NULL, prio VARCHAR(20) DEFAULT 'normal', done BOOLEAN DEFAULT FALSE, status VARCHAR(20) DEFAULT 'todo', date TEXT)`;
  await sql`CREATE TABLE IF NOT EXISTS bills      (id BIGINT PRIMARY KEY, name TEXT NOT NULL, value NUMERIC DEFAULT 0, due_day INT, cat VARCHAR(50), recurrent BOOLEAN DEFAULT TRUE, paid BOOLEAN DEFAULT FALSE)`;
  await sql`CREATE TABLE IF NOT EXISTS events     (id BIGINT PRIMARY KEY, title TEXT NOT NULL, date TEXT, time TEXT DEFAULT '', local TEXT DEFAULT '', cat VARCHAR(50), notes TEXT DEFAULT '')`;
  await sql`CREATE TABLE IF NOT EXISTS curiosities(id BIGINT PRIMARY KEY, title TEXT NOT NULL, content TEXT DEFAULT '', link TEXT DEFAULT '', image_url TEXT DEFAULT '', tag TEXT DEFAULT '', updates JSONB DEFAULT '[]', created TEXT)`;
  await sql`CREATE TABLE IF NOT EXISTS documents  (id BIGINT PRIMARY KEY, name TEXT NOT NULL, cat VARCHAR(50) DEFAULT 'Pessoal', tags JSONB DEFAULT '[]', notes TEXT DEFAULT '', file_data TEXT DEFAULT '', file_name TEXT DEFAULT '', file_size INT DEFAULT 0, file_type TEXT DEFAULT '', date TEXT)`;
  await sql`CREATE TABLE IF NOT EXISTS music_library (id BIGINT PRIMARY KEY, name TEXT NOT NULL, artist TEXT DEFAULT '', file_data TEXT NOT NULL, file_name TEXT DEFAULT '', file_size INT DEFAULT 0, mime_type TEXT DEFAULT 'audio/mpeg', date TEXT)`;
  // Generic key-value sync table — used by Whiteboard, DayBoard, Letreiro, DJ Studio
  await sql`CREATE TABLE IF NOT EXISTS sync_kv    (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT)`;
}

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const sql = neon(process.env.DATABASE_URL);
    await initTables(sql);

    const { searchParams } = new URL(req.url);
    const table = searchParams.get("table");

    // ── sync_kv: generic key/value ──────────────────────────────────────────
    if (table === "sync_kv") {
      // GET /api/db?table=sync_kv&key=letreiro_v1
      if (req.method === "GET") {
        const key = searchParams.get("key");
        if (key) {
          const rows = await sql`SELECT value FROM sync_kv WHERE key=${key}`;
          return new Response(JSON.stringify(rows[0] ? rows[0].value : null), { headers: CORS });
        }
        // GET all — returns [{key,value,updated_at}]
        const rows = await sql`SELECT key, value, updated_at FROM sync_kv ORDER BY updated_at DESC`;
        return new Response(JSON.stringify(rows), { headers: CORS });
      }
      // POST /api/db?table=sync_kv  body: {key, value}
      if (req.method === "POST") {
        const { key, value } = await req.json();
        const ts = new Date().toISOString();
        await sql`INSERT INTO sync_kv (key, value, updated_at) VALUES (${key}, ${value}, ${ts})
                  ON CONFLICT (key) DO UPDATE SET value=${value}, updated_at=${ts}`;
        return new Response(JSON.stringify({ ok: true }), { headers: CORS });
      }
      // DELETE /api/db?table=sync_kv&key=whiteboard_wb_123
      if (req.method === "DELETE") {
        const key = searchParams.get("key");
        await sql`DELETE FROM sync_kv WHERE key=${key}`;
        return new Response(JSON.stringify({ ok: true }), { headers: CORS });
      }
    }

    // ── music_library: lista leve (sem áudio) ou item completo por id ────────
    if (table === "music") {
      const id = searchParams.get("id");
      if (req.method === "GET") {
        if (id) {
          const rows = await sql`SELECT * FROM music_library WHERE id=${id}`;
          return new Response(JSON.stringify(rows[0] || null), { headers: CORS });
        }
        const rows = await sql`SELECT id, name, artist, file_name, file_size, mime_type, date FROM music_library ORDER BY id DESC`;
        return new Response(JSON.stringify(rows), { headers: CORS });
      }
      if (req.method === "POST") {
        const { id: mid, name, artist, file_data, file_name, file_size, mime_type, date } = await req.json();
        await sql`INSERT INTO music_library (id,name,artist,file_data,file_name,file_size,mime_type,date)
                  VALUES (${mid},${name},${artist||''},${file_data},${file_name||''},${file_size||0},${mime_type||'audio/mpeg'},${date})
                  ON CONFLICT (id) DO NOTHING`;
        return new Response(JSON.stringify({ ok: true }), { headers: CORS });
      }
      if (req.method === "DELETE") {
        await sql`DELETE FROM music_library WHERE id=${id}`;
        return new Response(JSON.stringify({ ok: true }), { headers: CORS });
      }
    }

    // ── standard row tables ─────────────────────────────────────────────────
    if (!VALID.includes(table)) {
      return new Response(JSON.stringify({ error: "Invalid table" }), { status: 400, headers: CORS });
    }

    if (req.method === "GET") {
      let rows;
      if (table === "diary")       rows = await sql`SELECT * FROM diary       ORDER BY id DESC`;
      if (table === "ideas")       rows = await sql`SELECT * FROM ideas       ORDER BY id DESC`;
      if (table === "reminders")   rows = await sql`SELECT * FROM reminders   ORDER BY id DESC`;
      if (table === "tasks")       rows = await sql`SELECT * FROM tasks       ORDER BY id DESC`;
      if (table === "bills")       rows = await sql`SELECT * FROM bills       ORDER BY id DESC`;
      if (table === "events")      rows = await sql`SELECT * FROM events      ORDER BY id DESC`;
      if (table === "curiosities") rows = await sql`SELECT * FROM curiosities ORDER BY id DESC`;
      if (table === "documents")   rows = await sql`SELECT * FROM documents   ORDER BY id DESC`;
      return new Response(JSON.stringify(rows || []), { headers: CORS });
    }

    const body = await req.json();

    if (req.method === "POST") {
      const { id, text, mood, date, prio, done, name, value, due_day, cat, recurrent, paid,
              title, time, local, notes, content, link, image_url, tag, updates, created,
              tags, file_data, file_name, file_size, file_type } = body;

      if (table === "diary")       await sql`INSERT INTO diary (id,text,mood,date) VALUES (${id},${text},${mood||'🙂'},${date}) ON CONFLICT (id) DO NOTHING`;
      if (table === "ideas")       await sql`INSERT INTO ideas (id,text,mood,date) VALUES (${id},${text},${mood||'🙂'},${date}) ON CONFLICT (id) DO NOTHING`;
      if (table === "reminders")   await sql`INSERT INTO reminders (id,text,mood,date) VALUES (${id},${text},${mood||'🙂'},${date}) ON CONFLICT (id) DO NOTHING`;
      if (table === "tasks")       await sql`INSERT INTO tasks (id,text,prio,done,status,date) VALUES (${id},${text},${prio||'normal'},${done||false},${body.status||'todo'},${date}) ON CONFLICT (id) DO NOTHING`;
      if (table === "bills")       await sql`INSERT INTO bills (id,name,value,due_day,cat,recurrent,paid) VALUES (${id},${name},${value||0},${due_day},${cat},${recurrent},${paid||false}) ON CONFLICT (id) DO NOTHING`;
      if (table === "events")      await sql`INSERT INTO events (id,title,date,time,local,cat,notes) VALUES (${id},${title},${date},${time||''},${local||''},${cat},${notes||''}) ON CONFLICT (id) DO NOTHING`;
      if (table === "curiosities") await sql`INSERT INTO curiosities (id,title,content,link,image_url,tag,updates,created) VALUES (${id},${title},${content||''},${link||''},${image_url||''},${tag||''},${JSON.stringify(updates||[])},${created}) ON CONFLICT (id) DO NOTHING`;
      if (table === "documents")   await sql`INSERT INTO documents (id,name,cat,tags,notes,file_data,file_name,file_size,file_type,date) VALUES (${id},${name},${cat||'Pessoal'},${JSON.stringify(tags||[])},${notes||''},${file_data||''},${file_name||''},${file_size||0},${file_type||''},${date}) ON CONFLICT (id) DO NOTHING`;
      return new Response(JSON.stringify({ ok: true }), { headers: CORS });
    }

    if (req.method === "PUT") {
      const { id, done, paid, text, mood, updates, title, date, time, local, cat, notes, status } = body;
      if (table === "tasks") {
        if (status !== undefined && done !== undefined) {
          await sql`UPDATE tasks SET done=${done}, status=${status} WHERE id=${id}`;
        } else if (status !== undefined) {
          await sql`UPDATE tasks SET status=${status} WHERE id=${id}`;
        } else if (done !== undefined) {
          await sql`UPDATE tasks SET done=${done} WHERE id=${id}`;
        }
      }
      if (table === "bills")       await sql`UPDATE bills       SET paid=${paid}                               WHERE id=${id}`;
      if (table === "diary")       await sql`UPDATE diary       SET text=${text}, mood=${mood}                 WHERE id=${id}`;
      if (table === "ideas")       await sql`UPDATE ideas       SET text=${text}, mood=${mood}                 WHERE id=${id}`;
      if (table === "reminders")   await sql`UPDATE reminders   SET text=${text}, mood=${mood}                 WHERE id=${id}`;
      if (table === "curiosities") await sql`UPDATE curiosities SET updates=${JSON.stringify(updates)}          WHERE id=${id}`;
      if (table === "events")      await sql`UPDATE events       SET title=${title}, date=${date}, time=${time||''}, local=${local||''}, cat=${cat}, notes=${notes||''} WHERE id=${id}`;
      return new Response(JSON.stringify({ ok: true }), { headers: CORS });
    }

    if (req.method === "DELETE") {
      const id = searchParams.get("id");
      if (table === "diary")       await sql`DELETE FROM diary       WHERE id=${id}`;
      if (table === "ideas")       await sql`DELETE FROM ideas       WHERE id=${id}`;
      if (table === "reminders")   await sql`DELETE FROM reminders   WHERE id=${id}`;
      if (table === "tasks")       await sql`DELETE FROM tasks       WHERE id=${id}`;
      if (table === "bills")       await sql`DELETE FROM bills       WHERE id=${id}`;
      if (table === "events")      await sql`DELETE FROM events      WHERE id=${id}`;
      if (table === "curiosities") await sql`DELETE FROM curiosities WHERE id=${id}`;
      if (table === "documents")   await sql`DELETE FROM documents   WHERE id=${id}`;
      return new Response(JSON.stringify({ ok: true }), { headers: CORS });
    }

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}


