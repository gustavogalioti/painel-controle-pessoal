// Backup das chaves pedro_* do sync_kv (memória, ensinado, chat, pet, diário, inscrições de push).
// Uso:  DATABASE_URL=postgres://... node scripts/pedro-backup.mjs [saida.json]
// Só LÊ o banco. O arquivo contém dados pessoais e as inscrições de push: NÃO commitar
// (já cai no .gitignore como pedro-backup-*.json).
import { neon } from "@neondatabase/serverless";
import fs from "node:fs";

if (!process.env.DATABASE_URL) { console.error("Defina DATABASE_URL."); process.exit(1); }
const sql = neon(process.env.DATABASE_URL);
const rows = await sql`SELECT key, value, updated_at FROM sync_kv WHERE left(key, 6) = 'pedro_' ORDER BY key`;
const out = process.argv[2] || `pedro-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
const data = { exportadoEm: new Date().toISOString(), chaves: rows.map(r => ({ key: r.key, updated_at: r.updated_at, value: (() => { try { return JSON.parse(r.value); } catch { return r.value; } })() })) };
fs.writeFileSync(out, JSON.stringify(data, null, 2));
console.log(`${rows.length} chave(s) pedro_* exportadas -> ${out}`);
for (const r of rows) console.log(" -", r.key);
