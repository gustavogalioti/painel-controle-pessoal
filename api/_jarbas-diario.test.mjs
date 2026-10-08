import assert from "node:assert/strict";
import { cmdAnotarDiario, cmdDesfazerDiario, cmdCorrigirDiario, isEligibleJarbasEntry } from "./jarbas.js";

// Mock mínimo do `sql` (tagged template do @neondatabase/serverless) — só o suficiente
// pra getKvList/setKvList (sobrescreve) e appendLogDia (concatena jsonb), que é tudo que
// os comandos de diário usam.
function makeMockSql() {
  const store = new Map();
  const sql = (strings, ...values) => {
    const text = strings.join(" ");
    if (text.includes("SELECT value FROM sync_kv")) {
      const key = values[0];
      return Promise.resolve(store.has(key) ? [{ value: store.get(key) }] : []);
    }
    if (text.includes("COALESCE(sync_kv.value::jsonb")) {
      // appendLogDia: concatena no array já existente, igual o Postgres faria.
      const [key, value] = values;
      const existing = store.has(key) ? JSON.parse(store.get(key)) : [];
      const incoming = JSON.parse(value);
      store.set(key, JSON.stringify([...existing, ...incoming]));
      return Promise.resolve([]);
    }
    if (text.includes("INSERT INTO sync_kv")) {
      const [key, value] = values;
      store.set(key, value);
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  };
  return { sql, store };
}

const getList = (store, key) => JSON.parse(store.get(key) || "[]");

// ---------- cmdAnotarDiario grava com origem "jarbas" e devolve o id ----------
{
  const { sql, store } = makeMockSql();
  const r = await cmdAnotarDiario(sql, { texto: "Estamos fazendo um update no sistema do Jarbas", humor: "bom" });
  assert.equal(r.reply, "");
  assert.ok(r.id, "deve devolver o id da entrada criada");
  const entries = getList(store, "diary_v1");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].origem, "jarbas");
  assert.equal(entries[0].text, "Estamos fazendo um update no sistema do Jarbas");
}

// ---------- isEligibleJarbasEntry: janela de 24h e origem ----------
{
  const now = Date.now();
  assert.equal(isEligibleJarbasEntry({ origem: "jarbas", date: new Date(now - 1000).toISOString() }, now), true);
  assert.equal(isEligibleJarbasEntry({ origem: "jarbas", date: new Date(now - 25 * 3600 * 1000).toISOString() }, now), false, "fora da janela de 24h");
  assert.equal(isEligibleJarbasEntry({ date: new Date(now).toISOString() }, now), false, "sem origem (Gustavo/legado) nunca é elegível");
  assert.equal(isEligibleJarbasEntry({ origem: "painel", date: new Date(now).toISOString() }, now), false, "origem diferente de jarbas nunca é elegível");
  assert.equal(isEligibleJarbasEntry(null, now), false);
}

// ---------- cmdDesfazerDiario: nunca toca entrada do Gustavo ----------
{
  const { sql, store } = makeMockSql();
  const gustavoEntry = { id: 1, text: "Fui ao dentista hoje", mood: "🙂", date: new Date().toISOString() }; // sem origem = Gustavo
  store.set("diary_v1", JSON.stringify([gustavoEntry]));

  const r = await cmdDesfazerDiario(sql, {});
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "Não achei anotação minha recente para desfazer.");
  assert.deepEqual(getList(store, "diary_v1"), [gustavoEntry], "entrada do Gustavo não pode ser tocada");
}

