// FIX-3 PARTE A: mesclarEventosDoDia — dedupe de eventos local x Google x Outlook, pra
// nunca mais listar/falar o mesmo compromisso duas vezes (bug real relatado: "10:00 —
// Reunião Jr. MH + Zezé" aparecendo duplicado no card e na tela Agenda).
import assert from "node:assert/strict";
import { mesclarEventosDoDia } from "./jarbas.js";

// ---------- local + Google com o MESMO googleId (sincronizado) -> 1 só ----------
{
  const locais = [{ date: "2026-10-20", title: "Reunião Jr. MH + Zezé", time: "10:00", googleId: "g1" }];
  const google = [{ id: "g1", title: "Reunião Jr. MH + Zezé", time: "10:00" }];
  const r = mesclarEventosDoDia(locais, google, []);
  assert.equal(r.length, 1, "não duplica quando o local já está linkado ao mesmo googleId");
  assert.equal(r[0].title, "Reunião Jr. MH + Zezé");
}
console.log("local+Google com mesmo googleId -> 1 só: OK");

// ---------- local + Google SEM googleId, mas mesma hora/título -> 1 só (defesa por conteúdo) ----------
{
  const locais = [{ date: "2026-10-20", title: "Retornar pro Sr. Oscar", time: "14:00" }]; // nunca foi linkado
  const google = [{ id: "g9", title: "Retornar pro Sr. Oscar", time: "14:00" }];
  const r = mesclarEventosDoDia(locais, google, []);
  assert.equal(r.length, 1, "dedupe por conteúdo mesmo sem id em comum");
}
console.log("local+Google sem googleId mas mesma hora/título -> 1 só: OK");

// ---------- dois eventos DIFERENTES no mesmo horário -> NÃO deduplica ----------
{
  const locais = [{ date: "2026-10-20", title: "Reunião A", time: "10:00" }];
  const google = [{ id: "g2", title: "Reunião B", time: "10:00" }];
  const r = mesclarEventosDoDia(locais, google, []);
  assert.equal(r.length, 2, "títulos diferentes no mesmo horário nunca são tratados como duplicata");
}
console.log("dois eventos diferentes no mesmo horário -> mantém os 2: OK");

// ---------- título com maiúsculas/acentos diferentes -> ainda deduplica ----------
{
  const locais = [{ date: "2026-10-20", title: "Reunião com João", time: "09:00" }];
  const google = [{ id: "g3", title: "REUNIAO COM JOAO", time: "09:00" }];
  const r = mesclarEventosDoDia(locais, google, []);
  assert.equal(r.length, 1, "normaliza maiúsculas/acentos/pontuação antes de comparar");
}
console.log("título com maiúsculas/acentos diferentes -> ainda deduplica: OK");

// ---------- Outlook: mesma lógica (outlookId + outlookAccount) ----------
{
  const locais = [{ date: "2026-10-20", title: "1:1 com o time", time: "11:00", outlookId: "o1", outlookAccount: "corporate" }];
  const outlook = [{ id: "o1", account: "corporate", title: "1:1 com o time", time: "11:00" }];
  const r = mesclarEventosDoDia(locais, [], outlook);
  assert.equal(r.length, 1, "não duplica quando o local já está linkado ao mesmo outlookId+account");
}
console.log("local+Outlook com mesmo outlookId+account -> 1 só: OK");

// ---------- Outlook: mesmo outlookId só que em conta DIFERENTE não é a mesma vinculação ----------
{
  const locais = [{ date: "2026-10-20", title: "Compromisso", time: "11:00", outlookId: "o1", outlookAccount: "personal" }];
  const outlook = [{ id: "o1", account: "corporate", title: "Compromisso", time: "11:00" }];
  // não está linkado (contas diferentes) -> passa pro passo 2 (conteúdo) -> ainda dedupe,
  // porque mesmo horário+título bate (defesa por conteúdo cobre esse caso também).
  const r = mesclarEventosDoDia(locais, [], outlook);
  assert.equal(r.length, 1, "mesmo sem o id linkado na conta certa, a defesa por conteúdo ainda pega a duplicata");
}
console.log("Outlook id igual em conta diferente, mas mesmo conteúdo -> ainda deduplica por conteúdo: OK");

// ---------- local sem nenhum vínculo e Google sem relação nenhuma -> mantém os 2 (dias normais) ----------
{
  const locais = [{ date: "2026-10-20", title: "Dentista", time: "08:00" }];
  const google = [{ id: "g4", title: "Call com fornecedor", time: "15:00" }];
  const r = mesclarEventosDoDia(locais, google, []);
  assert.equal(r.length, 2, "eventos genuinamente diferentes nunca somem");
}
console.log("eventos genuinamente diferentes (sem relação nenhuma) -> mantém os 2: OK");

// ---------- preserva o título ORIGINAL (não o normalizado) no resultado ----------
{
  const locais = [{ date: "2026-10-20", title: "Reunião com João (final)", time: "09:00" }];
  const google = [{ id: "g5", title: "REUNIAO COM JOAO (FINAL)", time: "09:00" }];
  const r = mesclarEventosDoDia(locais, google, []);
  assert.equal(r[0].title, "Reunião com João (final)", "mantém o título original da cópia local (preferida)");
}
console.log("preserva o título original ao deduplicar: OK");

// ---------- entradas vazias/ausentes nunca quebram ----------
{
  assert.deepEqual(mesclarEventosDoDia([], [], []), []);
  assert.deepEqual(mesclarEventosDoDia(null, undefined, undefined), []);
}
console.log("entradas vazias/ausentes: OK");

console.log("_jarbas-agenda-dedupe.test.mjs: todos os testes passaram");
