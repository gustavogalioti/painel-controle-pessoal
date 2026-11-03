// ADMIN-1: inventário (painel_resumo/painel_buscar), painel_gerenciar (escrita com
// salvaguardas), desfazer (10min da barra de comando + 24h do admin + "desfaz" por
// voz sem id) e a ponte "Verificar agora" (cmdVerificarJanela).
import assert from "node:assert/strict";
import {
  getPainelResumo, getPainelBusca, cmdPainelGerenciar, cmdDesfazer, cmdDesfazerUltima,
  cmdVerificarJanela,
} from "./jarbas.js";

// Mock de `sql` com rastreio de ordem de escrita (pra simular "ORDER BY updated_at
// DESC" de verdade, que cmdDesfazerUltima depende) — mesmo padrão tagged-template
// dos outros testes de jarbas.js (api/_jarbas-ponte.test.mjs), só que guardando um
// contador de sequência por chave em vez de só o valor.
function makeMockSql() {
  const store = new Map(); // key -> { value, seq }
  let seq = 0;
  const sql = (strings, ...values) => {
    const text = strings.join(" ");
    if (text.includes("SELECT key, value FROM sync_kv WHERE key LIKE")) {
      const prefix = values[0].replace(/%$/, "");
      const rows = [...store.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .sort((a, b) => b[1].seq - a[1].seq)
        .map(([key, v]) => ({ key, value: v.value }));
      return Promise.resolve(rows.slice(0, 20));
    }
    if (text.includes("SELECT value FROM sync_kv")) {
      const key = values[0];
      return Promise.resolve(store.has(key) ? [{ value: store.get(key).value }] : []);
    }
    if (text.includes("COALESCE(sync_kv.value::jsonb")) {
      const [key, value] = values;
      const existing = store.has(key) ? JSON.parse(store.get(key).value) : [];
      const incoming = JSON.parse(value);
      store.set(key, { value: JSON.stringify([...existing, ...incoming]), seq: seq++ });
      return Promise.resolve([]);
    }
    if (text.includes("INSERT INTO sync_kv")) {
      const [key, value] = values;
      store.set(key, { value, seq: seq++ });
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  };
  const raw = () => Object.fromEntries([...store.entries()].map(([k, v]) => [k, v.value]));
  return { sql, store, raw };
}
const getList = (raw, key) => JSON.parse(raw()[key] || "[]");
const getJson = (raw, key) => (raw()[key] !== undefined ? JSON.parse(raw()[key]) : null);
const setList = (sqlObj, key, list) => sqlObj.store.set(key, { value: JSON.stringify(list), seq: 0 });
const setJson = (sqlObj, key, obj) => sqlObj.store.set(key, { value: JSON.stringify(obj), seq: 0 });

// ---------- painel_resumo ----------
{
  const m = makeMockSql();
  setList(m, "tasks_v1", [
    { id: 1, text: "tarefa parada", status: "now", date: "2026-01-01" },
    { id: 2, text: "tarefa feita", status: "done", done: true, date: "2026-01-01" },
  ]);
  setList(m, "events_v1", [{ id: 10, title: "Dentista", date: "2026-02-01", time: "15:00" }]);
  const resumo = await getPainelResumo(m.sql);
  assert.ok(resumo.tarefa, "tem a chave 'tarefa'");
  assert.equal(resumo.tarefa.total, 2);
  assert.equal(resumo.tarefa.itens[0].titulo, "tarefa parada", "não-concluída vem antes da concluída");
  assert.ok(resumo.tarefa.hash, "tem hash por coleção");
  assert.equal(resumo.compromisso.itens[0].titulo, "Dentista");
  assert.ok(resumo.diario, "diário aparece no resumo (mesmo sendo só leitura pro gerenciar)");
}
console.log("getPainelResumo: OK");

{
  // hash muda quando o conteúdo muda, e só isso (sem precisar baixar tudo de novo)
  const m = makeMockSql();
  setList(m, "ideas_v1", [{ id: 1, text: "ideia A" }]);
  const r1 = await getPainelResumo(m.sql);
  setList(m, "ideas_v1", [{ id: 1, text: "ideia A (editada)" }]);
  const r2 = await getPainelResumo(m.sql);
  assert.notEqual(r1.ideia.hash, r2.ideia.hash);
}
console.log("getPainelResumo (hash reage a mudança): OK");

// ---------- painel_buscar ----------
{
  const m = makeMockSql();
  setList(m, "tasks_v1", [{ id: 1, text: "ligar pro dentista" }]);
  setList(m, "ideas_v1", [{ id: 2, text: "app de dentista pra crianças" }]);
  setList(m, "events_v1", [{ id: 3, title: "Reunião de equipe" }]);
  const r = await getPainelBusca(m.sql, "dentista");
  assert.equal(r.resultados.length, 2, "achou nas duas coleções que mencionam 'dentista'");
  assert.ok(r.resultados.some((x) => x.dominio === "tarefa"));
  assert.ok(r.resultados.some((x) => x.dominio === "ideia"));
  assert.ok(!r.resultados.some((x) => x.dominio === "compromisso"));

  const vazio = await getPainelBusca(m.sql, "");
  assert.deepEqual(vazio.resultados, []);
}
console.log("getPainelBusca: OK");

// ---------- cmdPainelGerenciar: criar (ação segura, direto) ----------
{
  const m = makeMockSql();
  const r = await cmdPainelGerenciar(m.sql, { dominio: "tarefa", acao: "criar", params: { texto: "comprar tinta" } });
  assert.equal(r.ok, true);
  assert.equal(r.item.titulo, "comprar tinta");
  assert.ok(r.undoId, "toda escrita grava um undo");
  const tasks = getList(m.raw, "tasks_v1");
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].text, "comprar tinta");

  const log = getList(m.raw, `jarbas_log_${new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date())}`);
  assert.equal(log.length, 1, "toda escrita grava no Diário");
  assert.equal(log[0].detalhes.ferramenta, "painel_gerenciar");
}
console.log("cmdPainelGerenciar (criar tarefa): OK");

