// Gera o Pedro em .animal (bake) pra carga rápida no celular: public/pedro/pedro-cat-medium.animal.
// Roda sempre que a "receita" (PEDRO_LOOK em src/pedro/actor/PedroActor.js) ou a lib vendorizada mudar:
//   node scripts/pedro-bake.mjs
import fs from "node:fs";
import path from "node:path";
import { buildAnimalData, writeBake } from "../src/pedro/vendor/procedural-animals/index.js";

const LOOK = { seed: 2, sex: "male", variant: "ginger", overrides: { muzzleWhite: true, white: 0.8, eye: "gold" } }; // manter igual a PEDRO_LOOK
const out = process.argv[2] || "public/pedro/pedro-cat-medium.animal";
fs.mkdirSync(path.dirname(out), { recursive: true });
const t = Date.now();
const data = await buildAnimalData("cat", { ...LOOK, quality: "medium", worker: false });
const buf = writeBake(data);
fs.writeFileSync(out, new Uint8Array(buf));
console.log(`${out}: ${(buf.byteLength / 1048576).toFixed(2)} MB em ${Date.now() - t} ms`);
