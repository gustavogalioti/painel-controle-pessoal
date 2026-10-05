// Lógica pura do Daily Command Center (sem React) — fácil de testar.
// Preserva o modelo atual de tarefas (tasks_v1): status now/today/doing/todo/done/standby.
// Campos novos, todos opcionais e retrocompatíveis:
//   plannedDate  "YYYY-MM-DD"  dia em que a tarefa foi planejada (≠ dueDate, o prazo real)
//   focusDate / focusOrder     uma das 3 prioridades de um dia específico (expira sozinha)
//   estimatedMinutes, nextAction, steps[{id,text,done}]
//   inbox (bool)               capturada sem classificação
//   deferredCount, deferrals[{at,from,to}]   adiamentos (histórico)
//   doneAt                     já existia

export const MAX_FOCUS = 3;
export const ACTIVE = ["now", "today", "doing"];

const pad = n => String(n).padStart(2, "0");
export const dateStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (str, n) => { const d = new Date(str + "T12:00:00"); d.setDate(d.getDate() + n); return dateStr(d); };
export const localDay = iso => { if (!iso) return null; const d = new Date(iso); return isNaN(d.getTime()) ? null : dateStr(d); };
export const getStatus = t => t.status || (t.done ? "done" : "todo");
export const isDone = t => getStatus(t) === "done";
const nowISO = () => new Date().toISOString();

// Onde a tarefa "mora" em relação ao dia `today`.
// today | inbox | standby | future | stale | backlog | archive(concluída em outro dia)
export function bucketOf(t, today) {
  const s = getStatus(t);
  if (s === "done") return localDay(t.doneAt) === today ? "today" : "archive";
  if (t.inbox && s === "todo") return "inbox"; // movida para outra coluna = já foi triada
  if (s === "standby") return "standby";
  const pd = t.plannedDate;
  if (pd) {
    if (pd === today) return "today";
    if (pd > today) return "future";
    return ACTIVE.includes(s) ? "today" : "stale";
  }
  return ACTIVE.includes(s) ? "today" : "backlog";
}

export const isFocus = (t, today) => t.focusDate === today && Number(t.focusOrder) >= 1;

export function focusTasks(tasks, today) {
  return tasks
    .filter(t => isFocus(t, today) && bucketOf(t, today) === "today")
    .sort((a, b) => a.focusOrder - b.focusOrder)
    .slice(0, MAX_FOCUS);
}

export function daySummary(tasks, today) {
  const day = tasks.filter(t => bucketOf(t, today) === "today");
  const done = day.filter(isDone).length;
  const planned = day.length;
  return { planned, done, remaining: planned - done, pct: planned ? Math.round((done / planned) * 100) : 0, day };
}

// Atrasadas ou com prazo até hoje, mas fora do dia
export function needsAttention(tasks, today) {
  return tasks.filter(t => {
    if (isDone(t) || !t.dueDate) return false;
    const b = bucketOf(t, today);
    if (b === "today" || b === "standby" || b === "archive") return false;
    const dd = localDay(t.dueDate);
    return dd !== null && dd <= today;
  });
}

const upd = (tasks, id, fn) => tasks.map(t => (t.id === id ? fn(t) : t));
const noFocus = { focusDate: null, focusOrder: null };

// normaliza focusOrder do dia para 1..n
export function normalizeFocus(tasks, today) {
  const ids = tasks.filter(t => isFocus(t, today)).sort((a, b) => a.focusOrder - b.focusOrder).map(t => t.id);
  return tasks.map(t => (ids.includes(t.id) ? { ...t, focusOrder: ids.indexOf(t.id) + 1 } : t));
}

export function planForToday(tasks, id, today) {
  return upd(tasks, id, t => {
    const s = getStatus(t);
    return { ...t, inbox: false, plannedDate: today, status: s === "todo" || s === "standby" ? "today" : s, done: false };
  });
}

// null quando já existem 3 prioridades
export function setFocus(tasks, id, today) {
  const curAll = tasks.filter(t => isFocus(t, today) && t.id !== id && bucketOf(t, today) === "today");
  if (curAll.length >= MAX_FOCUS) return null;
  const next = planForToday(tasks, id, today);
  const order = curAll.length ? Math.max(...curAll.map(t => t.focusOrder)) + 1 : 1;
  return normalizeFocus(upd(next, id, t => ({ ...t, focusDate: today, focusOrder: order })), today);
}

export const removeFocus = (tasks, id, today) =>
  normalizeFocus(upd(tasks, id, t => ({ ...t, ...noFocus })), today);