// ---------- dedup antes de criar ----------
{
  const m = makeMockSql();
  setList(m, "tasks_v1", [{ id: 1, text: "comprar tinta azul", status: "todo" }]);
  const r = await cmdPainelGerenciar(m.sql, { dominio: "tarefa", acao: "criar", params: { texto: "comprar tinta" } });
  assert.equal(r.ok, false);
  assert.equal(r.erro, "duplicado");
  assert.equal(getList(m.raw, "tasks_v1").length, 1, "não duplicou");

  // já concluída não conta como "ativa" pro dedup -> cria normalmente
  const m2 = makeMockSql();
  setList(m2, "tasks_v1", [{ id: 1, text: "comprar tinta", status: "done", done: true }]);
  const r2 = await cmdPainelGerenciar(m2.sql, { dominio: "tarefa", acao: "criar", params: { texto: "comprar tinta" } });
  assert.equal(r2.ok, true);
}
console.log("cmdPainelGerenciar (dedup antes de criar): OK");

// ---------- mover (coluna) ----------
{
  const m = makeMockSql();
  setList(m, "tasks_v1", [{ id: 1, text: "tarefa", status: "todo" }]);
  const r = await cmdPainelGerenciar(m.sql, { dominio: "tarefa", acao: "mover", params: { id: 1, status: "today" } });
  assert.equal(r.ok, true);
  assert.equal(getList(m.raw, "tasks_v1")[0].status, "today");
}
console.log("cmdPainelGerenciar (mover coluna): OK");

// ---------- concluir conta (marcar paga) ----------
{
  const m = makeMockSql();
  setList(m, "bills_v1", [{ id: 1, name: "Internet", value: 100, dueDay: 10, paid: false, recurrent: false }]);
  const r = await cmdPainelGerenciar(m.sql, { dominio: "conta", acao: "concluir", params: { id: 1 } });
  assert.equal(r.ok, true);
  assert.equal(getList(m.raw, "bills_v1")[0].paid, true);
}
console.log("cmdPainelGerenciar (marcar conta como paga, via bills_v1 real): OK");

// ---------- ações destrutivas SEM confirmação -> recusa, nunca executa ----------
{
  const m = makeMockSql();
  setList(m, "tasks_v1", [{ id: 1, text: "tarefa", status: "todo" }]);
  const r = await cmdPainelGerenciar(m.sql, { dominio: "tarefa", acao: "apagar", params: { id: 1 } });
  assert.equal(r.ok, false);
  assert.equal(r.erro, "confirmacao_necessaria");
  assert.equal(getList(m.raw, "tasks_v1").length, 1, "nunca apaga sem confirmado:true");
}
console.log("cmdPainelGerenciar (apagar sem confirmação -> recusa): OK");

// ---------- apagar COM confirmação -> move pra lixeira, nunca perde dados ----------
{
  const m = makeMockSql();
  setList(m, "tasks_v1", [{ id: 1, text: "tarefa a apagar", status: "todo" }]);
  const r = await cmdPainelGerenciar(m.sql, { dominio: "tarefa", acao: "apagar", params: { id: 1 }, confirmado: true });
  assert.equal(r.ok, true);
  assert.equal(getList(m.raw, "tasks_v1").length, 0);
  const lixeira = getList(m.raw, "tasks_v1_trash_v1");
  assert.equal(lixeira.length, 1, "vai pra lixeira, nunca é perdida de verdade");
  assert.equal(lixeira[0].text, "tarefa a apagar");
}
console.log("cmdPainelGerenciar (apagar com confirmação -> lixeira): OK");

