import assert from "node:assert/strict";
import * as L from "./daily-lib.js";
// "hoje" é o dia real: completeTask/deferTask gravam a hora atual, então datas fixas quebrariam com o tempo
const T = L.dateStr(), TM = L.addDays(T, 1), YD = L.addDays(T, -1), IN5 = L.addDays(T, 5);
const at = (day, h = 10) => { const [y, m, d] = day.split("-").map(Number); return new Date(y, m - 1, d, h, 20).toISOString(); };
const mk = (id, o = {}) => ({ id, text: "t" + id, status: "todo", done: false, date: "2026-09-01T10:00:00Z", ...o });

// bucket
assert.equal(L.bucketOf(mk(1, { status: "today" }), T), "today");
assert.equal(L.bucketOf(mk(2), T), "backlog");
assert.equal(L.bucketOf(mk(3, { plannedDate: TM }), T), "future");
assert.equal(L.bucketOf(mk(4, { plannedDate: YD }), T), "stale");
assert.equal(L.bucketOf(mk(5, { status: "standby" }), T), "standby");
assert.equal(L.bucketOf(mk(6, { inbox: true }), T), "inbox");
assert.equal(L.bucketOf(mk(6, { inbox: true, status: "today" }), T), "today"); // triada por fora (Kanban/Pedro)
assert.equal(L.bucketOf(mk(6, { inbox: true, status: "standby" }), T), "standby");
assert.equal(L.bucketOf(mk(7, { status: "done", doneAt: at(T) }), T), "today");
assert.equal(L.bucketOf(mk(8, { status: "done", doneAt: at(YD) }), T), "archive");
assert.equal(L.bucketOf({ id: 9, text: "x", done: true }, T), "archive"); // legado: só done:true, sem status/doneAt

// resumo sem divisão por zero
assert.equal(L.daySummary([], T).pct, 0);
let ts = [mk(1, { status: "today" }), mk(2, { status: "doing" }), mk(3, { status: "today" }), mk(4)];
assert.deepEqual([L.daySummary(ts, T).planned, L.daySummary(ts, T).remaining], [3, 3]);
ts = L.completeTask(ts, 1);
assert.equal(L.daySummary(ts, T).pct, 33);

// foco: máx 3, reordenar, remover
ts = [mk(1), mk(2), mk(3), mk(4)];
ts = L.setFocus(ts, 1, T); ts = L.setFocus(ts, 2, T); ts = L.setFocus(ts, 3, T);
assert.equal(L.setFocus(ts, 4, T), null);
assert.deepEqual(L.focusTasks(ts, T).map(t => t.id), [1, 2, 3]);
ts = L.moveFocus(ts, 3, -1, T);
assert.deepEqual(L.focusTasks(ts, T).map(t => t.id), [1, 3, 2]);
ts = L.reorderFocus(ts, 2, 1, T);
assert.deepEqual(L.focusTasks(ts, T).map(t => t.id), [2, 1, 3]);
ts = L.removeFocus(ts, 2, T);
assert.deepEqual(L.focusTasks(ts, T).map(t => t.id), [1, 3]);
assert.deepEqual(L.focusTasks(ts, T).map(t => t.focusOrder), [1, 2]);
assert.equal(L.focusTasks(ts, TM).length, 0); // expira no dia seguinte
assert.equal(L.getStatus(ts.find(t => t.id === 1)), "today");

// adiar preserva prazo real, registra histórico, sai do foco
ts = [mk(1, { status: "today", dueDate: `${T}T18:00`, focusDate: T, focusOrder: 1 })];
ts = L.deferTask(ts, 1, TM, T);
const d = ts[0];
assert.equal(d.dueDate, `${T}T18:00`);
assert.equal(d.plannedDate, TM); assert.equal(d.status, "todo");
assert.equal(d.deferredCount, 1); assert.equal(d.deferrals[0].to, TM); assert.equal(d.focusOrder, null);
assert.equal(L.bucketOf(d, T), "future");

// concluir/reabrir preservam doneAt
ts = L.completeTask([mk(1, { status: "today" })], 1);
const doneAtBefore = ts[0].doneAt;
ts = L.reopenTask(ts, 1, T);
assert.equal(ts[0].doneAt, doneAtBefore); assert.equal(ts[0].done, false); assert.equal(L.bucketOf(ts[0], T), "today");

// restore (desfazer exclusão)
const old = mk(9);
assert.equal(L.restoreTask([], old).length, 1);

// atenção
ts = [mk(1, { dueDate: `${YD}T10:00` }), mk(2, { dueDate: `${IN5}T10:00` }), mk(3, { status: "today", dueDate: `${YD}T10:00` })];
assert.deepEqual(L.needsAttention(ts, T).map(t => t.id), [1]);

// captura rápida
const q = L.newInboxTask({ text: " ligar ", tag: "", due: "" });
assert.equal(q.inbox, true); assert.equal(q.text, "ligar"); assert.deepEqual(q.tags, []);
assert.equal(L.newInboxTask({ text: "x", tag: "C2LZ", due: `${IN5}` }).dueDate, `${IN5}T23:59`);

// compromisso ↔ tarefa
const ev = { id: "g_abc", title: "Reunião", time: "14:00", date: T };
const et = L.newEventTask(ev, T);
assert.equal(et.eventLink.id, "g_abc"); assert.equal(et.plannedDate, T); assert.equal(L.bucketOf(et, T), "today");

// triagem: só pendentes soltos (sem tag/prazo/plano), nunca concluídas/standby/já na caixa
ts = [mk(1), mk(2, { tags: ["C2LZ"] }), mk(3, { dueDate: `${IN5}T10:00` }), mk(4, { plannedDate: TM }), mk(5, { inbox: true }),
      mk(6, { status: "standby" }), mk(7, { status: "today" }), mk(8, { status: "done", done: true }), mk(9)];
assert.deepEqual(L.untriaged(ts).map(t => t.id).sort(), [1, 9]);
const mv = L.moveToInbox(ts, [1]);
assert.equal(mv.find(t => t.id === 1).inbox, true); assert.equal(mv.find(t => t.id === 9).inbox, undefined);
assert.equal(L.bucketOf(mv.find(t => t.id === 1), T), "inbox");

// contadores por status (Kanban); concluídas = só hoje; standby fora
ts = [mk(1, { status: "now" }), mk(2, { status: "today" }), mk(3, { status: "today" }), mk(4), mk(5, { inbox: true }), mk(6, { status: "doing" }),
      mk(7, { status: "standby" }), mk(8, { status: "done", done: true, doneAt: at(T, 9) }),
      mk(9, { status: "done", done: true, doneAt: at(YD, 9) })];
assert.deepEqual(L.statusCounts(ts, T), { now: 1, today: 2, todo: 2, doing: 1, done: 1 });

// util
assert.equal(L.fmtMin(10), "10 min"); assert.equal(L.fmtMin(90), "1h30"); assert.equal(L.fmtMin(120), "2h"); assert.equal(L.fmtMin(""), "");
assert.equal(L.addDays("2026-10-31", 1), "2026-11-01"); // virada de mês com data fixa (função pura)
assert.equal(L.timerElapsedMs({ accumMs: 1000, running: true, startedAt: 5000 }, 8000), 4000);
console.log("daily-lib OK");