export function moveFocus(tasks, id, dir, today) {
  const list = focusTasks(tasks, today);
  const i = list.findIndex(t => t.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return tasks;
  const order = list.map(t => t.id);
  [order[i], order[j]] = [order[j], order[i]];
  return tasks.map(t => (order.includes(t.id) ? { ...t, focusOrder: order.indexOf(t.id) + 1 } : t));
}

export function reorderFocus(tasks, fromId, toId, today) {
  const order = focusTasks(tasks, today).map(t => t.id);
  const i = order.indexOf(fromId), j = order.indexOf(toId);
  if (i < 0 || j < 0 || i === j) return tasks;
  order.splice(j, 0, order.splice(i, 1)[0]);
  return tasks.map(t => (order.includes(t.id) ? { ...t, focusOrder: order.indexOf(t.id) + 1 } : t));
}

export const startTask = (tasks, id, today) =>
  upd(tasks, id, t => ({ ...t, inbox: false, status: "doing", done: false, plannedDate: today, startedAt: t.startedAt || nowISO() }));

export const completeTask = (tasks, id) =>
  upd(tasks, id, t => ({ ...t, status: "done", done: true, doneAt: nowISO() }));

// Reabrir preserva doneAt (histórico) e volta para o dia de hoje
export const reopenTask = (tasks, id, today) =>
  upd(tasks, id, t => ({ ...t, status: "today", done: false, plannedDate: today, reopenedAt: nowISO() }));

// Adiar: muda só o planejamento — o prazo real (dueDate) continua intacto
export function deferTask(tasks, id, toDate, today) {
  return upd(tasks, id, t => {
    const s = getStatus(t);
    return {
      ...t, ...noFocus, inbox: false,
      plannedDate: toDate,
      status: ACTIVE.includes(s) ? "todo" : s,
      deferredCount: (t.deferredCount || 0) + 1,
      deferrals: [...(t.deferrals || []), { at: nowISO(), from: t.plannedDate || today, to: toDate }],
    };
  });
}

// Tira do dia sem contar como adiamento (volta para "Pendente")
export const unplanTask = (tasks, id) =>
  upd(tasks, id, t => ({ ...t, ...noFocus, plannedDate: null, status: ACTIVE.includes(getStatus(t)) ? "todo" : getStatus(t) }));

export const patchTask = (tasks, id, patch) => upd(tasks, id, t => ({ ...t, ...patch }));

export function restoreTask(tasks, old) {
  return tasks.some(t => t.id === old.id) ? tasks.map(t => (t.id === old.id ? old : t)) : [old, ...tasks];
}

export function newInboxTask({ text, tag, due }) {
  return {
    id: Date.now(), text: text.trim(), prio: "normal", status: "todo", done: false, date: nowISO(),
    notes: [], updates: [], tags: tag ? [tag] : [], dueDate: due ? `${due}T23:59` : null, inbox: true,
  };
}

export const fmtMin = m => {
  m = Number(m);
  if (!m || m < 0) return "";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h${pad(r)}` : `${h}h`;
};

// ── temporizador do Modo Foco: baseado em timestamps (sobrevive a reload/navegação) ──
export function timerElapsedMs(tm, nowMs = Date.now()) {
  if (!tm) return 0;
  return (tm.accumMs || 0) + (tm.running && tm.startedAt ? Math.max(0, nowMs - tm.startedAt) : 0);
}

// Soma de minutos de foco por hora do dia (para o tracker)
export function focusByHour(log, day) {
  const out = {};
  (log || []).forEach(e => {
    if (localDay(e.at) !== day) return;
    const h = new Date(e.at).getHours();
    out[h] = (out[h] || 0) + (Number(e.minutes) || 0);
  });
  return out;
}

// ── compromisso ↔ tarefa ──
// Vínculo leve: guarda uma cópia mínima do compromisso na tarefa (a agenda continua sendo a fonte da verdade).
export const eventLinkOf = e => ({ id: String(e.id), title: e.title, time: e.time || "", date: e.date });

export function newEventTask(e, today) {
  return {
    id: Date.now(), text: e.title, prio: "normal", status: "today", done: false, date: nowISO(),
    notes: [], updates: [], tags: [], dueDate: null, plannedDate: today, eventLink: eventLinkOf(e),
  };
}

// ── triagem de tarefas antigas ──
// Pendentes sem tag, sem prazo e sem planejamento: típicas de captura rápida (Pedro/ChatGPT) anteriores à Caixa de Entrada.
export const untriaged = tasks =>
  tasks.filter(t => getStatus(t) === "todo" && !t.inbox && !(t.tags && t.tags.length) && !t.dueDate && !t.plannedDate)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

export const moveToInbox = (tasks, ids) =>
  tasks.map(t => (ids.includes(t.id) ? { ...t, inbox: true } : t));

// Contadores do cabeçalho do Meu Dia — espelham as colunas do Kanban.
// "Concluídas" conta só as concluídas hoje (o total histórico cresce sem parar e não diz nada sobre o dia).
export function statusCounts(tasks, today) {
  const out = { now: 0, today: 0, todo: 0, doing: 0, done: 0 };
  tasks.forEach(t => {
    const s = getStatus(t);
    if (s === "done") { if (localDay(t.doneAt) === today) out.done++; }
    else if (s in out) out[s]++;
  });
  return out;
}