// ---------- arquivar_varios / mover_todos também exigem confirmação ----------
{
  const m = makeMockSql();
  setList(m, "tasks_v1", [{ id: 1, status: "done", text: "a" }, { id: 2, status: "done", text: "b" }]);
  const semConfirmar = await cmdPainelGerenciar(m.sql, { dominio: "tarefa", acao: "arquivar_varios", params: { status: "done" } });
  assert.equal(semConfirmar.erro, "confirmacao_necessaria");
  const comConfirmar = await cmdPainelGerenciar(m.sql, { dominio: "tarefa", acao: "arquivar_varios", params: { status: "done" }, confirmado: true });
  assert.equal(comConfirmar.ok, true);
  assert.equal(getList(m.raw, "tasks_v1").length, 0);
  assert.equal(getList(m.raw, "tasks_v1_trash_v1").length, 2);
}
console.log("cmdPainelGerenciar (arquivar_varios exige confirmação): OK");

{
  const m = makeMockSql();
  setList(m, "tasks_v1", [{ id: 1, status: "todo", text: "a" }, { id: 2, status: "todo", text: "b" }]);
  const semConfirmar = await cmdPainelGerenciar(m.sql, { dominio: "tarefa", acao: "mover_todos", params: { deStatus: "todo", paraStatus: "now" } });
  assert.equal(semConfirmar.erro, "confirmacao_necessaria");
  const comConfirmar = await cmdPainelGerenciar(m.sql, { dominio: "tarefa", acao: "mover_todos", params: { deStatus: "todo", paraStatus: "now" }, confirmado: true });
  assert.equal(comConfirmar.ok, true);
  assert.ok(getList(m.raw, "tasks_v1").every((t) => t.status === "now"));
}
console.log("cmdPainelGerenciar (mover_todos exige confirmação): OK");

// ---------- trava global: mem.config.admin.ativo=false -> recusa tudo ----------
{
  const m = makeMockSql();
  setJson(m, "jarbas_memory_v1", { config: { admin: { ativo: false } } });
  const r = await cmdPainelGerenciar(m.sql, { dominio: "tarefa", acao: "criar", params: { texto: "x" } });
  assert.equal(r.ok, false);
  assert.equal(r.erro, "admin_desativado");
}
console.log("cmdPainelGerenciar (mem.config.admin.ativo=false desliga tudo): OK");

// ---------- modo "sugerir": nunca executa, mesmo ação segura e clara ----------
{
  const m = makeMockSql();
  setJson(m, "jarbas_memory_v1", { config: { admin: { modo: "sugerir" } } });
  const r = await cmdPainelGerenciar(m.sql, { dominio: "tarefa", acao: "criar", params: { texto: "comprar tinta" } });
  assert.equal(r.ok, false);
  assert.equal(r.erro, "modo_sugerir");
  assert.equal(getList(m.raw, "tasks_v1").length, 0, "não criou nada, só devolveu o que faria");
}
console.log("cmdPainelGerenciar (modo sugerir nunca executa): OK");

// ---------- domínio/ação inválidos, e diário (só leitura) nunca aceita escrita aqui ----------
{
  const m = makeMockSql();
  assert.equal((await cmdPainelGerenciar(m.sql, { dominio: "inventado", acao: "criar", params: {} })).erro, "dominio_invalido");
  assert.equal((await cmdPainelGerenciar(m.sql, { dominio: "diario", acao: "criar", params: { texto: "x" } })).erro, "dominio_invalido");
  assert.equal((await cmdPainelGerenciar(m.sql, { dominio: "tarefa", acao: "voar", params: {} })).erro, "acao_invalida");
}
console.log("cmdPainelGerenciar (domínio/ação inválidos -> recusa clara): OK");

// ---------- limite de escritas por minuto (anti-laço) ----------
{
  // 20 palavras bem diferentes entre si — de propósito, pra não disparar o dedup
  // por contenção (que É esperado pegar textos parecidos, como "ideia 1"/"ideia 10";
  // aqui o que se testa é só o limite de escritas, não o dedup).
  const palavras = ["abacate", "bicicleta", "cachorro", "dinossauro", "elefante", "farol", "girassol", "hipopotamo", "iglu", "jacare",
    "kiwi", "lagarto", "morango", "nuvem", "oceano", "pipoca", "quadro", "robo", "sapo", "tucano"];
  const m = makeMockSql();
  for (let i = 0; i < palavras.length; i++) {
    const r = await cmdPainelGerenciar(m.sql, { dominio: "ideia", acao: "criar", params: { texto: palavras[i] } });
    assert.equal(r.ok, true, `escrita ${i + 1}/${palavras.length} deveria passar`);
  }
  const r21 = await cmdPainelGerenciar(m.sql, { dominio: "ideia", acao: "criar", params: { texto: "zebra" } });
  assert.equal(r21.ok, false);
  assert.equal(r21.erro, "rate_limited");
  assert.equal(r21.motivo, "limite_por_minuto");
}
console.log("cmdPainelGerenciar (limite de escritas por minuto): OK");

