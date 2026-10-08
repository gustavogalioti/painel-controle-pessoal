export const config = { runtime: "edge" };
import { neon } from "@neondatabase/serverless";
import { requireSession } from "./_auth-lib.js";

// Script de migração ÚNICA (tabelas antigas -> sync_kv), rodado manualmente uma
// vez no passado. Não identifiquei nenhum lugar do app que ainda chame isso —
// sinalizado no PR pro Gustavo decidir se remove. Por ora, só exige sessão
// (como o resto do painel) em vez de ficar aberto pra qualquer um disparar
// (ele SOBRESCREVE sync_kv com o conteúdo das tabelas antigas, então rodar à
// toa por engano/ataque poderia reverter dados pra um estado velho).
const CORS = { "Content-Type": "application/json" };

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (!(await requireSession(req))) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: CORS });
  }
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
