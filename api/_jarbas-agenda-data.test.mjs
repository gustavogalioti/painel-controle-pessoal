import assert from "node:assert/strict";
import { diasEntre, weekdayLabel, getAgendaPorDataText } from "./jarbas.js";

// Mock mínimo do `sql` (tagged template do @neondatabase/serverless) — só o suficiente
// pra getKvList (events_v1) devolver os eventos locais. Qualquer outra query (tokens do
// Google/Outlook) cai no fallback `[]`, o que faz getValidToken/getOutlookToken devolverem
// null e os buscadores de calendário externo nunca chamarem rede de verdade — mesmo
// padrão usado em _jarbas-diario.test.mjs.
function makeMockSql(eventsLocais) {
  const sql = (strings, ...values) => {
    const text = strings.join(" ");
    if (text.includes("SELECT value FROM sync_kv")) {
      const key = values[0];
      if (key === "events_v1") return Promise.resolve([{ value: JSON.stringify(eventsLocais) }]);
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  };
  return sql;
}

// ---------- diasEntre ----------
{
  assert.deepEqual(diasEntre("2026-10-20", "2026-10-20"), ["2026-10-20"], "um dia só");
  assert.deepEqual(diasEntre("2026-10-20", "2026-10-23"), ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"], "intervalo de 4 dias");
  assert.equal(diasEntre("2026-10-01", "2026-12-31").length, 14, "nunca passa do limite de segurança (14 dias)");
}
console.log("diasEntre: OK");

// ---------- weekdayLabel ----------
{
  // 2026-10-20 é uma terça-feira.
  assert.equal(weekdayLabel("2026-10-20"), "terça-feira");
  assert.equal(weekdayLabel("2026-10-23"), "sexta-feira");
}
console.log("weekdayLabel: OK");

// ---------- getAgendaPorDataText: um dia só, hoje, com evento local ----------
{
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const sql = makeMockSql([{ date: hoje, title: "Reunião com o time", time: "09:00" }]);
  const { texto, eventos } = await getAgendaPorDataText(sql, hoje, hoje);
  assert.ok(texto.includes("Agenda de hoje:"), `dia de hoje usa o rótulo "hoje" (texto: "${texto}")`);
  assert.ok(texto.includes("09:00 Reunião com o time"), `texto inclui o evento (texto: "${texto}")`);
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].date, hoje);
}
console.log("getAgendaPorDataText (um dia, hoje, com evento): OK");

// ---------- getAgendaPorDataText: um dia específico (não hoje), vazio ----------
{
  const sql = makeMockSql([]);
  const { texto, eventos } = await getAgendaPorDataText(sql, "2026-12-25", "2026-12-25");
  assert.ok(texto.includes("livre, nenhum compromisso"), `dia vazio -> "livre" (texto: "${texto}")`);
  assert.equal(eventos.length, 0);
}
console.log("getAgendaPorDataText (dia específico vazio): OK");

// ---------- getAgendaPorDataText: intervalo de vários dias, agrupado por dia ----------
{
  const sql = makeMockSql([
    { date: "2026-10-23", title: "CFP", time: "15:00" },
  ]);
  const { texto, eventos } = await getAgendaPorDataText(sql, "2026-10-20", "2026-10-23");
  assert.ok(texto.includes("terça-feira (20/10): livre"), `dia sem evento no intervalo -> "livre" (texto: "${texto}")`);
  assert.ok(texto.includes("sexta-feira (23/10): 15:00 CFP"), `dia com evento no intervalo (texto: "${texto}")`);
  assert.equal(eventos.length, 1, "só o evento real entra na lista estruturada");
}
console.log("getAgendaPorDataText (intervalo de dias): OK");

console.log("_jarbas-agenda-data.test.mjs: todos os testes passaram");
