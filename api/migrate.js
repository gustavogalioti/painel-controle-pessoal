export const config = { runtime: "edge" };
import { neon } from "@neondatabase/serverless";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const sql = neon(process.env.DATABASE_URL);
    const ts = new Date().toISOString();
    const results = {};

    const tables = [
      { table: "diary",       key: "diary_v1"      },
      { table: "ideas",       key: "ideas_v1"      },
      { table: "reminders",   key: "reminders_v1"  },
      { table: "tasks",       key: "tasks_v1"      },
      { table: "bills",       key: "bills_v1"      },
      { table: "events",      key: "events_v1"     },
      { table: "curiosities", key: "curiosities_v1"},
      { table: "documents",   key: "docs_v1"       },
    ];

    for (const { table, key } of tables) {
      try {
        // Check if key already has data in sync_kv
        const existing = await sql`SELECT value FROM sync_kv WHERE key=${key}`;
        let existingData = [];
        if (existing[0]) {
          try { existingData = JSON.parse(existing[0].value); } catch {}
        }

        // Read from original table
        const rows = await sql`SELECT * FROM ${sql(table)} ORDER BY id DESC`;

        if (rows.length === 0 && existingData.length > 0) {
          // Already migrated, skip
          results[key] = `skipped (${existingData.length} items already in sync_kv)`;
          continue;
        }

        // Merge: old table rows + anything already in sync_kv not in old table
        const oldIds = new Set(rows.map(r => String(r.id)));
        const onlyInKV = existingData.filter(r => !oldIds.has(String(r.id)));
        const merged = [...rows, ...onlyInKV];

        // Write merged to sync_kv
        const value = JSON.stringify(merged);
        await sql`INSERT INTO sync_kv (key, value, updated_at) VALUES (${key}, ${value}, ${ts})
                  ON CONFLICT (key) DO UPDATE SET value=${value}, updated_at=${ts}`;

        results[key] = `migrated ${merged.length} items (${rows.length} from DB + ${onlyInKV.length} from KV)`;
      } catch (e) {
        results[key] = `error: ${e.message}`;
      }
    }

    return new Response(JSON.stringify({ ok: true, results }), { headers: CORS });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
