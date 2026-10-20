import assert from "node:assert/strict";
import { pedroAtivo } from "./_pedro-standby.js";

const ORIGINAL = process.env.PEDRO_ATIVO;
function restore() {
  if (ORIGINAL === undefined) delete process.env.PEDRO_ATIVO;
  else process.env.PEDRO_ATIVO = ORIGINAL;
}

// ---------- pedroAtivo: só a string exata "1" ativa ----------
{
  delete process.env.PEDRO_ATIVO;
  assert.equal(pedroAtivo(), false, "ausente = stand by (padrão)");

  process.env.PEDRO_ATIVO = "0";
  assert.equal(pedroAtivo(), false, "\"0\" = stand by");

  process.env.PEDRO_ATIVO = "true";
  assert.equal(pedroAtivo(), false, "\"true\" não conta, só a string exata \"1\"");

  process.env.PEDRO_ATIVO = " 1";
  assert.equal(pedroAtivo(), false, "espaço extra não conta como \"1\"");

  process.env.PEDRO_ATIVO = "1 ";
  assert.equal(pedroAtivo(), false, "espaço no final também não conta");

  process.env.PEDRO_ATIVO = "1";
  assert.equal(pedroAtivo(), true, "só a string exata \"1\" ativa o Pedro");
}
console.log("pedroAtivo (só a string exata \"1\" ativa): OK");

restore();
console.log("_pedro-standby.test.mjs: todos os testes passaram");