// ---------- cmdDesfazer (10min, da barra de comando) continua funcionando ----------
{
  const m = makeMockSql();
  setList(m, "tasks_v1", [{ id: 1, text: "comprar tinta", status: "todo" }]);
  const r = await cmdPainelGerenciar(m.sql, { dominio: "tarefa", acao: "criar", params: { texto: "outra tarefa" } });
  const desfeito = await cmdDesfazer(m.sql, r.undoId);
  assert.equal(desfeito.status, 200);
  assert.equal(getList(m.raw, "tasks_v1").length, 1, "voltou pro estado de antes (só a tarefa original)");
}
console.log("cmdDesfazer (undo do painel_gerenciar, 24h, pelo id explícito): OK");

// ---------- cmdDesfazerUltima: "desfaz" por voz, sem id ----------
{
  const m = makeMockSql();
  setList(m, "ideas_v1", [{ id: 1, text: "ideia original" }]);
  const r = await cmdPainelGerenciar(m.sql, { dominio: "ideia", acao: "criar", params: { texto: "ideia nova" } });
  assert.equal(r.ok, true);
  const desfeito = await cmdDesfazerUltima(m.sql);
  assert.equal(desfeito.status, 200);
  assert.equal(getList(m.raw, "ideas_v1").length, 1, "desfez a ação mais recente sem precisar do id");

  // nada pra desfazer -> 404, nunca quebra
  const m2 = makeMockSql();
  assert.equal((await cmdDesfazerUltima(m2.sql)).status, 404);
}
console.log("cmdDesfazerUltima (desfaz por voz, sem id explícito): OK");

{
  // usado só uma vez: desfazer de novo o mesmo id não repete a restauração
  const m = makeMockSql();
  setList(m, "tasks_v1", [{ id: 1, text: "original", status: "todo" }]);
  const r = await cmdPainelGerenciar(m.sql, { dominio: "tarefa", acao: "criar", params: { texto: "nova" } });
  await cmdDesfazer(m.sql, r.undoId);
  const segunda = await cmdDesfazer(m.sql, r.undoId);
  assert.equal(segunda.status, 410);
  assert.equal(segunda.data.error, "undo_already_used");
}
console.log("cmdDesfazer (não desfaz duas vezes o mesmo id): OK");

// ---------- cmdVerificarJanela: ponte "Verificar agora" -> Worker ----------
{
  const prevUrl = process.env.WORKER_URL, prevKey = process.env.JARBAS_WORKER_SYNC_KEY;
  process.env.WORKER_URL = "https://worker.test";
  process.env.JARBAS_WORKER_SYNC_KEY = "segredo-worker";
  const originalFetch = globalThis.fetch;
  let capturedBody = null;
  globalThis.fetch = async (url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ rodou: true, achados: ["conta vencendo"], leitura: "Vi uma conta vencendo." }) };
  };
  try {
    const { sql } = makeMockSql();
    const r = await cmdVerificarJanela(sql, { janelaId: "manual" });
    assert.equal(r.status, 200);
    assert.equal(r.data.rodou, true);
    assert.equal(capturedBody.mode, "painel_verificar_janela");
    assert.equal(capturedBody.key, "segredo-worker");
    assert.equal(capturedBody.janelaId, "manual");
  } finally {
    globalThis.fetch = originalFetch;
    if (prevUrl === undefined) delete process.env.WORKER_URL; else process.env.WORKER_URL = prevUrl;
    if (prevKey === undefined) delete process.env.JARBAS_WORKER_SYNC_KEY; else process.env.JARBAS_WORKER_SYNC_KEY = prevKey;
  }
}
console.log("cmdVerificarJanela (ponte painel -> Worker): OK");

{
  // sem WORKER_URL/JARBAS_WORKER_SYNC_KEY -> 500 claro, nunca trava
  const { sql } = makeMockSql();
  const r = await cmdVerificarJanela(sql, {});
  assert.equal(r.status, 500);
  assert.equal(r.data.error, "worker_not_configured");
}
console.log("cmdVerificarJanela (Worker não configurado -> 500 claro): OK");

console.log("_admin1-painel-gerenciar.test.mjs: todos os testes passaram");
