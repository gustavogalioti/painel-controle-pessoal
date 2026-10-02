import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import "./daily.css";
import * as L from "./daily-lib.js";

const USER_NAME = "Gustavo";
const pad = n => String(n).padStart(2, "0");

// ─── ícones (inline, sem depender do resto do painel) ────────────────────────
const P = {
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2v2 M12 20v2 M4.93 4.93l1.41 1.41 M17.66 17.66l1.41 1.41 M2 12h2 M20 12h2 M6.34 17.66l-1.41 1.41 M19.07 4.93l-1.41 1.41",
  moon: "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z",
  phone: "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z",
  mail: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M22 6l-10 7L2 6",
  calendar: "M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z M4 9h16 M8 2v4 M16 2v4",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h5",
  check: "M20 6 9 17l-5-5",
  checkCircle: "M22 11.08V12a10 10 0 1 1-5.93-9.14 M22 4 12 14.01l-3-3",
  arrow: "M5 12h14 M12 5l7 7-7 7",
  plusCircle: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 8v8 M8 12h8",
  plus: "M12 5v14 M5 12h14",
  play: "M7 4l13 8-13 8V4z",
  pause: "M6 4h4v16H6z M14 4h4v16h-4z",
  x: "M18 6 6 18 M6 6l12 12",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2",
  up: "M18 15l-6-6-6 6",
  down: "M6 9l6 6 6-6",
  edit: "M12 20h9 M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z",
  trash: "M3 6h18 M19 6l-1 14H6L5 6 M8 6V4h8v2",
  undo: "M3 7v6h6 M3 13a9 9 0 1 0 3-7.7L3 8",
  target: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
};
const Ic = ({ d, size = 16, color = "currentColor", sw = 2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={P[d]} /></svg>
);

const TAG_STYLES = [
  { bg: "#dcecf9", fg: "#c8602a" }, { bg: "#dff5ea", fg: "#18805c" }, { bg: "#f0eafe", fg: "#6d44c4" },
  { bg: "#fff4d8", fg: "#8a5d00" }, { bg: "#e3f0fb", fg: "#1f69ae" },
];
const tagStyle = tag => { let h = 0; for (const ch of String(tag).toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return TAG_STYLES[h % TAG_STYLES.length]; };
const areaOf = t => (t.tags && t.tags[0]) || "Sem área";
const PRIO_LONG = { alta: "Prioridade alta", normal: "Prioridade normal", baixa: "Prioridade baixa" };
const PRIO_SHORT = { alta: "Alta", normal: "Normal", baixa: "Baixa" };
const STATUS_OPTS = [
  ["now", "Para Agora"], ["today", "De Hoje"], ["doing", "Em Andamento"], ["todo", "Pendente"], ["done", "Concluído"], ["standby", "Stand By"],
];
const taskIcon = text => {
  const s = (text || "").toLowerCase();
  if (/lig(ar|ue)|telefon|whats/.test(s)) return "phone";
  if (/e-?mail|respond|mensagem/.test(s)) return "mail";
  if (/agenda|reuni|marcar|compromisso/.test(s)) return "calendar";
  return "file";
};
const hhmm = iso => { const d = new Date(iso); return isNaN(d) ? "" : `${pad(d.getHours())}h${pad(d.getMinutes())}`; };
const dueLabel = (t, today) => {
  if (!t.dueDate) return null;
  const d = new Date(t.dueDate);
  if (isNaN(d)) return null;
  const day = L.dateStr(d);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (day === today) return { text: `prazo hoje ${time}`, late: d.getTime() < Date.now() };
  if (day < today) return { text: `prazo ${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`, late: true };
  return { text: `prazo ${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`, late: false };
};
const longDate = ds => new Date(ds + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
const shortDate = ds => new Date(ds + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const evText = t => (t.eventLink ? `${t.eventLink.time || "dia todo"} · ${t.eventLink.title}` : null);
const stepsInfo = t => { const s = t.steps || []; return s.length ? `${s.filter(x => x.done).length}/${s.length} passos` : null; };

// ─── blocos reutilizáveis ────────────────────────────────────────────────────
function Portal({ children }) {
  return createPortal(<div className="dcc-portal">{children}</div>, document.body);
}

function Sheet({ title, onClose, children, footer }) {
  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <Portal>
      <div className="dcc-modal-bg" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="dcc-modal" role="dialog" aria-modal="true" aria-label={title}>
          <div className="dcc-modal-head">
            <h3>{title}</h3>
            <button className="dcc-ico" onClick={onClose} aria-label="Fechar"><Ic d="x" size={18} /></button>
          </div>
          <div className="dcc-modal-body">{children}</div>
          {footer && <div className="dcc-modal-foot">{footer}</div>}
        </div>
      </div>
    </Portal>
  );
}

function TagPill({ children, tag }) {
  const s = tagStyle(tag);
  return <span className="dcc-tagpill" style={{ background: s.bg, color: s.fg }}>{children}</span>;
}

function Empty({ title, children }) {
  return <div className="dcc-empty"><b>{title}</b>{children}</div>;
}

// Captura rápida: só o texto é obrigatório; tag e prazo são opcionais
function CaptureCard({ tags, onSave, autoFocus }) {
  const [text, setText] = useState("");
  const [tag, setTag] = useState("");
  const [due, setDue] = useState("");
  const [showDue, setShowDue] = useState(false);
  const inputRef = useRef(null);
  useEffect(() => { if (autoFocus && inputRef.current) inputRef.current.focus(); }, [autoFocus]);
  const save = () => {
    if (!text.trim()) { if (inputRef.current) inputRef.current.focus(); return; }
    onSave({ text, tag, due });
    setText(""); setTag(""); setDue(""); setShowDue(false);
    if (inputRef.current) inputRef.current.focus();
  };
  return (
    <section className="dcc-capture" aria-label="Captura rápida">
      <div className="dcc-capture-head">
        <span><Ic d="plusCircle" size={18} /> Capturar tarefa</span>
        <span className="dcc-pill">Rápido</span>
      </div>
      <div className="dcc-capture-body">
        <label htmlFor="dcc-cap-text">O que você precisa fazer?</label>
        <input id="dcc-cap-text" ref={inputRef} className="dcc-cap-input" value={text} placeholder="Ex.: ligar para o cliente Bruno..."
          onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); save(); } }} />
        <div className="dcc-chips">
          <select className="dcc-chip" value={tag} onChange={e => setTag(e.target.value)} aria-label="Área ou tag (opcional)">
            <option value="">Sem tag</option>
            {tags.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          {showDue ? (
            <>
              <input type="date" className="dcc-chip" value={due} onChange={e => setDue(e.target.value)} aria-label="Prazo (opcional)" />
              <button className="dcc-chip" type="button" onClick={() => { setDue(""); setShowDue(false); }}>Sem prazo</button>
            </>
          ) : (
            <button className="dcc-chip" type="button" onClick={() => setShowDue(true)}>Sem prazo definido</button>
          )}
        </div>
        <button className="dcc-btn dcc-btn-ink" onClick={save}>Salvar na caixa de entrada</button>
      </div>
      <div className="dcc-capture-foot">Sem precisar organizar tudo na hora.</div>
    </section>
  );
}