// ---------- cmdDesfazerDiario: desfaz a mais recente do Jarbas, move pra lixeira, loga ----------
{
  const { sql, store } = makeMockSql();
  await cmdAnotarDiario(sql, { texto: "anotação incompleta no seu" });
  const antes = getList(store, "diary_v1");
  assert.equal(antes.length, 1);

  const r = await cmdDesfazerDiario(sql, {});
  assert.equal(r.ok, true);
  assert.equal(r.texto, "anotação incompleta no seu");

  const depois = getList(store, "diary_v1");
  assert.equal(depois.length, 0, "entrada some do diary_v1");

  const trash = getList(store, "diary_trash_v1");
  assert.equal(trash.length, 1, "entrada vai pra lixeira, não é apagada de vez");
  assert.equal(trash[0].text, "anotação incompleta no seu");
  assert.ok(trash[0].deletedAt);

  const hoje = new Date().toISOString().slice(0, 10);
  const log = getList(store, `jarbas_log_${hoje}`);
  assert.equal(log.length, 1, "registra o desfazer no Diário do Jarbas (log de atividade)");
  assert.equal(log[0].tipo, "acao_pedida");
  assert.equal(log[0].origem, "jarbas");
}

// ---------- cmdDesfazerDiario: fora da janela de 24h, recusa ----------
{
  const { sql, store } = makeMockSql();
  const velha = { id: 2, text: "algo de ontem", mood: "🙂", date: new Date(Date.now() - 25 * 3600 * 1000).toISOString(), origem: "jarbas" };
  store.set("diary_v1", JSON.stringify([velha]));

  const r = await cmdDesfazerDiario(sql, {});
  assert.equal(r.ok, false);
  assert.deepEqual(getList(store, "diary_v1"), [velha], "entrada antiga do Jarbas não é tocada");
}

// ---------- cmdDesfazerDiario: entrada inexistente (id não encontrado) ----------
{
  const { sql, store } = makeMockSql();
  store.set("diary_v1", JSON.stringify([{ id: 1, text: "x", origem: "jarbas", date: new Date().toISOString() }]));
  const r = await cmdDesfazerDiario(sql, { id: 999 });
  assert.equal(r.ok, false);
}

// ---------- cmdCorrigirDiario: corrige a mais recente, guarda histórico de edição ----------
{
  const { sql, store } = makeMockSql();
  await cmdAnotarDiario(sql, { texto: "estamos fazendo um update no seu sistema" });

  const r = await cmdCorrigirDiario(sql, { novoTexto: "Estamos fazendo um update no sistema do Jarbas 🤖" });
  assert.equal(r.ok, true);
  assert.equal(r.textoAnterior, "estamos fazendo um update no seu sistema");
  assert.equal(r.texto, "Estamos fazendo um update no sistema do Jarbas 🤖");

  const entries = getList(store, "diary_v1");
  assert.equal(entries.length, 1, "corrigir não cria uma segunda entrada");
  assert.equal(entries[0].text, "Estamos fazendo um update no sistema do Jarbas 🤖");
  assert.equal(entries[0].edicoes.length, 1);
  assert.equal(entries[0].edicoes[0].textoAnterior, "estamos fazendo um update no seu sistema");
  assert.ok(entries[0].edicoes[0].em);

  const hoje = new Date().toISOString().slice(0, 10);
  const log = getList(store, `jarbas_log_${hoje}`);
  assert.equal(log.length, 1, "registra a correção no Diário do Jarbas (log de atividade)");
}

// ---------- cmdCorrigirDiario: nunca toca entrada do Gustavo ----------
{
  const { sql, store } = makeMockSql();
  const gustavoEntry = { id: 5, text: "Nota minha", mood: "🙂", date: new Date().toISOString() };
  store.set("diary_v1", JSON.stringify([gustavoEntry]));

  const r = await cmdCorrigirDiario(sql, { novoTexto: "tentativa de alterar" });
  assert.equal(r.ok, false);
  assert.deepEqual(getList(store, "diary_v1"), [gustavoEntry]);
}

// ---------- cmdCorrigirDiario: sem novoTexto, recusa sem tocar em nada ----------
{
  const { sql, store } = makeMockSql();
  await cmdAnotarDiario(sql, { texto: "algo" });
  const r = await cmdCorrigirDiario(sql, {});
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "Faltou o novo texto da correção.");
}

console.log("_jarbas-diario.test.mjs: todos os testes passaram");
