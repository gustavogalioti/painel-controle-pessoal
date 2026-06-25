export const config = { runtime: "edge" };
import { neon } from "@neondatabase/serverless";

const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export default async function handler(req) {
  try {
    const sql = neon(process.env.DATABASE_URL);
    const ts = new Date().toISOString();
    const results = {};

    const readAndMigrate = async (key, rows) => {
      if (!rows || rows.length === 0) { results[key] = "0 itens no banco"; return; }
      const value = JSON.stringify(rows);
      await sql`INSERT INTO sync_kv (key, value, updated_at) VALUES (${key}, ${value}, ${ts})
                ON CONFLICT (key) DO UPDATE SET value=${value}, updated_at=${ts}`;
      results[key] = `${rows.length} itens migrados`;
    };

    await readAndMigrate("diary_v1",       await sql`SELECT * FROM diary       ORDER BY id DESC`);
    await readAndMigrate("ideas_v1",        await sql`SELECT * FROM ideas       ORDER BY id DESC`);
    await readAndMigrate("reminders_v1",    await sql`SELECT * FROM reminders   ORDER BY id DESC`);
    await readAndMigrate("tasks_v1",        await sql`SELECT * FROM tasks       ORDER BY id DESC`);
    await readAndMigrate("bills_v1",        await sql`SELECT * FROM bills       ORDER BY id DESC`);
    await readAndMigrate("events_v1",       await sql`SELECT * FROM events      ORDER BY id DESC`);
    await readAndMigrate("curiosities_v1",  await sql`SELECT * FROM curiosities ORDER BY id DESC`);
    await readAndMigrate("docs_v1",         await sql`SELECT * FROM documents   ORDER BY id DESC`);

    return new Response(JSON.stringify({ ok: true, results }), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