// ─── editor de tarefa (próxima ação, estimativa, passos, planejamento) ──────
function TaskEditor({ task, tags, events, onSave, onDelete, onClose }) {
  const [d, setD] = useState(() => ({
    text: task.text || "", prio: task.prio || "normal", status: L.getStatus(task),
    tags: task.tags || [], plannedDate: task.plannedDate || "",
    dueDate: task.dueDate ? String(task.dueDate).slice(0, 16) : "",
    est: task.estimatedMinutes || "", next: task.nextAction || "", steps: task.steps || [],
    ev: task.eventLink ? task.eventLink.id : "",
  }));
  const [tagIn, setTagIn] = useState("");
  const [stepIn, setStepIn] = useState("");
  const set = (k, v) => setD(p => ({ ...p, [k]: v }));
  const addTag = tg => { const c = tg.trim(); if (c && !d.tags.some(x => x.toLowerCase() === c.toLowerCase())) set("tags", [...d.tags, c]); setTagIn(""); };
  const addStep = () => { const c = stepIn.trim(); if (!c) return; set("steps", [...d.steps, { id: Date.now() + d.steps.length, text: c, done: false }]); setStepIn(""); };
  const save = () => {
    if (!d.text.trim()) return;
    const st = d.status;
    const todayS = L.dateStr();
    const changed = st !== L.getStatus(task);
    let planned = d.plannedDate || null;
    if (changed && L.ACTIVE.includes(st) && planned && planned > todayS) planned = todayS;       // "De Hoje" → planejada para hoje
    if (changed && (st === "todo" || st === "standby") && planned === todayS) planned = null;     // saiu do dia
    onSave({
      text: d.text.trim(), prio: d.prio, tags: d.tags,
      plannedDate: planned,
      dueDate: d.dueDate || null,
      estimatedMinutes: d.est ? Math.max(1, Math.round(Number(d.est))) : null,
      nextAction: d.next.trim() || null,
      steps: d.steps,
      eventLink: !d.ev ? null : (events.find(e => String(e.id) === d.ev) ? L.eventLinkOf(events.find(e => String(e.id) === d.ev)) : task.eventLink || null),
      status: st, done: st === "done",
      ...(st === "done" && L.getStatus(task) !== "done" ? { doneAt: new Date().toISOString() } : {}),
      inbox: false,
    });
  };
  return (
    <Sheet title="Editar tarefa" onClose={onClose} footer={<>
      <button className="dcc-btn dcc-btn-danger" onClick={onDelete}><Ic d="trash" size={14} /> Excluir</button>
      <span className="dcc-spacer" style={{ flex: 1 }} />
      <button className="dcc-btn" onClick={onClose}>Cancelar</button>
      <button className="dcc-btn dcc-btn-primary" onClick={save}>Salvar</button>
    </>}>
      <div className="dcc-field">
        <label htmlFor="te-text">Tarefa</label>
        <textarea id="te-text" rows={2} value={d.text} onChange={e => set("text", e.target.value)} />
      </div>
      <div className="dcc-field">
        <label htmlFor="te-next">Próxima ação (a primeira coisa concreta a fazer)</label>
        <input id="te-next" value={d.next} onChange={e => set("next", e.target.value)} placeholder="Ex.: abrir o painel e listar os agentes conectados" />
      </div>
      <div className="dcc-item-grid">
        <div><label htmlFor="te-est">Tempo estimado (min)</label><input id="te-est" type="number" min="1" value={d.est} onChange={e => set("est", e.target.value)} /></div>
        <div><label htmlFor="te-prio">Prioridade</label>
          <select id="te-prio" value={d.prio} onChange={e => set("prio", e.target.value)}>
            <option value="alta">Alta</option><option value="normal">Normal</option><option value="baixa">Baixa</option>
          </select></div>
        <div><label htmlFor="te-status">Status</label>
          <select id="te-status" value={d.status} onChange={e => set("status", e.target.value)}>
            {STATUS_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></div>
      </div>
      <div className="dcc-item-grid">
        <div><label htmlFor="te-plan">Planejada para</label><input id="te-plan" type="date" value={d.plannedDate} onChange={e => set("plannedDate", e.target.value)} /></div>
        <div><label htmlFor="te-due">Prazo real</label><input id="te-due" type="datetime-local" value={d.dueDate} onChange={e => set("dueDate", e.target.value)} /></div>
      </div>
      <div className="dcc-sub" style={{ margin: "-4px 0 14px" }}>“Planejada para” é quando você pretende fazer; “Prazo real” é quando precisa estar pronto.</div>

      <div className="dcc-field">
        <label htmlFor="te-ev">Compromisso de hoje vinculado</label>
        <select id="te-ev" value={d.ev} onChange={e => set("ev", e.target.value)}>
          <option value="">Nenhum</option>
          {task.eventLink && !events.some(e => String(e.id) === task.eventLink.id) && <option value={task.eventLink.id}>{evText(task)} (de outro dia)</option>}
          {events.map(e => <option key={e.id} value={String(e.id)}>{e.time || "dia todo"} · {e.title}</option>)}
        </select>
      </div>

      <div className="dcc-field">
        <span className="dcc-label">Tags</span>
        <div className="dcc-chips" style={{ margin: 0 }}>
          {d.tags.map(tg => (
            <span key={tg} className="dcc-pill dcc-pill-plan">{tg}
              <button type="button" className="dcc-ico" style={{ width: 18, height: 18 }} aria-label={`Remover tag ${tg}`} onClick={() => set("tags", d.tags.filter(x => x !== tg))}><Ic d="x" size={11} /></button>
            </span>
          ))}
          <input value={tagIn} list="dcc-tag-list" onChange={e => setTagIn(e.target.value)} placeholder="+ tag" aria-label="Adicionar tag"
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag(tagIn); } }} style={{ width: 120 }} />
          <datalist id="dcc-tag-list">{tags.map(t => <option key={t} value={t} />)}</datalist>
        </div>
      </div>

      <div className="dcc-field">
        <span className="dcc-label">Passos {d.steps.length > 0 && `(${d.steps.filter(s => s.done).length}/${d.steps.length})`}</span>
        <ul className="dcc-steps">
          {d.steps.map(s => (
            <li key={s.id} className={s.done ? "is-done" : ""}>
              <input type="checkbox" checked={!!s.done} aria-label={`Passo: ${s.text}`} onChange={() => set("steps", d.steps.map(x => x.id === s.id ? { ...x, done: !x.done } : x))} />
              <span>{s.text}</span>
              <button type="button" className="dcc-ico" aria-label="Remover passo" onClick={() => set("steps", d.steps.filter(x => x.id !== s.id))}><Ic d="x" size={14} /></button>
            </li>
          ))}
        </ul>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input value={stepIn} onChange={e => setStepIn(e.target.value)} placeholder="Novo passo objetivo..." aria-label="Novo passo"
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addStep(); } }} />
          <button className="dcc-btn" type="button" onClick={addStep}>Adicionar</button>
        </div>
      </div>
    </Sheet>
  );
}

// ─── Modo Foco ───────────────────────────────────────────────────────────────
// O estado do timer (timestamps, não contagem em memória) vive em useKV("dcc_focus_timer_v1"),
// então sincroniza entre dispositivos: iniciar no PC e retomar no celular funciona.
const freshTimer = (taskId, durationMin = 25) => ({ taskId, durationMin, running: false, startedAt: null, accumMs: 0, finished: false });
const fmtClock = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };

function FocusMode({ c, startId, onClose }) {
  const { tasks, today, act } = c;
  const [taskId, setTaskId] = useState(startId);
  const stored = id => { const s = c.timerRef.current; return s && s.taskId === id ? s : null; };
  const [tm, setTm] = useState(() => stored(startId) || freshTimer(startId));
  const [now, setNow] = useState(Date.now());
  const tmRef = useRef(tm); tmRef.current = tm;
  useEffect(() => { if (JSON.stringify(tm) !== JSON.stringify(c.timerRef.current)) c.setTimer(tm); }, [tm]); // eslint-disable-line react-hooks/exhaustive-deps

  const task = tasks.find(t => t.id === taskId);
  const focusIds = L.focusTasks(tasks, today).map(t => t.id);
  const ids = focusIds.includes(taskId) ? focusIds : [taskId];
  const pos = ids.indexOf(taskId);

  const logSeg = (id, startMs, ms) => {
    if (ms < 15000) return;
    c.logFocus({ id: Date.now() + Math.random(), taskId: id, at: new Date(startMs).toISOString(), minutes: Math.round(ms / 6000) / 10 });
  };
  const pauseNow = () => {
    const cur = tmRef.current;
    if (!cur.running) return cur;
    const seg = Date.now() - cur.startedAt;
    logSeg(cur.taskId, cur.startedAt, seg);
    const next = { ...cur, running: false, startedAt: null, accumMs: cur.accumMs + seg };
    setTm(next); return next;
  };

  // tick (baseado em timestamps — recarregar a página não perde o tempo)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  const dur = tm.durationMin ? tm.durationMin * 60000 : 0;
  const elapsed = L.timerElapsedMs(tm, now);
  useEffect(() => {
    const cur = tmRef.current;
    if (cur.running && dur && L.timerElapsedMs(cur, Date.now()) >= dur) {
      logSeg(cur.taskId, cur.startedAt, dur - cur.accumMs);
      setTm({ ...cur, running: false, startedAt: null, accumMs: dur, finished: true });
    }
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const exit = () => { pauseNow(); onClose(); };
  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") exit(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!task) { return <Portal><div className="dcc-fm"><div className="dcc-fm-card"><p>Tarefa não encontrada.</p><button className="dcc-btn" onClick={onClose}>Voltar à lista</button></div></div></Portal>; }

  const start = () => {
    const cur = tmRef.current;
    if (!L.isDone(task) && L.getStatus(task) !== "doing") act.start(task.id);
    setTm(cur.finished ? { ...cur, accumMs: 0, finished: false, running: true, startedAt: Date.now() } : { ...cur, running: true, startedAt: Date.now() });
  };
  const reset = () => { pauseNow(); setTm(p => ({ ...freshTimer(p.taskId, p.durationMin) })); };
  const setDuration = m => setTm(p => ({ ...p, durationMin: m, finished: false }));
  const goto = id => { const cur = pauseNow(); setTaskId(id); setTm(stored(id) || freshTimer(id, cur.durationMin)); };
  const complete = () => {
    pauseNow();
    act.complete(task.id);
    const nextId = ids.find(i => i !== task.id && !L.isDone(tasks.find(t => t.id === i) || { done: true }));
    if (nextId) goto(nextId); else onClose();
  };
  const toggleStep = sid => c.patch(task.id, { steps: (task.steps || []).map(s => s.id === sid ? { ...s, done: !s.done } : s) });
  const remaining = dur ? dur - elapsed : null;
  const showMs = dur ? Math.max(0, remaining) : elapsed;

  return (
    <Portal>
      <div className="dcc-fm" role="dialog" aria-modal="true" aria-label="Modo foco">
        <div className="dcc-fm-card">
          <div className="dcc-fm-kicker">
            <button className="dcc-ico" onClick={() => pos > 0 && goto(ids[pos - 1])} disabled={pos <= 0} aria-label="Tarefa anterior"><Ic d="up" size={16} /></button>
            <span>MODO FOCO · TAREFA {pos + 1} DE {ids.length}</span>
            <button className="dcc-ico" onClick={() => pos < ids.length - 1 && goto(ids[pos + 1])} disabled={pos >= ids.length - 1} aria-label="Próxima tarefa"><Ic d="down" size={16} /></button>
          </div>
          <h1>{task.text}</h1>
          <div className="dcc-fm-sub">{areaOf(task)} · {PRIO_LONG[task.prio] || "Prioridade normal"}{task.estimatedMinutes ? ` · ${L.fmtMin(task.estimatedMinutes)} estimados` : ""}</div>

          <div className="dcc-fm-timer" role="timer" aria-live="off">{fmtClock(showMs)}</div>
          <div className="dcc-fm-msg" aria-live="polite">
            {tm.finished ? "Bloco concluído. Bom trabalho." : tm.running ? "Em foco…" : (dur ? "Bloco de concentração" : "Sem limite de tempo")}
          </div>
          <div className="dcc-fm-dur" role="group" aria-label="Duração do bloco">
            {[15, 25, 45, 60].map(m => <button key={m} aria-pressed={tm.durationMin === m} onClick={() => setDuration(m)} disabled={tm.running}>{m} min</button>)}
            <button aria-pressed={!tm.durationMin} onClick={() => setDuration(0)} disabled={tm.running}>Sem timer</button>
          </div>

          <div className="dcc-fm-nextbox">
            <b>Próxima ação:</b> {task.nextAction || <span className="dcc-sub">não definida — <button className="dcc-btn" style={{ padding: "2px 8px" }} onClick={() => { exit(); c.setEditId(task.id); }}>definir agora</button></span>}
          </div>
          {(task.steps || []).length > 0 && (
            <ul className="dcc-steps" aria-label="Passos">
              {task.steps.map(s => (
                <li key={s.id} className={s.done ? "is-done" : ""}>
                  <input type="checkbox" checked={!!s.done} onChange={() => toggleStep(s.id)} aria-label={`Passo: ${s.text}`} /> <span>{s.text}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="dcc-fm-ctrl">
            {tm.running
              ? <button className="dcc-btn dcc-btn-primary" onClick={pauseNow}><Ic d="pause" size={14} /> Pausar</button>
              : <button className="dcc-btn dcc-btn-primary" onClick={start} disabled={L.isDone(task)}><Ic d="play" size={14} /> {elapsed > 0 && !tm.finished ? "Retomar" : "Iniciar"}</button>}
            <button className="dcc-btn" onClick={reset}><Ic d="undo" size={14} /> Reiniciar</button>
            <button className="dcc-btn" style={{ color: "var(--d-ok)", borderColor: "#bfe6d6" }} onClick={complete} disabled={L.isDone(task)}><Ic d="check" size={14} /> Concluir tarefa</button>
          </div>
          <div style={{ marginTop: 18 }}>
            <button className="dcc-btn dcc-btn-ghost" onClick={exit}>Voltar à lista</button>
          </div>
          <div className="dcc-sub" style={{ marginTop: 10 }}>O temporizador é opcional. Sair do modo foco pausa o tempo e não altera sua tarefa.</div>
        </div>
      </div>
    </Portal>
  );
}

// ─── Agenda: compromissos locais + Google + Outlook (pessoal/corporativo) ───
// Usa os mesmos endpoints e conversores da aba Agenda. Só busca fontes conectadas.
function useAgenda(today, localEvents, ui) {
  const [remote, setRemote] = useState({ events: [], status: {}, errors: {}, loading: true });
  const alive = useRef(true);
  const uiRef = useRef(ui); uiRef.current = ui;
  const load = useCallback(async () => {
    const { fromGoogleEvent, fromOutlookEvent } = uiRef.current;
    const range = new URLSearchParams({
      timeMin: new Date(`${today}T00:00:00`).toISOString(),
      timeMax: new Date(`${L.addDays(today, 1)}T00:00:00`).toISOString(),
    });
    const sources = [
      { key: "google", base: "/api/google-calendar", extra: "", map: fromGoogleEvent },
      { key: "personal", base: "/api/outlook-calendar", extra: "account=personal&", map: o => fromOutlookEvent(o, "personal") },
      { key: "corporate", base: "/api/outlook-calendar", extra: "account=corporate&", map: o => fromOutlookEvent(o, "corporate") },
    ];
    const results = await Promise.all(sources.map(async src => {
      try {
        const st = await fetch(`${src.base}?${src.extra}action=status`);
        if (!st.ok) throw new Error("status");
        const { connected } = await st.json();
        if (!connected) return { key: src.key, connected: false, events: [] };
        const r = await fetch(`${src.base}?${src.extra}${range}`);
        if (!r.ok) throw new Error("events");
        const items = await r.json();
        return { key: src.key, connected: true, events: (Array.isArray(items) ? items : []).map(src.map).filter(e => e.date === today) };
      } catch { return { key: src.key, connected: null, events: [], error: true }; }
    }));
    if (!alive.current) return;
    setRemote({
      events: results.flatMap(r => r.events),
      status: Object.fromEntries(results.map(r => [r.key, r.connected])),
      errors: Object.fromEntries(results.filter(r => r.error).map(r => [r.key, true])),
      loading: false,
    });
  }, [today]);
  useEffect(() => {
    alive.current = true;
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 10 * 60 * 1000);
    return () => { alive.current = false; clearInterval(id); };
  }, [load]);

  const local = (Array.isArray(localEvents) ? localEvents : []).filter(e => e.date === today);
  const linked = new Set(local.flatMap(e => [e.googleId, e.outlookId]).filter(Boolean));
  const merged = [...local, ...remote.events.filter(e => !linked.has(e.googleId || e.outlookId))]
    .sort((a, b) => (a.time || "99").localeCompare(b.time || "99"));
  return { events: merged, status: remote.status, errors: remote.errors, loading: remote.loading, refresh: load };
}

const SRC_LABEL = { google: "Google", personal: "Outlook Pessoal", corporate: "Outlook Corporativo" };
const evBadge = e => e.source === "google" ? "G" : e.source === "outlook" ? (e.outlookAccount === "corporate" ? "OC" : "OP") : null;

// ─── Meu Dia ─────────────────────────────────────────────────────────────────
function Hero({ c }) {
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const { planned, done, remaining, pct } = c.summary;
  const evs = c.agenda.events;
  const tmr = c.timer || {};
  const tmTask = tmr.taskId && (tmr.running || (tmr.accumMs > 0 && !tmr.finished)) ? c.tasks.find(t => t.id === tmr.taskId && !L.isDone(t)) : null;
  const nextEv = evs.find(e => !e.time || new Date(`${c.today}T${e.time}`) >= new Date());
  const hint = c.prevNote;
  return (
    <section className="dcc-hero" aria-label="Resumo do dia">
      <div className="dcc-hero-top">
        <div>
          <div className="dcc-date">{longDate(c.today)}</div>
          <div className="dcc-hello">{hello}, {USER_NAME}.</div>
          <div className="dcc-sub">Vamos organizar o que realmente importa hoje.</div>
        </div>
        <div className="dcc-sun" aria-hidden="true"><Ic d={hour >= 18 || hour < 5 ? "moon" : "sun"} size={26} /></div>
      </div>
      <hr />
      <div className="dcc-stats">
        <div className="dcc-stat"><b style={{ color: "#2272c3" }}>{pad(planned)}</b><span>Planejadas</span></div>
        <div className="dcc-stat"><b style={{ color: "var(--d-ok)" }}>{pad(done)}</b><span>Concluídas</span></div>
        <div className="dcc-stat"><b style={{ color: "#c8940f" }}>{pad(remaining)}</b><span>Restantes</span></div>
      </div>
      <div className="dcc-progress-row"><span id="dcc-prog-l">Progresso do dia</span><span>{pct}%</span></div>
      <div className="dcc-bar" role="progressbar" aria-labelledby="dcc-prog-l" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${pct}%` }} /></div>

      {planned === 0 && <div className="dcc-note">Nenhuma tarefa planejada para hoje ainda. Escolha o que importa em <b>Planejar meu dia</b> ou capture algo rápido abaixo.</div>}
      {planned > 0 && remaining === 0 && <div className="dcc-note">Você concluiu o que planejou para hoje. Se quiser, revise o que ficou para amanhã.</div>}
      {hint && <div className="dcc-note"><b>Deixado de ontem:</b> {hint}</div>}
      {evs.length > 0 && <div className="dcc-note"><Ic d="calendar" size={13} /> {evs.length} compromisso{evs.length > 1 ? "s" : ""} hoje{nextEv ? ` · próximo: ${nextEv.time ? nextEv.time + " " : ""}${nextEv.title}` : ""}</div>}
      {tmTask && (
        <div className="dcc-note" style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          <span><Ic d="clock" size={13} /> Timer {tmr.running ? "rodando" : "pausado"}: <b>{tmTask.text}</b> · {fmtClock(L.timerElapsedMs(tmr))} decorridos</span>
          <button className="dcc-btn dcc-btn-primary" onClick={() => c.setFocusOn(tmTask.id)}>Retomar modo foco</button>
        </div>
      )}

      <div className="dcc-rituals">
        <button className="dcc-btn dcc-btn-primary" onClick={() => c.setRitual("plan")}>{planned ? "Replanejar meu dia" : "Planejar meu dia"}</button>
        <button className="dcc-btn" onClick={() => c.setRitual("review")}>Revisar meu dia</button>
        <button className="dcc-btn" onClick={() => c.setRitual("close")}>Encerrar meu dia</button>
      </div>
    </section>
  );
}

function FocusCard({ c, t, index, active, drag }) {
  const done = L.isDone(t);
  const area = areaOf(t);
  const steps = stepsInfo(t);
  const doing = L.getStatus(t) === "doing";
  const cls = `dcc-focus-card${done ? " is-done" : active ? " is-active" : " is-muted"}${drag.over === t.id ? " is-dragover" : ""}`;
  const dragProps = done ? {} : {
    draggable: true,
    onDragStart: e => { drag.set(t.id); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", String(t.id)); } catch { /* ok */ } },
    onDragOver: e => { e.preventDefault(); drag.setOver(t.id); },
    onDragLeave: () => drag.setOver(null),
    onDrop: e => { e.preventDefault(); drag.drop(t.id); },
    onDragEnd: () => { drag.set(null); drag.setOver(null); },
  };
  return (
    <article className={cls} {...dragProps} aria-label={`Prioridade ${index + 1}: ${t.text}`}>
      <div className="dcc-row-top">
        <TagPill tag={area}>{pad(index + 1)} · {area}</TagPill>
        {done
          ? <span style={{ color: "var(--d-ok)" }} role="img" aria-label="Concluída"><Ic d="checkCircle" size={22} /></span>
          : t.estimatedMinutes ? <span className="dcc-time">{L.fmtMin(t.estimatedMinutes)}</span> : null}
      </div>
      <div className="dcc-title"><button onClick={() => c.setEditId(t.id)}>{t.text}</button></div>
      {evText(t) && <div className="dcc-li-meta" style={{ marginBottom: 4 }}><Ic d="calendar" size={12} /> {evText(t)}</div>}
      {done ? (
        <div className="dcc-next">Concluída às {hhmm(t.doneAt)}. <button className="dcc-btn" style={{ padding: "2px 9px", marginLeft: 6 }} onClick={() => c.act.reopen(t.id)}>Reabrir</button></div>
      ) : (
        <>
          <div className="dcc-next">
            {t.nextAction ? <>Próxima ação: {t.nextAction}</> : <button className="dcc-btn" style={{ padding: "2px 9px" }} onClick={() => c.setEditId(t.id)}>+ Definir próxima ação</button>}
            {steps && <span className="dcc-steps-mini"> · {steps}</span>}
          </div>
          <div className="dcc-meta-row">
            <span>{PRIO_LONG[t.prio] || "Prioridade normal"}</span>
            <span className={`dcc-pill ${doing ? "dcc-pill-doing" : "dcc-pill-plan"}`}>{doing ? "Em execução" : "Planejada"}</span>
          </div>
          {active
            ? <button className="dcc-btn dcc-btn-ink" onClick={() => { c.act.start(t.id); c.setFocusOn(t.id); }}>{doing ? "Continuar tarefa" : "Iniciar tarefa"} <Ic d="arrow" size={15} /></button>
            : <button className="dcc-btn dcc-btn-ghost" onClick={() => c.setEditId(t.id)}>Ver próximos passos</button>}
          <div className="dcc-actions">
            {!active && <button className="dcc-ico" title="Iniciar" aria-label="Iniciar tarefa" onClick={() => { c.act.start(t.id); c.setFocusOn(t.id); }}><Ic d="play" size={14} /></button>}
            <button className="dcc-ico" title="Concluir" aria-label="Concluir tarefa" onClick={() => c.act.complete(t.id)}><Ic d="check" size={15} /></button>
            <button className="dcc-ico" title="Mover para cima" aria-label="Mover para cima" disabled={index === 0} onClick={() => c.act.moveFocus(t.id, -1)}><Ic d="up" size={15} /></button>
            <button className="dcc-ico" title="Mover para baixo" aria-label="Mover para baixo" disabled={index >= c.focus.length - 1} onClick={() => c.act.moveFocus(t.id, 1)}><Ic d="down" size={15} /></button>
            <button className="dcc-ico" title="Adiar para amanhã" aria-label="Adiar para amanhã" onClick={() => c.act.defer(t.id, L.addDays(c.today, 1))}><Ic d="calendar" size={14} /></button>
            <button className="dcc-ico" title="Tirar do foco" aria-label="Tirar do foco de hoje" onClick={() => c.act.focusRemove(t.id)}><Ic d="x" size={15} /></button>
          </div>
        </>
      )}
    </article>
  );
}

function FocusSection({ c }) {
  const list = c.focus;
  const doneN = list.filter(L.isDone).length;
  const active = list.find(t => !L.isDone(t) && L.getStatus(t) === "doing") || list.find(t => !L.isDone(t));
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);
  const drag = { set: setDragId, setOver, over, drop: toId => { if (dragId && dragId !== toId) c.act.reorderFocus(dragId, toId); setDragId(null); setOver(null); } };
  const free = L.MAX_FOCUS - list.length;
  return (
    <section className="dcc-card" aria-labelledby="dcc-focus-h">
      <div className="dcc-sec-head">
        <h2 id="dcc-focus-h">Meu foco de hoje</h2>
        {list.length > 0 && <span className="dcc-pill dcc-pill-count">{pad(doneN)}/{pad(list.length)} concluídas</span>}
      </div>
      <div className="dcc-sub">{list.length ? "As entregas que você escolheu como mais importantes." : "Escolha até três entregas que realmente importam hoje. Você decide — o painel não escolhe por você."}</div>
      {list.map((t, i) => <FocusCard key={t.id} c={c} t={t} index={i} active={active && active.id === t.id} drag={drag} />)}
      {Array.from({ length: free }).map((_, i) => (
        <button key={i} className="dcc-slot" onClick={() => c.setPicker(true)}>
          <span>{pad(list.length + i + 1)} · Escolher uma prioridade</span><Ic d="plusCircle" size={18} />
        </button>
      ))}
      {list.length > 1 && <div className="dcc-sub" style={{ marginTop: 10 }}>Dica: arraste os cartões ou use as setas para reordenar.</div>}
    </section>
  );
}

const SORTS = { padrao: "Ordem padrão", prio: "Prioridade", tempo: "Menor tempo", recentes: "Mais recentes" };
const PRIO_RANK = { alta: 0, normal: 1, baixa: 2 };
function sortActions(items, mode, today) {
  const base = [...items].sort((a, b) => {
    const da = a.dueDate && L.localDay(a.dueDate) <= today ? a.dueDate : "9";
    const db = b.dueDate && L.localDay(b.dueDate) <= today ? b.dueDate : "9";
    if (da !== db) return da < db ? -1 : 1;
    return new Date(a.date) - new Date(b.date);
  });
  if (mode === "prio") return base.sort((a, b) => (PRIO_RANK[a.prio] ?? 1) - (PRIO_RANK[b.prio] ?? 1));
  if (mode === "tempo") return base.sort((a, b) => (a.estimatedMinutes || 9999) - (b.estimatedMinutes || 9999));
  if (mode === "recentes") return [...items].sort((a, b) => new Date(b.date) - new Date(a.date));
  return base;
}

function ActionRow({ c, t, right }) {
  const due = dueLabel(t, c.today);
  const meta = [areaOf(t), t.estimatedMinutes ? L.fmtMin(t.estimatedMinutes) : null, evText(t) ? `🗓 ${evText(t)}` : null].filter(Boolean).join(" · ");
  return (
    <div className="dcc-li">
      <span className="dcc-li-ico"><Ic d={taskIcon(t.text)} size={19} /></span>
      <div className="dcc-li-main">
        <div className="dcc-li-title"><button onClick={() => c.setEditId(t.id)}>{t.text}</button></div>
        <div className="dcc-li-meta">{meta}{due && <> · <span className={due.late ? "dcc-due-late" : ""}>{due.text}{due.late ? " (atenção)" : ""}</span></>}</div>
      </div>
      <div className="dcc-li-right">{right}</div>
    </div>
  );
}

function NextActions({ c }) {
  const [expanded, setExpanded] = useState(false);
  const focusIds = c.focus.map(t => t.id);
  const items = sortActions(c.summary.day.filter(t => !L.isDone(t) && !focusIds.includes(t.id)), c.sort, c.today);
  const shown = expanded ? items : items.slice(0, 4);
  return (
    <section className="dcc-card" aria-labelledby="dcc-next-h">
      <div className="dcc-sec-head">
        <h2 id="dcc-next-h">Próximas ações</h2>
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {items.length > 1 && (
            <select className="dcc-sort" value={c.sort} onChange={e => c.setSort(e.target.value)} aria-label="Ordenar próximas ações">
              {Object.entries(SORTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          )}
          <span className="dcc-pill dcc-pill-neutral">{items.length} {items.length === 1 ? "tarefa" : "tarefas"}</span>
        </span>
      </div>
      {items.length === 0 ? (
        <Empty title={c.summary.planned > 0 ? "Fila de ações vazia." : "Nada planejado para hoje."}>
          {c.summary.planned > 0 ? "O que sobrou do dia está no seu foco, ou já foi concluído." : "Use “Planejar meu dia” para trazer tarefas para hoje."}
        </Empty>
      ) : (
        <div className="dcc-list">
          {shown.map(t => (
            <ActionRow key={t.id} c={c} t={t} right={<>
              <span className={`dcc-pill ${t.prio === "alta" ? "dcc-pill-alta" : "dcc-pill-neutral"}`}>{PRIO_SHORT[t.prio] || "Normal"}</span>
              <button className="dcc-ico" title="Iniciar" aria-label={`Iniciar: ${t.text}`} onClick={() => { c.act.start(t.id); c.setFocusOn(t.id); }}><Ic d="play" size={14} /></button>
              <button className="dcc-ico" title="Concluir" aria-label={`Concluir: ${t.text}`} onClick={() => c.act.complete(t.id)}><Ic d="check" size={16} /></button>
              <button className="dcc-ico" title="Adiar para amanhã" aria-label={`Adiar para amanhã: ${t.text}`} onClick={() => c.act.defer(t.id, L.addDays(c.today, 1))}><Ic d="calendar" size={15} /></button>
            </>} />
          ))}
        </div>
      )}
      {items.length > 4 && (
        <button className="dcc-btn dcc-btn-ghost" onClick={() => setExpanded(e => !e)}>{expanded ? "Mostrar menos" : `Explorar todas as ações (${items.length})`}</button>
      )}
    </section>
  );
}

function Attention({ c }) {
  const items = L.needsAttention(c.tasks, c.today);
  if (!items.length) return null;
  return (
    <section className="dcc-card dcc-attn" aria-labelledby="dcc-attn-h">
      <div className="dcc-sec-head"><h2 id="dcc-attn-h">Precisam de atenção</h2><span className="dcc-pill dcc-pill-neutral">{items.length}</span></div>
      <div className="dcc-sub">Atrasadas ou com prazo hoje, fora do seu dia. Traga para hoje ou replaneje — sem culpa.</div>
      <div className="dcc-list">
        {items.slice(0, 6).map(t => (
          <ActionRow key={t.id} c={c} t={t} right={<>
            <button className="dcc-btn" onClick={() => c.act.plan(t.id)}>Trazer para hoje</button>
            <button className="dcc-btn" onClick={() => c.act.defer(t.id, L.addDays(c.today, 1))}>Amanhã</button>
          </>} />
        ))}
      </div>
      {items.length > 6 && <div className="dcc-sub" style={{ marginTop: 8 }}>+ {items.length - 6} em “Histórico → pendências antigas” ou “Todas as Tarefas”.</div>}
    </section>
  );
}

function DayView({ c }) {
  return (
    <>
      <Hero c={c} />
      <FocusSection c={c} />
      <NextActions c={c} />
      <Attention c={c} />
      <CaptureCard tags={c.allTags} onSave={c.act.capture} />
    </>
  );
}

// ─── Caixa de Entrada ────────────────────────────────────────────────────────
function InboxItem({ c, t }) {
  const [text, setText] = useState(t.text);
  const [tag, setTag] = useState("");
  const [date, setDate] = useState("");
  const tmr = L.addDays(c.today, 1);
  const commitText = () => { const v = text.trim(); if (v && v !== t.text) c.patch(t.id, { text: v }); else setText(t.text); };
  const addTag = () => { const v = tag.trim(); if (v && !(t.tags || []).some(x => x.toLowerCase() === v.toLowerCase())) c.patch(t.id, { tags: [...(t.tags || []), v] }); setTag(""); };
  return (
    <div className="dcc-item">
      <input value={text} onChange={e => setText(e.target.value)} onBlur={commitText} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} aria-label="Título da tarefa" style={{ fontWeight: 600 }} />
      <div className="dcc-item-grid">
        <div>
          <label>Área / tag</label>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 4 }}>
            {(t.tags || []).map(x => <span key={x} className="dcc-pill dcc-pill-plan">{x}
              <button className="dcc-ico" style={{ width: 16, height: 16 }} aria-label={`Remover tag ${x}`} onClick={() => c.patch(t.id, { tags: t.tags.filter(y => y !== x) })}><Ic d="x" size={10} /></button></span>)}
          </div>
          <input value={tag} list="dcc-tag-list-inbox" onChange={e => setTag(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }} onBlur={addTag} placeholder="+ tag" aria-label="Adicionar tag" />
          <datalist id="dcc-tag-list-inbox">{c.allTags.map(x => <option key={x} value={x} />)}</datalist>
        </div>
        <div>
          <label>Prioridade</label>
          <select value={t.prio || "normal"} onChange={e => c.patch(t.id, { prio: e.target.value })}>
            <option value="alta">Alta</option><option value="normal">Normal</option><option value="baixa">Baixa</option>
          </select>
        </div>
        <div>
          <label>Prazo real</label>
          <input type="date" value={t.dueDate ? String(t.dueDate).slice(0, 10) : ""} onChange={e => c.patch(t.id, { dueDate: e.target.value ? `${e.target.value}T23:59` : null })} />
        </div>
        <div>
          <label>Agendar para</label>
          <input type="date" value={date} min={tmr} onChange={e => setDate(e.target.value)} />
        </div>
      </div>
      <div className="dcc-btn-row">
        <button className="dcc-btn dcc-btn-primary" onClick={() => c.act.plan(t.id)}>Para hoje</button>
        <button className="dcc-btn" onClick={() => c.act.focusAdd(t.id)}><Ic d="target" size={14} /> Foco de hoje</button>
        <button className="dcc-btn" disabled={!date} onClick={() => c.act.defer(t.id, date)}>Agendar</button>
        <button className="dcc-btn" onClick={() => c.act.organize(t.id)}>Organizado (sem data)</button>
        <button className="dcc-btn" onClick={() => c.act.archive(t.id)}>Arquivar (Stand By)</button>
        <button className="dcc-btn dcc-btn-danger" onClick={() => c.act.remove(t.id)}><Ic d="trash" size={14} /> Excluir</button>
      </div>
    </div>
  );
}

// Triagem opt-in: traz pendências soltas antigas (ex.: criadas pelo Pedro/ChatGPT antes da Caixa) para a Caixa de Entrada
function TriageModal({ c, onClose }) {
  const list = useMemo(() => L.untriaged(c.tasks), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [sel, setSel] = useState(() => new Set(list.map(t => t.id)));
  const toggle = id => setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <Sheet title="Triagem de tarefas antigas" onClose={onClose} footer={<>
      <button className="dcc-btn" onClick={onClose}>Cancelar</button>
      <button className="dcc-btn dcc-btn-primary" disabled={sel.size === 0} onClick={() => { c.act.moveToInbox([...sel]); onClose(); }}>Mover {sel.size} para a Caixa de Entrada</button>
    </>}>
      <div className="dcc-sub" style={{ marginBottom: 10 }}>Pendências sem tag, sem prazo e sem planejamento. Nada é apagado ou alterado além de ir para a Caixa — de lá você decide uma a uma. Desmarque o que quiser deixar onde está.</div>
      <div className="dcc-btn-row" style={{ marginBottom: 8 }}>
        <button className="dcc-btn" onClick={() => setSel(new Set(list.map(t => t.id)))}>Marcar todas</button>
        <button className="dcc-btn" onClick={() => setSel(new Set())}>Desmarcar todas</button>
      </div>
      {list.map(t => (
        <label key={t.id} className="dcc-plan-row" style={{ display: "flex", gap: 10, alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={sel.has(t.id)} onChange={() => toggle(t.id)} />
          <span style={{ flex: 1 }}>{t.text}<span className="dcc-sub"> · criada em {shortDate(L.localDay(t.date))}</span></span>
        </label>
      ))}
    </Sheet>
  );
}

function InboxView({ c }) {
  const items = c.tasks.filter(t => L.bucketOf(t, c.today) === "inbox").sort((a, b) => new Date(b.date) - new Date(a.date));
  const loose = L.untriaged(c.tasks).length;
  const [triage, setTriage] = useState(false);
  return (
    <>
      <CaptureCard tags={c.allTags} onSave={c.act.capture} />
      {loose > 0 && (
        <div className="dcc-card" style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          <span><b>{loose} {loose === 1 ? "pendência solta" : "pendências soltas"}</b> <span className="dcc-sub">(sem tag, prazo ou plano) em “Todas as Tarefas”.</span></span>
          <button className="dcc-btn" onClick={() => setTriage(true)}>Triar tarefas antigas</button>
        </div>
      )}
      {triage && <TriageModal c={c} onClose={() => setTriage(false)} />}
      <div className="dcc-sec-head"><h2 style={{ fontSize: 18, color: "var(--d-navy)", margin: 0 }}>A organizar</h2><span className="dcc-pill dcc-pill-neutral">{items.length}</span></div>
      <div className="dcc-sub" style={{ marginBottom: 12 }}>Capture agora, decida depois: para hoje, outro dia, ou arquive.</div>
      {items.length === 0
        ? <div className="dcc-card"><Empty title="Caixa de entrada vazia.">Tudo organizado por aqui.</Empty></div>
        : items.map(t => <InboxItem key={t.id} c={c} t={t} />)}
    </>
  );
}

// ─── Próximos Dias ───────────────────────────────────────────────────────────
function FutureRow({ c, t, label }) {
  const due = dueLabel(t, c.today);
  return (
    <div className="dcc-item" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 180 }}>
        <div className="dcc-li-title"><button onClick={() => c.setEditId(t.id)}>{t.text}</button></div>
        <div className="dcc-li-meta">{[areaOf(t), t.estimatedMinutes ? L.fmtMin(t.estimatedMinutes) : null, PRIO_SHORT[t.prio]].filter(Boolean).join(" · ")}{due && <> · <span className={due.late ? "dcc-due-late" : ""}>{due.text}</span></>}{label && <> · {label}</>}</div>
      </div>
      <input type="date" value={t.plannedDate || ""} min={L.addDays(c.today, 1)} aria-label={`Reagendar: ${t.text}`} style={{ width: 150 }}
        onChange={e => e.target.value && c.act.defer(t.id, e.target.value)} />
      <button className="dcc-btn" onClick={() => c.act.plan(t.id)}>Trazer para hoje</button>
    </div>
  );
}

function UpcomingView({ c }) {
  const future = c.tasks.filter(t => L.bucketOf(t, c.today) === "future");
  const groups = {};
  future.forEach(t => { (groups[t.plannedDate] = groups[t.plannedDate] || []).push(t); });
  const days = Object.keys(groups).sort();
  const dueSoon = c.tasks.filter(t => ["backlog", "stale"].includes(L.bucketOf(t, c.today)) && t.dueDate && L.localDay(t.dueDate) > c.today)
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  const tmr = L.addDays(c.today, 1);
  const label = d => d === tmr ? `Amanhã · ${shortDate(d)}` : longDate(d);
  return (
    <>
      <div className="dcc-card" style={{ marginBottom: 6 }}>
        <div className="dcc-sec-head"><h2>Próximos dias</h2><span className="dcc-pill dcc-pill-neutral">{future.length} planejadas</span></div>
        <div className="dcc-sub">Tarefas planejadas para outros dias. Reagende pela data ou traga para hoje.</div>
      </div>
      {days.length === 0 && <div className="dcc-card"><Empty title="Nada planejado para os próximos dias.">Use “Adiar para amanhã” ou “Agendar” para distribuir sua semana.</Empty></div>}
      {days.map(d => (
        <div key={d}>
          <div className="dcc-group-title"><span>{label(d)}</span><span>{groups[d].length}</span></div>
          {groups[d].map(t => <FutureRow key={t.id} c={c} t={t} />)}
        </div>
      ))}
      {dueSoon.length > 0 && (
        <>
          <div className="dcc-group-title"><span>Prazos chegando (sem dia planejado)</span><span>{dueSoon.length}</span></div>
          {dueSoon.slice(0, 15).map(t => <FutureRow key={t.id} c={c} t={t} />)}
        </>
      )}
    </>
  );
}

// ─── Histórico e Produtividade ───────────────────────────────────────────────
function HistoryView({ c }) {
  const [week, setWeek] = useState(0);
  const end = L.addDays(c.today, week * 7);
  const days = Array.from({ length: 7 }, (_, i) => L.addDays(end, i - 6));
  const doneBy = d => c.tasks.filter(t => L.isDone(t) && L.localDay(t.doneAt) === d);
  const deferrals = c.tasks.flatMap(t => (t.deferrals || []).map(x => ({ ...x, task: t })));
  const deferBy = d => deferrals.filter(x => L.localDay(x.at) === d);
  const plannedBy = d => c.reviews[d] && c.reviews[d].plannedCount;
  const maxV = Math.max(1, ...days.flatMap(d => [doneBy(d).length, plannedBy(d) || 0]));
  const totalDone = days.reduce((s, d) => s + doneBy(d).length, 0);
  const weekDefers = days.flatMap(d => deferBy(d));
  const old = c.tasks.filter(t => {
    const b = L.bucketOf(t, c.today);
    return b === "stale" || (b === "backlog" && (Date.now() - new Date(t.date).getTime()) > 14 * 86400000);
  }).sort((a, b) => new Date(a.date) - new Date(b.date));
  const reviewsList = Object.keys(c.reviews).sort().reverse().slice(0, 5);
  const byHour = L.focusByHour(c.focusLog, c.today);
  const hours = Array.from({ length: 13 }, (_, i) => i + 8);
  const totalFocus = Object.values(byHour).reduce((s, v) => s + v, 0);
  return (
    <>
      <div className="dcc-card">
        <div className="dcc-sec-head">
          <h2>Semana</h2>
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button className="dcc-btn" onClick={() => setWeek(w => w - 1)} aria-label="Semana anterior">←</button>
            <span className="dcc-sub">{shortDate(days[0])} – {shortDate(days[6])}</span>
            <button className="dcc-btn" onClick={() => setWeek(w => Math.min(0, w + 1))} disabled={week >= 0} aria-label="Próxima semana">→</button>
          </span>
        </div>
        <div className="dcc-sub">{totalDone} {totalDone === 1 ? "tarefa concluída" : "tarefas concluídas"} · {weekDefers.length} {weekDefers.length === 1 ? "adiamento" : "adiamentos"}. Use para ajustar o planejamento, não para se cobrar.</div>
        <div className="dcc-week" role="img" aria-label={`Concluídas por dia: ${days.map(d => `${shortDate(d)} ${doneBy(d).length}`).join(", ")}`}>
          {days.map(d => {
            const dn = doneBy(d).length, pl = plannedBy(d);
            return (
              <div className="dcc-week-col" key={d}>
                <div className="dcc-week-bars">
                  <i title={pl != null ? `Planejadas: ${pl}` : "Sem registro de planejamento"} style={{ height: `${((pl || 0) / maxV) * 100}%`, background: "#c9dceb", minHeight: pl ? 3 : 0 }} />
                  <i title={`Concluídas: ${dn}`} style={{ height: `${(dn / maxV) * 100}%`, background: "var(--d-ok)", minHeight: dn ? 3 : 0 }} />
                </div>
                <span>{dn}{pl != null ? `/${pl}` : ""}</span>
                <span style={{ fontWeight: d === c.today ? 700 : 400, color: d === c.today ? "var(--d-navy)" : undefined }}>{new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "")}</span>
              </div>
            );
          })}
        </div>
        <div className="dcc-legend"><span><i style={{ background: "#c9dceb" }} />Planejadas (registradas ao encerrar o dia)</span><span><i style={{ background: "var(--d-ok)" }} />Concluídas</span></div>
      </div>

      <div className="dcc-card">
        <div className="dcc-sec-head"><h2>Adiadas na semana</h2><span className="dcc-pill dcc-pill-neutral">{weekDefers.length}</span></div>
        {weekDefers.length === 0 ? <Empty title="Nenhuma tarefa adiada.">Bom sinal — ou você ainda não usou o “adiar”.</Empty> :
          weekDefers.slice(-10).reverse().map((x, i) => <div className="dcc-event" key={i}><b>{shortDate(L.localDay(x.at))}</b><span>{x.task.text} <span className="dcc-sub">→ {shortDate(x.to)}</span></span></div>)}
      </div>

      <div className="dcc-card">
        <div className="dcc-sec-head"><h2>Pendências antigas</h2><span className="dcc-pill dcc-pill-neutral">{old.length}</span></div>
        <div className="dcc-sub">Planejadas em dias anteriores ou paradas há mais de 14 dias. Decida: hoje, stand by ou excluir.</div>
        {old.length === 0 ? <Empty title="Nada antigo acumulado." /> : (
          <div className="dcc-list">
            {old.slice(0, 15).map(t => (
              <ActionRow key={t.id} c={c} t={t} right={<>
                <button className="dcc-btn" onClick={() => c.act.plan(t.id)}>Hoje</button>
                <button className="dcc-btn" onClick={() => c.act.archive(t.id)}>Stand By</button>
                <button className="dcc-ico" aria-label={`Excluir: ${t.text}`} onClick={() => c.act.remove(t.id)}><Ic d="trash" size={15} /></button>
              </>} />
            ))}
          </div>
        )}
        {old.length > 15 && <div className="dcc-sub">+ {old.length - 15} em “Todas as Tarefas”.</div>}
      </div>

      <div className="dcc-card">
        <div className="dcc-sec-head"><h2>Foco de hoje</h2><span className="dcc-pill dcc-pill-neutral">{Math.round(totalFocus)} min</span></div>
        <div className="dcc-sub">Minutos em blocos do Modo Foco, por hora. Só conta quando você inicia o timer.</div>
        <div className="dcc-hours" role="img" aria-label={`Foco por hora: ${hours.filter(h => byHour[h]).map(h => `${h}h ${Math.round(byHour[h])} min`).join(", ") || "sem registros"}`}>
          {hours.map(h => <div key={h}><i title={`${Math.round(byHour[h] || 0)} min`} style={{ height: `${Math.min(100, ((byHour[h] || 0) / 60) * 100)}%` }} /><span>{h}h</span></div>)}
        </div>
      </div>

      {reviewsList.length > 0 && (
        <div className="dcc-card">
          <div className="dcc-sec-head"><h2>Encerramentos recentes</h2></div>
          {reviewsList.map(d => {
            const r = c.reviews[d];
            return (
              <div className="dcc-item" key={d} style={{ marginTop: 10 }}>
                <b>{longDate(d)}</b> <span className="dcc-sub">· {r.doneCount ?? 0}/{r.plannedCount ?? 0} concluídas{r.transferred ? ` · ${r.transferred} transferida(s)` : ""}</span>
                {r.worked && <div className="dcc-sub" style={{ marginTop: 4 }}>O que funcionou: {r.worked}</div>}
                {r.firstTomorrow && <div className="dcc-sub">Primeira tarefa seguinte: {r.firstTomorrow}</div>}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ─── Rituais ─────────────────────────────────────────────────────────────────
function PlanModal({ c, onClose }) {
  const { tasks, today } = c;
  const cands = useMemo(() => {
    const att = new Set(L.needsAttention(tasks, today).map(t => t.id));
    const rank = t => (L.bucketOf(t, today) === "today" ? 0 : att.has(t.id) ? 1 : 2);
    return tasks.filter(t => !L.isDone(t) && ["today", "stale", "backlog", "inbox"].includes(L.bucketOf(t, today)))
      .sort((a, b) => rank(a) - rank(b) || new Date(b.date) - new Date(a.date));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [sel, setSel] = useState(() => Object.fromEntries(cands.map(t => [t.id, {
    plan: L.bucketOf(t, today) === "today", est: t.estimatedMinutes || "", next: t.nextAction || "",
    ev: t.eventLink ? t.eventLink.id : "",
  }])));
  const [created, setCreated] = useState([]);
  const linkedIds = new Set([...created, ...tasks.filter(t => t.eventLink && !L.isDone(t)).map(t => t.eventLink.id)]);
  const [focusIds, setFocusIds] = useState(() => L.focusTasks(tasks, today).filter(t => !L.isDone(t)).map(t => t.id));
  const [q, setQ] = useState("");
  const lockedFocus = L.focusTasks(tasks, today).filter(L.isDone).length; // prioridades já concluídas continuam ocupando vaga
  const maxFocus = L.MAX_FOCUS - lockedFocus;
  const patchSel = (id, p) => setSel(s => ({ ...s, [id]: { ...s[id], ...p } }));
  const toggleFocus = id => {
    if (focusIds.includes(id)) { setFocusIds(focusIds.filter(x => x !== id)); return; }
    if (focusIds.length >= maxFocus) return;
    setFocusIds([...focusIds, id]); patchSel(id, { plan: true });
  };
  const togglePlan = id => {
    const on = !sel[id].plan;
    patchSel(id, { plan: on });
    if (!on) setFocusIds(f => f.filter(x => x !== id));
  };
  const apply = () => {
    c.mutate(p => {
      let out = p;
      cands.forEach(t => {
        const s = sel[t.id]; if (!s) return;
        const wasToday = L.bucketOf(t, today) === "today";
        if (s.plan) out = L.planForToday(out, t.id, today);
        else if (wasToday) out = L.unplanTask(out, t.id);
        out = L.patchTask(out, t.id, {
          estimatedMinutes: s.est ? Math.max(1, Math.round(Number(s.est))) : null,
          nextAction: s.next.trim() || null,
          eventLink: !s.ev ? null : (c.agenda.events.find(e => String(e.id) === s.ev) ? L.eventLinkOf(c.agenda.events.find(e => String(e.id) === s.ev)) : t.eventLink || null),
          ...(focusIds.includes(t.id) && s.plan ? { focusDate: today, focusOrder: 100 + focusIds.indexOf(t.id) } : { focusDate: null, focusOrder: null }),
        });
      });
      return L.normalizeFocus(out, today);
    });
    c.saveReview({ plannedAt: new Date().toISOString() });
    c.flash("Dia planejado.");
    onClose();
  };
  const planned = Object.values(sel).filter(s => s.plan).length;
  const ql = q.trim().toLowerCase();
  const visible = cands.filter(t => !ql || t.text.toLowerCase().includes(ql) || (t.tags || []).some(x => x.toLowerCase().includes(ql)));
  return (
    <Sheet title="Planejar meu dia" onClose={onClose} footer={<>
      <span className="dcc-sub" style={{ flex: 1, alignSelf: "center" }}>{planned} para hoje · {focusIds.length}/{maxFocus} no foco</span>
      <button className="dcc-btn" onClick={onClose}>Cancelar</button>
      <button className="dcc-btn dcc-btn-primary" onClick={apply}>Confirmar planejamento</button>
    </>}>
      <div className="dcc-field">
        <span className="dcc-label">Compromissos de hoje</span>
        {c.agenda.loading && <div className="dcc-sub">Buscando agenda…</div>}
        {!c.agenda.loading && c.agenda.events.length === 0 && <div className="dcc-sub">Nenhum compromisso para hoje.</div>}
        {c.agenda.events.map((e, i) => (
          <div className="dcc-event" key={e.id || i}>
            <b>{e.time || "dia todo"}</b>
            <span>{e.title}{e.local ? <span className="dcc-sub"> · {e.local}</span> : null}</span>
            <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
              {evBadge(e) && <span className="dcc-pill dcc-pill-neutral">{evBadge(e)}</span>}
              {linkedIds.has(String(e.id))
                ? <span className="dcc-pill dcc-pill-ok">tarefa vinculada</span>
                : <button className="dcc-btn" style={{ padding: "2px 9px" }} onClick={() => { c.act.fromEvent(e); setCreated(x => [...x, String(e.id)]); }}>+ Tarefa</button>}
            </span>
          </div>
        ))}
        <div className="dcc-sub" style={{ marginTop: 6 }}>
          {Object.entries(SRC_LABEL).map(([k, l]) => c.agenda.errors[k] ? `${l}: indisponível agora. ` : c.agenda.status[k] === false ? `${l}: não conectado. ` : "").join("")}
          {Object.values(c.agenda.status).every(v => v === false) && "Conecte Google ou Outlook na aba Agenda para ver seus compromissos aqui."}
          {" "}<button className="dcc-btn" style={{ padding: "1px 8px" }} onClick={c.agenda.refresh}>Atualizar</button>
        </div>
      </div>
      <div className="dcc-field">
        <span className="dcc-label">Escolha o que entra no dia — e até {maxFocus} prioridades (★)</span>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar tarefa ou tag…" aria-label="Buscar tarefas" />
      </div>
      {visible.length === 0 && <Empty title="Nenhuma tarefa para planejar.">Capture tarefas ou crie pela aba “Todas as Tarefas”.</Empty>}
      {visible.slice(0, 40).map(t => {
        const s = sel[t.id]; const fi = focusIds.indexOf(t.id); const late = L.needsAttention([t], today).length > 0;
        return (
          <div key={t.id} className={`dcc-plan-row${s.plan ? " is-on" : ""}`}>
            <div className="dcc-plan-head">
              <label><input type="checkbox" checked={s.plan} onChange={() => togglePlan(t.id)} /> <span>{t.text}</span></label>
              {late && <span className="dcc-pill dcc-pill-doing">atenção</span>}
              {L.bucketOf(t, today) === "inbox" && <span className="dcc-pill dcc-pill-neutral">caixa de entrada</span>}
              <button className="dcc-star" aria-pressed={fi >= 0} onClick={() => toggleFocus(t.id)} disabled={fi < 0 && focusIds.length >= maxFocus}>{fi >= 0 ? `★ ${fi + 1}` : "☆ Foco"}</button>
            </div>
            {s.plan && (
              <div className="dcc-plan-extra">
                {c.agenda.events.length > 0 && (
                  <select style={{ gridColumn: "1 / -1" }} value={s.ev} onChange={e => patchSel(t.id, { ev: e.target.value })} aria-label={`Compromisso vinculado: ${t.text}`}>
                    <option value="">Sem compromisso vinculado</option>
                    {t.eventLink && !c.agenda.events.some(e => String(e.id) === t.eventLink.id) && <option value={t.eventLink.id}>{evText(t)} (de outro dia)</option>}
                    {c.agenda.events.map(e => <option key={e.id} value={String(e.id)}>{e.time || "dia todo"} · {e.title}</option>)}
                  </select>
                )}
                <input type="number" min="1" value={s.est} onChange={e => patchSel(t.id, { est: e.target.value })} placeholder="Minutos" aria-label={`Tempo estimado: ${t.text}`} />
                <input value={s.next} onChange={e => patchSel(t.id, { next: e.target.value })} placeholder="Primeira ação concreta…" aria-label={`Próxima ação: ${t.text}`} />
              </div>
            )}
          </div>
        );
      })}
      {visible.length > 40 && <div className="dcc-sub">Mostrando 40 de {visible.length}. Use a busca.</div>}
    </Sheet>
  );
}

function ReviewModal({ c, onClose }) {
  const day = c.summary.day;
  const done = day.filter(L.isDone);
  const doing = day.filter(t => !L.isDone(t) && L.getStatus(t) === "doing");
  const notStarted = day.filter(t => !L.isDone(t) && L.getStatus(t) !== "doing");
  const left = [...doing, ...notStarted];
  const mins = left.reduce((s, t) => s + (t.estimatedMinutes || 0), 0);
  const noEst = left.filter(t => !t.estimatedMinutes).length;
  const Row = ({ t, actions }) => (
    <div className="dcc-li" style={{ padding: "9px 0" }}>
      <div className="dcc-li-main"><div className="dcc-li-title" style={{ fontSize: 14 }}>{t.text}</div><div className="dcc-li-meta">{areaOf(t)}{t.estimatedMinutes ? ` · ${L.fmtMin(t.estimatedMinutes)}` : ""}</div></div>
      <div className="dcc-li-right">{actions}</div>
    </div>
  );
  const acts = t => <>
    <button className="dcc-btn" onClick={() => c.act.complete(t.id)}>Concluir</button>
    <button className="dcc-btn" onClick={() => c.act.defer(t.id, L.addDays(c.today, 1))}>Amanhã</button>
  </>;
  return (
    <Sheet title="Revisar meu dia" onClose={onClose} footer={<button className="dcc-btn dcc-btn-primary" onClick={onClose}>Pronto</button>}>
      <div className="dcc-sub" style={{ marginBottom: 12 }}>Um olhar rápido: o que já foi, o que ainda cabe, e o que pode ficar para outro dia.</div>
      <div className="dcc-stats" style={{ marginBottom: 14 }}>
        <div className="dcc-stat" style={{ background: "var(--d-ok-bg)" }}><b style={{ color: "var(--d-ok)" }}>{done.length}</b><span>Concluídas</span></div>
        <div className="dcc-stat" style={{ background: "var(--d-warn-bg)" }}><b style={{ color: "#c8940f" }}>{doing.length}</b><span>Em andamento</span></div>
        <div className="dcc-stat" style={{ background: "var(--d-surface)" }}><b style={{ color: "#2272c3" }}>{notStarted.length}</b><span>Não iniciadas</span></div>
      </div>
      <div className="dcc-note" style={{ background: "var(--d-surface)", marginTop: 0 }}>
        {left.length === 0 ? "Nada restante no dia." : mins ? `Tempo restante estimado: ${L.fmtMin(mins)}${noEst ? ` (+ ${noEst} sem estimativa)` : ""}.` : "Sem estimativas nas tarefas restantes."}
      </div>
      {doing.length > 0 && <><div className="dcc-group-title"><span>Em andamento</span></div>{doing.map(t => <Row key={t.id} t={t} actions={acts(t)} />)}</>}
      {notStarted.length > 0 && <><div className="dcc-group-title"><span>Ainda não iniciadas</span></div>{notStarted.map(t => <Row key={t.id} t={t} actions={acts(t)} />)}</>}
      {done.length > 0 && <><div className="dcc-group-title"><span>Concluídas</span></div>{done.map(t => <Row key={t.id} t={t} actions={<span className="dcc-sub">às {hhmm(t.doneAt)}</span>} />)}</>}
    </Sheet>
  );
}

function CloseModal({ c, onClose }) {
  const day = c.summary.day;
  const done = day.filter(L.isDone);
  const pending = day.filter(t => !L.isDone(t));
  const tmr = L.addDays(c.today, 1);
  const [choice, setChoice] = useState(() => Object.fromEntries(pending.map(t => [t.id, { mode: "keep", date: tmr }])));
  const [worked, setWorked] = useState("");
  const [first, setFirst] = useState("");
  const setC = (id, p) => setChoice(s => ({ ...s, [id]: { ...s[id], ...p } }));
  const apply = () => {
    let moved = 0;
    c.mutate(p => {
      let out = p;
      pending.forEach(t => {
        const ch = choice[t.id];
        if (ch.mode === "tomorrow") { out = L.deferTask(out, t.id, tmr, c.today); moved++; }
        else if (ch.mode === "date" && ch.date > c.today) { out = L.deferTask(out, t.id, ch.date, c.today); moved++; }
      });
      return out;
    });
    c.saveReview({
      closedAt: new Date().toISOString(), worked: worked.trim(), firstTomorrow: first.trim(),
      plannedCount: c.summary.planned, doneCount: c.summary.done, transferred: moved,
    });
    c.flash("Dia encerrado. Bom descanso!");
    onClose();
  };
  return (
    <Sheet title="Encerrar meu dia" onClose={onClose} footer={<>
      <button className="dcc-btn" onClick={onClose}>Cancelar</button>
      <button className="dcc-btn dcc-btn-primary" onClick={apply}>Salvar encerramento</button>
    </>}>
      <div className="dcc-sub" style={{ marginBottom: 12 }}>Nada é concluído ou transferido sem a sua escolha abaixo.</div>
      <span className="dcc-label">O que foi concluído ({done.length})</span>
      {done.length === 0 ? <div className="dcc-sub" style={{ marginBottom: 12 }}>Nenhuma tarefa concluída hoje — tudo bem. Amanhã é um novo planejamento.</div>
        : <ul className="dcc-steps" style={{ marginBottom: 12 }}>{done.map(t => <li key={t.id} className="is-done"><Ic d="checkCircle" size={16} color="var(--d-ok)" /><span>{t.text}</span></li>)}</ul>}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
        <span className="dcc-label" style={{ margin: 0 }}>O que ficou pendente ({pending.length})</span>
        {pending.length > 0 && <button className="dcc-btn" onClick={() => setChoice(Object.fromEntries(pending.map(t => [t.id, { mode: "tomorrow", date: tmr }])))}>Passar todas para amanhã</button>}
      </div>
      {pending.map(t => {
        const ch = choice[t.id];
        return (
          <div key={t.id} className="dcc-plan-row" style={{ marginTop: 8 }}>
            <div className="dcc-plan-head"><label style={{ cursor: "default" }}><span>{t.text}</span></label></div>
            <div className="dcc-plan-extra" style={{ gridTemplateColumns: ch.mode === "date" ? "1fr 150px" : "1fr" }}>
              <select value={ch.mode} onChange={e => setC(t.id, { mode: e.target.value })} aria-label={`O que fazer com: ${t.text}`}>
                <option value="keep">Deixar como está</option>
                <option value="tomorrow">Transferir para amanhã</option>
                <option value="date">Transferir para outra data…</option>
              </select>
              {ch.mode === "date" && <input type="date" min={tmr} value={ch.date} onChange={e => setC(t.id, { date: e.target.value })} aria-label="Nova data" />}
            </div>
          </div>
        );
      })}
      <div className="dcc-field" style={{ marginTop: 16 }}>
        <label htmlFor="cl-w">O que funcionou hoje? (opcional)</label>
        <textarea id="cl-w" rows={2} value={worked} onChange={e => setWorked(e.target.value)} />
      </div>
      <div className="dcc-field">
        <label htmlFor="cl-f">Qual será a primeira tarefa de amanhã? (opcional)</label>
        <input id="cl-f" value={first} onChange={e => setFirst(e.target.value)} list="cl-f-list" />
        <datalist id="cl-f-list">{pending.map(t => <option key={t.id} value={t.text} />)}</datalist>
      </div>
    </Sheet>
  );
}

// seletor simples para preencher uma vaga do foco
function Picker({ c, onClose }) {
  const [q, setQ] = useState("");
  const ql = q.trim().toLowerCase();
  const focusIds = c.focus.map(t => t.id);
  const list = c.tasks.filter(t => !L.isDone(t) && !focusIds.includes(t.id) && ["today", "stale", "backlog", "inbox", "future"].includes(L.bucketOf(t, c.today))
    && (!ql || t.text.toLowerCase().includes(ql) || (t.tags || []).some(x => x.toLowerCase().includes(ql))))
    .sort((a, b) => (L.bucketOf(a, c.today) === "today" ? 0 : 1) - (L.bucketOf(b, c.today) === "today" ? 0 : 1) || new Date(b.date) - new Date(a.date)).slice(0, 40);
  return (
    <Sheet title="Escolher prioridade de hoje" onClose={onClose}>
      <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar tarefa ou tag…" aria-label="Buscar tarefas" style={{ marginBottom: 10 }} />
      {list.length === 0 && <Empty title="Nenhuma tarefa encontrada.">Capture uma nova ou ajuste a busca.</Empty>}
      {list.map(t => (
        <div key={t.id} className="dcc-li" style={{ padding: "10px 0" }}>
          <div className="dcc-li-main"><div className="dcc-li-title" style={{ fontSize: 14 }}>{t.text}</div><div className="dcc-li-meta">{areaOf(t)} · {PRIO_SHORT[t.prio] || "Normal"}{L.bucketOf(t, c.today) === "today" ? " · já está no dia" : ""}</div></div>
          <button className="dcc-btn dcc-btn-primary" onClick={() => { c.act.focusAdd(t.id); onClose(); }}>Escolher</button>
        </div>
      ))}
    </Sheet>
  );
}

// ─── contêiner ───────────────────────────────────────────────────────────────
const TABS = [["day", "Meu Dia"], ["inbox", "Caixa de Entrada"], ["upcoming", "Próximos Dias"], ["all", "Todas as Tarefas"], ["history", "Histórico"]];

export default function DailyCenter({ tasks, setTasks, board, synced, sync, ui }) {
  const { useKV, pedroNotify } = ui;
  const [view, setView] = useState("day");
  const [today, setToday] = useState(() => L.dateStr());
  const [reviews, setReviews] = useKV("daily_reviews_v1", {});
  const [focusLog, setFocusLog] = useKV("focus_log_v1", []);
  const [events] = useKV("events_v1", []);
  const [timer, setTimer] = useKV("dcc_focus_timer_v1", {});
  const timerRef = useRef(timer); timerRef.current = timer;
  const [editId, setEditId] = useState(null);
  const [ritual, setRitual] = useState(null);
  const [picker, setPicker] = useState(false);
  const [capOpen, setCapOpen] = useState(false);
  const [focusOn, setFocusOn] = useState(null);
  const [sort, setSort] = useState("padrao");
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const tasksRef = useRef(tasks); tasksRef.current = tasks;

  // virada de dia no fuso local (sem depender de UTC)
  useEffect(() => {
    const id = setInterval(() => setToday(p => { const d = L.dateStr(); return d === p ? p : d; }), 30000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const mutate = fn => setTasks(prev => fn(prev));
  const byId = id => tasksRef.current.find(t => t.id === id);
  const flash = (msg, undo) => {
    clearTimeout(toastTimer.current);
    setToast({ msg, undo });
    toastTimer.current = setTimeout(() => setToast(null), 6500);
  };
  const saveReview = patch => setReviews(prev => {
    const next = { ...(prev || {}), [today]: { ...((prev || {})[today] || {}), date: today, ...patch } };
    const keys = Object.keys(next).sort();
    keys.slice(0, Math.max(0, keys.length - 60)).forEach(k => delete next[k]);
    return next;
  });
  const logFocus = entry => setFocusLog(prev => {
    const cutoff = Date.now() - 90 * 86400000;
    return [...(prev || []).filter(e => new Date(e.at).getTime() > cutoff), entry];
  });

  const act = {
    start: id => mutate(p => L.startTask(p, id, today)),
    complete: id => {
      const old = byId(id); if (!old || L.isDone(old)) return;
      const others = tasksRef.current.some(x => x.id !== id && x.status === "today");
      mutate(p => L.completeTask(p, id));
      try { pedroNotify("task_done", { text: old.text }); if (old.status === "today" && !others) pedroNotify("all_today_done", {}); } catch { /* pedro opcional */ }
      flash("Tarefa concluída.", () => mutate(p => L.restoreTask(p, old)));
    },
    reopen: id => mutate(p => L.reopenTask(p, id, today)),
    plan: id => { mutate(p => L.planForToday(p, id, today)); flash("Trazida para hoje."); },
    defer: (id, to) => {
      const old = byId(id); if (!old) return;
      mutate(p => L.deferTask(p, id, to, today));
      flash(`Adiada para ${to === L.addDays(today, 1) ? "amanhã" : shortDate(to)}.`, () => mutate(p => L.restoreTask(p, old)));
    },
    focusAdd: id => {
      let full = false;
      mutate(p => { const n = L.setFocus(p, id, today); if (!n) { full = true; return p; } return n; });
      if (full) flash("Você já tem 3 prioridades hoje. Tire uma para escolher outra.");
      return !full;
    },
    focusRemove: id => mutate(p => L.removeFocus(p, id, today)),
    moveFocus: (id, dir) => mutate(p => L.moveFocus(p, id, dir, today)),
    reorderFocus: (from, to) => mutate(p => L.reorderFocus(p, from, to, today)),
    organize: id => mutate(p => L.patchTask(p, id, { inbox: false })),
    archive: id => {
      const old = byId(id); if (!old) return;
      mutate(p => L.patchTask(L.removeFocus(p, id, today), id, { status: "standby", inbox: false, plannedDate: null, done: false }));
      flash("Arquivada em Stand By.", () => mutate(p => L.restoreTask(p, old)));
    },
    remove: id => {
      const old = byId(id); if (!old) return;
      mutate(p => p.filter(t => t.id !== id));
      flash("Tarefa excluída.", () => mutate(p => L.restoreTask(p, old)));
    },
    fromEvent: e => {
      const t = L.newEventTask(e, today);
      mutate(p => [t, ...p]);
      flash("Tarefa criada a partir do compromisso.", () => mutate(p => p.filter(x => x.id !== t.id)));
    },
    moveToInbox: ids => {
      const olds = tasksRef.current.filter(t => ids.includes(t.id));
      mutate(p => L.moveToInbox(p, ids));
      flash(`${ids.length} ${ids.length === 1 ? "tarefa movida" : "tarefas movidas"} para a Caixa de Entrada.`, () => mutate(p => olds.reduce((acc, o) => L.restoreTask(acc, o), p)));
    },
    capture: ({ text, tag, due }) => {
      const t = L.newInboxTask({ text, tag, due });
      mutate(p => [t, ...p]);
      flash("Salva na Caixa de Entrada.", () => mutate(p => p.filter(x => x.id !== t.id)));
    },
  };

  const allTags = useMemo(() => {
    const s = new Set();
    tasks.forEach(t => (t.tags || []).forEach(x => s.add(x)));
    return [...s].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [tasks]);

  const summary = L.daySummary(tasks, today);
  const focus = L.focusTasks(tasks, today);
  const inboxCount = tasks.filter(t => L.bucketOf(t, today) === "inbox").length;
  const agenda = useAgenda(today, events, ui);
  const prevKey = Object.keys(reviews || {}).filter(k => k < today && reviews[k].firstTomorrow && L.addDays(k, 3) >= today).sort().pop();
  const prevNote = prevKey ? reviews[prevKey].firstTomorrow : "";

  const c = {
    tasks, today, summary, focus, allTags, agenda, prevNote, timer, timerRef, setTimer, reviews: reviews || {}, focusLog: Array.isArray(focusLog) ? focusLog : [],
    synced, sort, setSort, act, mutate, flash, saveReview, logFocus,
    setEditId, setRitual, setPicker, setFocusOn,
    patch: (id, p) => mutate(prev => L.patchTask(prev, id, p)),
  };

  const editing = editId ? tasks.find(t => t.id === editId) : null;

  return (
    <div className="dcc">
      <div className="dcc-tabs" role="tablist" aria-label="Visões de tarefas">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={view === id} className="dcc-tab" onClick={() => setView(id)}>
            {label}{id === "inbox" && inboxCount > 0 && <span className="dcc-count">{inboxCount}</span>}
          </button>
        ))}
        <span className="dcc-spacer" />
        {view !== "day" && view !== "inbox" && (
          <button className="dcc-btn dcc-btn-primary" onClick={() => setCapOpen(true)}><Ic d="plus" size={14} /> Capturar tarefa</button>
        )}
      </div>

      {sync && sync.error && (
        <div className="dcc-banner" role="alert">
          <span>Sem conexão com a nuvem. Suas tarefas continuam salvas neste dispositivo e serão reenviadas quando a conexão voltar.</span>
          <button className="dcc-btn" onClick={() => sync.retry()}>Tentar novamente</button>
        </div>
      )}
      {view === "day" && !synced && tasks.length === 0 && (
        <div className="dcc-card" aria-busy="true" role="status"><div className="dcc-empty"><b>Carregando suas tarefas…</b>Sincronizando com a nuvem.</div></div>
      )}
      {view === "day" && (synced || tasks.length > 0) && <DayView c={c} />}
      {view === "inbox" && <InboxView c={c} />}
      {view === "upcoming" && <UpcomingView c={c} />}
      {view === "all" && board}
      {view === "history" && <HistoryView c={c} />}

      {capOpen && (
        <Sheet title="Captura rápida" onClose={() => setCapOpen(false)}>
          <CaptureCard tags={allTags} autoFocus onSave={d => { act.capture(d); setCapOpen(false); }} />
        </Sheet>
      )}
      {picker && <Picker c={c} onClose={() => setPicker(false)} />}
      {ritual === "plan" && <PlanModal c={c} onClose={() => setRitual(null)} />}
      {ritual === "review" && <ReviewModal c={c} onClose={() => setRitual(null)} />}
      {ritual === "close" && <CloseModal c={c} onClose={() => setRitual(null)} />}
      {editing && (
        <TaskEditor key={editing.id} task={editing} tags={allTags} events={agenda.events}
          onClose={() => setEditId(null)}
          onSave={patch => { mutate(p => L.patchTask(p, editing.id, patch)); setEditId(null); }}
          onDelete={() => { setEditId(null); act.remove(editing.id); }} />
      )}
      {focusOn && <FocusMode c={c} startId={focusOn} onClose={() => setFocusOn(null)} />}
      {toast && (
        <Portal>
          <div className="dcc-toast" role="status">
            <span>{toast.msg}</span>
            {toast.undo && <button onClick={() => { toast.undo(); setToast(null); }}>Desfazer</button>}
          </div>
        </Portal>
      )}
    </div>
  );
}
