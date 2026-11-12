// Garante que o Pedro (pet) NÃO conhece o painel: nenhuma chave de dados do painel,
// nem Google/Outlook/Jarbas/clima, em nenhum arquivo api/*pedro*.js (exceto testes).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.join(root, "api");
const pedroFiles = fs.readdirSync(apiDir).filter(f => /pedro/.test(f) && f.endsWith(".js") && !f.endsWith(".test.mjs"));
assert.ok(pedroFiles.includes("pedro.js") && pedroFiles.includes("pedro-cron.js") && pedroFiles.includes("_pedro-pet-lib.js"));

// 1) Chaves de dados do painel = toda chave usada em useKV("...") no front, menos as do Pedro.
const frontSrc = ["App.jsx", "DailyCenter.jsx"].map(f => fs.readFileSync(path.join(root, "src", f), "utf8")).join("\n");
const painelKeys = [...new Set([...frontSrc.matchAll(/useKV\(\s*["'`]([a-z0-9_]+)["'`]/gi)].map(m => m[1]))].filter(k => !k.startsWith("pedro_"));
assert.ok(painelKeys.length > 10, "deveria achar várias chaves do painel no front");
// + chaves conhecidas que o Pedro antigo lia
const legadas = ["tasks_v1", "bills_v1", "finance_v1", "events_v1", "diary_v1", "ideas_v1"];
const proibidas = [...new Set([...painelKeys, ...legadas])];

const importsProibidos = [/google-calendar/, /outlook-calendar/, /google-auth/, /outlook-auth/, /_gusos-lib/, /jarbas/i, /chatgpt/i, /open-meteo/i, /googleapis\.com\/calendar/];

for (const f of pedroFiles) {
  const src = fs.readFileSync(path.join(apiDir, f), "utf8");
  for (const k of proibidas) {
    assert.ok(!new RegExp(`["'\`]${k}["'\`]`).test(src), `${f} não pode referenciar a chave do painel "${k}"`);
  }
  for (const re of importsProibidos) {
    // só olha linhas que importam módulos ou falam com a rede (o texto do prompt pode citar o Jarbas)
    const codeLines = src.split("\n").filter(l => /^\s*(import\b|export .* from|.*\bfetch\(|.*https?:\/\/)/.test(l) && !/^\s*(\/\/|\*)/.test(l));
    assert.ok(!codeLines.some(l => re.test(l)), `${f} não pode usar ${re}`);
  }
  // toda chave do sync_kv acessada por helper deve ser pedro_*
  for (const m of src.matchAll(/(?:getKvList|getKvObject|setKv|setKvList)\(\s*sql\s*,\s*["'`]([^"'`]+)["'`]/g)) {
    assert.ok(m[1].startsWith("pedro_"), `${f}: chave "${m[1]}" deve começar com pedro_`);
  }
}

// 2) Jarbas e Pedro continuam independentes entre si.
const jarbas = fs.readFileSync(path.join(apiDir, "jarbas.js"), "utf8");
assert.ok(!/from\s+["']\.\/(_?pedro)/.test(jarbas), "jarbas.js não pode importar nada do Pedro");

// 3) Pedro só usa chaves PEDRO_KEYS pedro_*
const lib = fs.readFileSync(path.join(apiDir, "_pedro-pet-lib.js"), "utf8");
const keysBlock = lib.match(/PEDRO_KEYS\s*=\s*\{([\s\S]*?)\}/)[1];
for (const m of keysBlock.matchAll(/:\s*"([^"]+)"/g)) assert.ok(m[1].startsWith("pedro_"), `PEDRO_KEYS: ${m[1]}`);

console.log(`isolamento do Pedro (${pedroFiles.join(", ")}) vs ${painelKeys.length} chaves do painel: OK`);
