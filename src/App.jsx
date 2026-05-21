import { useState, useEffect } from "react";

// ─── ICONS ───────────────────────────────────────────────────────────────────
const Icon = ({ path, size = 18, color = "currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={path} />
  </svg>
);
const I = {
  user:       "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  briefcase:  "M21 16V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z M3 10h18 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
  info:       "M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z M12 8h.01 M11 12h1v4h1",
  diary:      "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z M22 3h-6a4 4 0 0 1-4 4v14a3 3 0 0 0 3-3h7z",
  folder:     "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z",
  bill:       "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8",
  calendar:   "M3 4h18v18H3z M16 2v4 M8 2v4 M3 10h18",
  star:       "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z",
  newspaper:  "M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2z M2 7h2 M2 12h2 M2 17h2",
  chart:      "M3 3v18h18 M7 16l4-4 4 4 4-8",
  plus:       "M12 5v14 M5 12h14",
  x:          "M18 6 6 18 M6 6l12 12",
  bell:       "M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 0 1-3.46 0",
  link:       "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  trash:      "M3 6h18 M19 6l-1 14H6L5 6 M8 6V4h8v2",
  check:      "M20 6 9 17l-5-5",
  monitor:    "M8 21h8 M12 17v4 M2 3h20v14H2z",
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const now      = () => new Date().toLocaleString("pt-BR");
const today    = () => new Date().toLocaleDateString("pt-BR", { weekday:"long", year:"numeric", month:"long", day:"numeric" });
const fmtMoney = (v) => Number(v).toLocaleString("pt-BR", { style:"currency", currency:"BRL" });

// ─── LOCAL STORAGE ────────────────────────────────────────────────────────────
const S = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ─── SHARED STYLES ────────────────────────────────────────────────────────────
const inp = {
  width: "100%",
  background: "var(--bg-input)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: "10px 14px",
  color: "var(--text-1)",
  fontSize: 14,
  outline: "none",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

const primaryBtn = (color = "var(--accent)") => ({
  background: color,
  border: "none",
  borderRadius: 10,
  padding: "10px 20px",
  color: "#fff",
  fontWeight: 700,
  fontSize: 14,
  cursor: "pointer",
  fontFamily: "inherit",
});

// ─── MARKET TICKER ────────────────────────────────────────────────────────────
function MarketTicker({ compact }) {
  const [data, setData] = useState({
    dolar: "5.87", dolarC: "+0.32%",
    ibov:  "128450", ibovC:  "-0.18%",
    sp500: "5824",  sp500C: "+0.45%",
    ouro:  "9847",  ouroC:  "+1.12%",
    btc:   "94230", btcC:   "+2.34%",
  });

  useEffect(() => {
    const id = setInterval(() => {
      const jitter = (base, pct = 0.003) => {
        const n = parseFloat(base.replace(/\./g,"").replace(",",".")) * (1 + (Math.random()-0.5)*pct);
        return n > 1000 ? Math.round(n).toLocaleString("pt-BR") : n.toFixed(2);
      };
      const chg = (r = 1.5) => ((Math.random()-0.48)*r).toFixed(2)+"%";
      setData(p => ({
        dolar: jitter(p.dolar, 0.002), dolarC: chg(1.2),
        ibov:  jitter(p.ibov,  0.003), ibovC:  chg(0.9),
        sp500: jitter(p.sp500, 0.002), sp500C: chg(0.7),
        ouro:  jitter(p.ouro,  0.002), ouroC:  chg(1.0),
        btc:   jitter(p.btc,   0.008), btcC:   chg(2.8),
      }));
    }, 3000);
    return () => clearInterval(id);
  }, []);

  const items = [
    { label:"DÓLAR",   val:`R$ ${data.dolar}`,  chg: data.dolarC, color:"var(--green)"  },
    { label:"IBOV",    val: data.ibov,           chg: data.ibovC,  color:"var(--accent)" },
    { label:"S&P 500", val: data.sp500,          chg: data.sp500C, color:"var(--purple)" },
    { label:"OURO",    val:`R$ ${data.ouro}`,    chg: data.ouroC,  color:"var(--yellow)" },
    { label:"BITCOIN", val:`$ ${data.btc}`,      chg: data.btcC,   color:"var(--orange)" },
  ];

  if (compact) return (
    <div style={{ display:"flex", gap:22, alignItems:"center" }}>
      {items.map(i => {
        const up = !i.chg.startsWith("-");
        return (
          <div key={i.label} style={{ display:"flex", flexDirection:"column" }}>
            <span style={{ fontSize:9, color:"var(--text-3)", letterSpacing:1, fontWeight:700 }}>{i.label}</span>
            <span style={{ fontSize:12, fontWeight:700, color:i.color, fontFamily:"'DM Mono',monospace" }}>{i.val}</span>
            <span style={{ fontSize:10, color: up?"var(--green)":"var(--red)" }}>{up?"▲":"▼"} {i.chg}</span>
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:12 }}>
      {items.map(i => {
        const up = !i.chg.startsWith("-");
        return (
          <div key={i.label} style={{ background:"var(--bg-card)", border:`1px solid ${i.color}2a`, borderRadius:14, padding:"16px 20px", position:"relative", overflow:"hidden" }}>
            <div style={{ position:"absolute", top:0, left:0, right:0, height:2, background:i.color }} />
            <div style={{ fontSize:10, color:"var(--text-3)", letterSpacing:2, fontWeight:700, marginBottom:8 }}>{i.label}</div>
            <div style={{ fontSize:22, fontWeight:800, color:i.color, fontFamily:"'DM Mono',monospace", marginBottom:4 }}>{i.val}</div>
            <div style={{ fontSize:12, color: up?"var(--green)":"var(--red)", fontWeight:600 }}>{up?"▲":"▼"} {i.chg}</div>
            <div style={{ position:"absolute", bottom:8, right:12, fontSize:9, color:"var(--border)" }}>LIVE</div>
          </div>
        );
      })}
    </div>
  );
}

// ─── MODAL ───────────────────────────────────────────────────────────────────
function Modal({ title, onClose, children, wide }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(10,18,32,0.75)", backdropFilter:"blur(8px)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
      <div style={{ background:"var(--bg-card)", border:"1px solid var(--border)", borderRadius:20, width:"100%", maxWidth: wide ? 760 : 520, maxHeight:"85vh", overflow:"auto", boxShadow:"0 40px 80px rgba(0,0,0,0.5)", animation:"fadeIn .2s ease" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"20px 24px", borderBottom:"1px solid var(--border)" }}>
          <span style={{ fontWeight:700, fontSize:16 }}>{title}</span>
          <button onClick={onClose} style={{ background:"none", border:"none", color:"var(--text-3)", cursor:"pointer", display:"flex" }}>
            <Icon path={I.x} size={20} />
          </button>
        </div>
        <div style={{ padding:24 }}>{children}</div>
      </div>
    </div>
  );
}

// ─── DIARY ───────────────────────────────────────────────────────────────────
function DiarySection() {
  const [entries, setEntries] = useState(() => S.get("diary", []));
  const [text, setText] = useState("");
  const [mood, setMood] = useState("🙂");
  const moods = ["😄","🙂","😐","😔","😤","🤔","🎉"];

  const add = () => {
    if (!text.trim()) return;
    const e = { id:Date.now(), text, mood, date:new Date().toISOString() };
    const n = [e, ...entries];
    setEntries(n); S.set("diary", n); setText("");
  };
  const del = (id) => { const n = entries.filter(e => e.id !== id); setEntries(n); S.set("diary", n); };

  const grouped = entries.reduce((acc, e) => {
    const d = new Date(e.date).toLocaleDateString("pt-BR", { weekday:"long", day:"numeric", month:"long" });
    (acc[d] = acc[d] || []).push(e);
    return acc;
  }, {});

  return (
    <div>
      <div style={{ marginBottom:24, background:"var(--bg-card)", border:"1px solid var(--border)", borderRadius:16, padding:20 }}>
        <div style={{ fontSize:11, color:"var(--text-3)", marginBottom:12, letterSpacing:1 }}>{today().toUpperCase()}</div>
        <div style={{ display:"flex", gap:8, marginBottom:12 }}>
          {moods.map(m => (
            <button key={m} onClick={() => setMood(m)} style={{ fontSize:20, background: mood===m ? "var(--bg-input)" : "none", border: mood===m ? "1px solid var(--accent)" : "1px solid transparent", borderRadius:8, padding:"4px 8px", cursor:"pointer" }}>{m}</button>
          ))}
        </div>
        <textarea value={text} onChange={e => setText(e.target.value)}
          placeholder="O que está em sua mente hoje?" rows={4}
          style={{ ...inp, resize:"vertical", marginBottom:12 }} />
        <button onClick={add} style={primaryBtn()}>Registrar</button>
      </div>

      {Object.entries(grouped).map(([date, es]) => (
        <div key={date} style={{ marginBottom:28 }}>
          <div style={{ fontSize:11, color:"var(--accent)", letterSpacing:2, fontWeight:700, marginBottom:12, paddingBottom:8, borderBottom:"1px solid var(--border-2)" }}>{date.toUpperCase()}</div>
          {es.map(e => (
            <div key={e.id} style={{ background:"var(--bg-card)", border:"1px solid var(--border)", borderRadius:12, padding:"14px 18px", marginBottom:10, display:"flex", gap:14, alignItems:"flex-start" }}>
              <span style={{ fontSize:22 }}>{e.mood}</span>
              <div style={{ flex:1 }}>
                <p style={{ margin:0, color:"var(--text-2)", lineHeight:1.6, fontSize:14 }}>{e.text}</p>
                <span style={{ fontSize:11, color:"var(--text-3)", marginTop:6, display:"block" }}>
                  {new Date(e.date).toLocaleTimeString("pt-BR", { hour:"2-digit", minute:"2-digit" })}
                </span>
              </div>
              <button onClick={() => del(e.id)} style={{ background:"none", border:"none", color:"var(--text-3)", cursor:"pointer" }}>
                <Icon path={I.trash} size={14} />
              </button>
            </div>
          ))}
        </div>
      ))}
      {entries.length === 0 && <Empty text="Nenhum registro ainda. Comece escrevendo algo ✨" />}
    </div>
  );
}

// ─── DOCUMENTS ───────────────────────────────────────────────────────────────
function DocsSection() {
  const [docs, setDocs] = useState(() => S.get("docs", []));
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ name:"", cat:"Pessoal", tags:"" });
  const [filter, setFilter] = useState("Todos");
  const cats = ["Pessoal","Financeiro","Saúde","Legal","Trabalho","Outros"];

  const add = () => {
    if (!form.name.trim()) return;
    const n = [...docs, { id:Date.now(), ...form, date:now(), tags:form.tags.split(",").map(t=>t.trim()).filter(Boolean) }];
    setDocs(n); S.set("docs", n); setModal(false); setForm({ name:"", cat:"Pessoal", tags:"" });
  };
  const del = (id) => { const n = docs.filter(d => d.id !== id); setDocs(n); S.set("docs", n); };

  const filtered = filter === "Todos" ? docs : docs.filter(d => d.cat === filter);

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20, flexWrap:"wrap", gap:10 }}>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          {["Todos",...cats].map(c => (
            <button key={c} onClick={() => setFilter(c)} style={{ background: filter===c ? "var(--accent)" : "var(--bg-card)", border:"none", borderRadius:20, padding:"6px 14px", color: filter===c ? "#fff" : "var(--text-2)", fontSize:12, cursor:"pointer", fontWeight:600 }}>{c}</button>
          ))}
        </div>
        <button onClick={() => setModal(true)} style={{ ...primaryBtn(), display:"flex", alignItems:"center", gap:6 }}>
          <Icon path={I.plus} size={14} /> Adicionar
        </button>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:12 }}>
        {filtered.map(d => (
          <div key={d.id} style={{ background:"var(--bg-card)", border:"1px solid var(--border)", borderRadius:14, padding:16, position:"relative" }}>
            <div style={{ fontSize:28, marginBottom:10 }}>📄</div>
            <div style={{ fontWeight:700, marginBottom:4, fontSize:14 }}>{d.name}</div>
            <div style={{ fontSize:11, color:"var(--accent)", marginBottom:8 }}>{d.cat}</div>
            {d.tags.length > 0 && (
              <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:8 }}>
                {d.tags.map(t => <span key={t} style={{ background:"var(--bg-input)", borderRadius:4, padding:"2px 6px", fontSize:10, color:"var(--text-3)" }}>{t}</span>)}
              </div>
            )}
            <div style={{ fontSize:10, color:"var(--text-3)" }}>{d.date}</div>
            <button onClick={() => del(d.id)} style={{ position:"absolute", top:12, right:12, background:"none", border:"none", color:"var(--text-3)", cursor:"pointer" }}>
              <Icon path={I.trash} size={13} />
            </button>
          </div>
        ))}
      </div>
      {filtered.length === 0 && <Empty text="Nenhum documento nesta categoria." />}

      {modal && (
        <Modal title="Adicionar Documento" onClose={() => setModal(false)}>
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            <input style={inp} placeholder="Nome do documento" value={form.name} onChange={e => setForm({...form, name:e.target.value})} />
            <select style={inp} value={form.cat} onChange={e => setForm({...form, cat:e.target.value})}>
              {cats.map(c => <option key={c}>{c}</option>)}
            </select>
            <input style={inp} placeholder="Tags (separadas por vírgula)" value={form.tags} onChange={e => setForm({...form, tags:e.target.value})} />
            <button onClick={add} style={primaryBtn()}>Salvar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── BILLS ────────────────────────────────────────────────────────────────────
function BillsSection() {
  const [bills, setBills] = useState(() => S.get("bills", []));
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ name:"", value:"", dueDay:"", cat:"Fixo", recurrent:true });
  const cats = ["Fixo","Variável","Cartão","Imposto","Assinatura"];

  const add = () => {
    if (!form.name.trim() || !form.dueDay) return;
    const n = [...bills, { id:Date.now(), ...form, value:parseFloat(form.value)||0, paid:false }];
    setBills(n); S.set("bills", n); setModal(false); setForm({ name:"", value:"", dueDay:"", cat:"Fixo", recurrent:true });
  };
  const toggle = (id) => { const n = bills.map(b => b.id===id ? {...b, paid:!b.paid} : b); setBills(n); S.set("bills", n); };
  const del    = (id) => { const n = bills.filter(b => b.id !== id); setBills(n); S.set("bills", n); };

  const day = new Date().getDate();
  const upcoming = bills.filter(b => !b.paid && +b.dueDay >= day && +b.dueDay <= day+5);
  const total    = bills.filter(b => !b.paid).reduce((s,b) => s+b.value, 0);

  return (
    <div>
      {upcoming.length > 0 && (
        <div style={{ background:"rgba(251,191,36,0.07)", border:"1px solid rgba(251,191,36,0.25)", borderRadius:14, padding:16, marginBottom:20 }}>
          <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:10, color:"var(--yellow)", fontWeight:700, fontSize:13 }}>
            <Icon path={I.bell} size={16} color="var(--yellow)" /> Vencem em breve ({upcoming.length})
          </div>
          {upcoming.map(b => (
            <div key={b.id} style={{ display:"flex", justifyContent:"space-between", color:"var(--text-1)", fontSize:13, padding:"4px 0" }}>
              <span>{b.name}</span>
              <span style={{ color:"var(--yellow)" }}>Dia {b.dueDay} · {fmtMoney(b.value)}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
        <div style={{ color:"var(--text-3)", fontSize:13 }}>
          Total pendente: <span style={{ color:"var(--red)", fontWeight:700 }}>{fmtMoney(total)}</span>
        </div>
        <button onClick={() => setModal(true)} style={{ ...primaryBtn(), display:"flex", alignItems:"center", gap:6 }}>
          <Icon path={I.plus} size={14} /> Nova Conta
        </button>
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {bills.map(b => (
          <div key={b.id} style={{ background:"var(--bg-card)", border:`1px solid ${b.paid?"var(--border-2)":"var(--border)"}`, borderRadius:12, padding:"14px 18px", display:"flex", alignItems:"center", gap:14, opacity: b.paid ? 0.5 : 1, transition:"opacity .2s" }}>
            <button onClick={() => toggle(b.id)} style={{ width:22, height:22, borderRadius:6, border:`2px solid ${b.paid?"var(--green)":"var(--border)"}`, background: b.paid?"var(--green)":"transparent", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
              {b.paid && <Icon path={I.check} size={12} color="#fff" />}
            </button>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:600, fontSize:14, textDecoration: b.paid?"line-through":"none" }}>{b.name}</div>
              <div style={{ fontSize:11, color:"var(--text-3)" }}>{b.cat} · Vence dia {b.dueDay}{b.recurrent?" · Recorrente":""}</div>
            </div>
            <div style={{ fontWeight:700, color: b.paid?"var(--green)":"var(--text-1)", fontSize:15, fontFamily:"'DM Mono',monospace" }}>{fmtMoney(b.value)}</div>
            <button onClick={() => del(b.id)} style={{ background:"none", border:"none", color:"var(--text-3)", cursor:"pointer" }}>
              <Icon path={I.trash} size={14} />
            </button>
          </div>
        ))}
      </div>
      {bills.length === 0 && <Empty text="Nenhuma conta cadastrada." />}

      {modal && (
        <Modal title="Nova Conta" onClose={() => setModal(false)}>
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            <input style={inp} placeholder="Nome da conta" value={form.name} onChange={e => setForm({...form, name:e.target.value})} />
            <input style={inp} type="number" placeholder="Valor (R$)" value={form.value} onChange={e => setForm({...form, value:e.target.value})} />
            <input style={inp} type="number" min="1" max="31" placeholder="Dia do vencimento (1-31)" value={form.dueDay} onChange={e => setForm({...form, dueDay:e.target.value})} />
            <select style={inp} value={form.cat} onChange={e => setForm({...form, cat:e.target.value})}>
              {cats.map(c => <option key={c}>{c}</option>)}
            </select>
            <label style={{ display:"flex", gap:10, alignItems:"center", color:"var(--text-2)", fontSize:14, cursor:"pointer" }}>
              <input type="checkbox" checked={form.recurrent} onChange={e => setForm({...form, recurrent:e.target.checked})} />
              Conta recorrente (mensal)
            </label>
            <button onClick={add} style={primaryBtn()}>Salvar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── EVENTS ───────────────────────────────────────────────────────────────────
function EventsSection() {
  const [events, setEvents] = useState(() => S.get("events", []));
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ title:"", date:"", time:"", local:"", cat:"Pessoal", notes:"" });
  const cats = ["Pessoal","Médico","Reunião","Viagem","Aniversário","Outros"];
  const catColors = { Pessoal:"var(--accent)", Médico:"var(--red)", Reunião:"var(--purple)", Viagem:"var(--green)", Aniversário:"var(--yellow)", Outros:"var(--text-3)" };

  const add = () => {
    if (!form.title.trim() || !form.date) return;
    const n = [...events, { id:Date.now(), ...form }].sort((a,b) => new Date(a.date+"T"+(a.time||"00:00")) - new Date(b.date+"T"+(b.time||"00:00")));
    setEvents(n); S.set("events", n); setModal(false); setForm({ title:"", date:"", time:"", local:"", cat:"Pessoal", notes:"" });
  };
  const del = (id) => { const n = events.filter(e => e.id !== id); setEvents(n); S.set("events", n); };

  const todayStr = new Date().toISOString().split("T")[0];
  const upcoming = events.filter(e => e.date >= todayStr);
  const past     = events.filter(e => e.date < todayStr);

  const Card = ({ e }) => (
    <div style={{ background:"var(--bg-card)", border:"1px solid var(--border)", borderRadius:12, padding:"14px 18px", display:"flex", gap:14, alignItems:"flex-start", marginBottom:10 }}>
      <div style={{ width:4, borderRadius:4, background: catColors[e.cat]||"var(--accent)", alignSelf:"stretch", flexShrink:0 }} />
      <div style={{ flex:1 }}>
        <div style={{ fontWeight:700, fontSize:14, marginBottom:4 }}>{e.title}</div>
        <div style={{ fontSize:12, color:"var(--text-3)" }}>
          📅 {new Date(e.date+"T12:00").toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"})}
          {e.time && ` · ⏰ ${e.time}`}
          {e.local && ` · 📍 ${e.local}`}
        </div>
        {e.notes && <div style={{ fontSize:12, color:"var(--text-2)", marginTop:6 }}>{e.notes}</div>}
      </div>
      <button onClick={() => del(e.id)} style={{ background:"none", border:"none", color:"var(--text-3)", cursor:"pointer" }}>
        <Icon path={I.trash} size={14} />
      </button>
    </div>
  );

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:20 }}>
        <button onClick={() => setModal(true)} style={{ ...primaryBtn(), display:"flex", alignItems:"center", gap:6 }}>
          <Icon path={I.plus} size={14} /> Novo Compromisso
        </button>
      </div>

      {upcoming.length > 0 && <>
        <Label text="PRÓXIMOS" color="var(--accent)" />
        {upcoming.map(e => <Card key={e.id} e={e} />)}
      </>}
      {past.length > 0 && <>
        <Label text="PASSADOS" color="var(--text-3)" style={{ marginTop:20 }} />
        {past.map(e => <Card key={e.id} e={e} />)}
      </>}
      {events.length === 0 && <Empty text="Nenhum compromisso cadastrado." />}

      {modal && (
        <Modal title="Novo Compromisso" onClose={() => setModal(false)}>
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            <input style={inp} placeholder="Título" value={form.title} onChange={e => setForm({...form, title:e.target.value})} />
            <input style={inp} type="date" value={form.date} onChange={e => setForm({...form, date:e.target.value})} />
            <input style={inp} type="time" value={form.time} onChange={e => setForm({...form, time:e.target.value})} />
            <input style={inp} placeholder="Local (opcional)" value={form.local} onChange={e => setForm({...form, local:e.target.value})} />
            <select style={inp} value={form.cat} onChange={e => setForm({...form, cat:e.target.value})}>
              {cats.map(c => <option key={c}>{c}</option>)}
            </select>
            <textarea style={{ ...inp, resize:"vertical" }} rows={3} placeholder="Observações (opcional)" value={form.notes} onChange={e => setForm({...form, notes:e.target.value})} />
            <button onClick={add} style={primaryBtn()}>Salvar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── CURIOSITIES ─────────────────────────────────────────────────────────────
function CuriositiesSection() {
  const [cards, setCards]  = useState(() => S.get("curiosities", []));
  const [modal, setModal]  = useState(false);
  const [detail, setDetail] = useState(null);
  const [form, setForm]    = useState({ title:"", content:"", link:"", imageUrl:"", tag:"" });
  const [updTxt, setUpdTxt] = useState("");

  const add = () => {
    if (!form.title.trim()) return;
    const n = [...cards, { id:Date.now(), ...form, updates:[], created:now() }];
    setCards(n); S.set("curiosities", n); setModal(false); setForm({ title:"", content:"", link:"", imageUrl:"", tag:"" });
  };
  const addUpdate = (id) => {
    if (!updTxt.trim()) return;
    const n = cards.map(c => c.id===id ? {...c, updates:[...c.updates, {text:updTxt, date:now()}]} : c);
    setCards(n); S.set("curiosities", n); setDetail(n.find(c=>c.id===id)); setUpdTxt("");
  };
  const del = (id) => { const n = cards.filter(c => c.id!==id); setCards(n); S.set("curiosities", n); setDetail(null); };

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:20 }}>
        <button onClick={() => setModal(true)} style={{ ...primaryBtn(), display:"flex", alignItems:"center", gap:6 }}>
          <Icon path={I.plus} size={14} /> Nova Curiosidade
        </button>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))", gap:14 }}>
        {cards.map(c => (
          <div key={c.id} onClick={() => setDetail(c)}
            style={{ background:"var(--bg-card)", border:"1px solid var(--border)", borderRadius:16, overflow:"hidden", cursor:"pointer" }}>
            {c.imageUrl && <div style={{ height:120, background:`url(${c.imageUrl}) center/cover`, borderBottom:"1px solid var(--border)" }} />}
            <div style={{ padding:16 }}>
              {c.tag && <span style={{ background:"var(--bg-input)", borderRadius:4, padding:"2px 8px", fontSize:10, color:"var(--accent)", fontWeight:700, display:"inline-block", marginBottom:8, letterSpacing:1 }}>{c.tag.toUpperCase()}</span>}
              <div style={{ fontWeight:700, marginBottom:6, fontSize:14 }}>{c.title}</div>
              <div style={{ fontSize:12, color:"var(--text-3)", lineHeight:1.5, overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>{c.content}</div>
              {c.updates.length > 0 && <div style={{ fontSize:10, color:"var(--accent)", marginTop:10 }}>{c.updates.length} atualização(ões)</div>}
            </div>
          </div>
        ))}
      </div>
      {cards.length === 0 && <Empty text="Nenhuma curiosidade ainda. Adicione a primeira!" />}

      {modal && (
        <Modal title="Nova Curiosidade" onClose={() => setModal(false)} wide>
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            <input style={inp} placeholder="Título" value={form.title} onChange={e => setForm({...form, title:e.target.value})} />
            <input style={inp} placeholder="Tag / Categoria" value={form.tag} onChange={e => setForm({...form, tag:e.target.value})} />
            <textarea style={{ ...inp, resize:"vertical" }} rows={5} placeholder="Conteúdo / texto sobre o tema" value={form.content} onChange={e => setForm({...form, content:e.target.value})} />
            <input style={inp} placeholder="URL de imagem (opcional)" value={form.imageUrl} onChange={e => setForm({...form, imageUrl:e.target.value})} />
            <input style={inp} placeholder="Link de referência (opcional)" value={form.link} onChange={e => setForm({...form, link:e.target.value})} />
            <button onClick={add} style={primaryBtn()}>Salvar Card</button>
          </div>
        </Modal>
      )}

      {detail && (
        <Modal title={detail.title} onClose={() => setDetail(null)} wide>
          {detail.imageUrl && <img src={detail.imageUrl} alt="" style={{ width:"100%", borderRadius:10, marginBottom:16, maxHeight:240, objectFit:"cover" }} />}
          {detail.tag && <span style={{ background:"var(--bg-input)", borderRadius:4, padding:"2px 8px", fontSize:10, color:"var(--accent)", fontWeight:700, display:"inline-block", marginBottom:12, letterSpacing:1 }}>{detail.tag.toUpperCase()}</span>}
          <p style={{ color:"var(--text-2)", lineHeight:1.7, fontSize:14, marginBottom:16 }}>{detail.content}</p>
          {detail.link && <a href={detail.link} target="_blank" rel="noreferrer" style={{ color:"var(--accent)", fontSize:12, display:"flex", gap:6, alignItems:"center", marginBottom:16 }}><Icon path={I.link} size={14} />{detail.link}</a>}

          <div style={{ borderTop:"1px solid var(--border)", paddingTop:16 }}>
            <Label text="ATUALIZAÇÕES" color="var(--text-3)" />
            {detail.updates.map((u,i) => (
              <div key={i} style={{ background:"var(--bg-input)", borderRadius:10, padding:"10px 14px", marginBottom:10 }}>
                <div style={{ color:"var(--text-2)", fontSize:13, lineHeight:1.6 }}>{u.text}</div>
                <div style={{ fontSize:10, color:"var(--text-3)", marginTop:6 }}>🕐 {u.date}</div>
              </div>
            ))}
            <div style={{ display:"flex", gap:10, marginTop:12 }}>
              <textarea style={{ ...inp, flex:1, resize:"none" }} rows={2} placeholder="Adicionar atualização..." value={updTxt} onChange={e => setUpdTxt(e.target.value)} />
              <button onClick={() => addUpdate(detail.id)} style={{ ...primaryBtn("var(--green)"), alignSelf:"flex-end" }}>+</button>
            </div>
          </div>
          <button onClick={() => del(detail.id)} style={{ marginTop:16, background:"rgba(248,113,113,0.08)", border:"1px solid rgba(248,113,113,0.25)", borderRadius:10, padding:"8px 16px", color:"var(--red)", fontSize:13, cursor:"pointer" }}>
            Excluir card
          </button>
        </Modal>
      )}
    </div>
  );
}

// ─── NEWS BOARD ───────────────────────────────────────────────────────────────
const NEWS_CATS = ["GLOBAL/GEOPOLÍTICA","EUA","BRASIL","CHINA","GUERRAS","COMMODITIES","BOLSA","MOEDA","CRIPTO","GERAL"];
const MOCK_NEWS = {
  "GLOBAL/GEOPOLÍTICA": [{ t:"G7 reforça aliança comercial diante de tensões crescentes", s:"Reuters", time:"há 12min" },{ t:"ONU debate novo acordo climático em sessão emergencial", s:"AP", time:"há 28min" },{ t:"OTAN expande presença no leste europeu em 2026", s:"FT", time:"há 1h" }],
  "EUA":        [{ t:"Fed mantém juros: Powell sinaliza cautela para o segundo semestre", s:"Bloomberg", time:"há 5min" },{ t:"Déficit fiscal americano preocupa mercados globais", s:"WSJ", time:"há 45min" },{ t:"Nvidia anuncia novo chip com foco em IA industrial", s:"TechCrunch", time:"há 2h" }],
  "BRASIL":     [{ t:"Banco Central eleva projeção de crescimento para 2026", s:"Valor", time:"há 18min" },{ t:"Governo anuncia pacote de infraestrutura de R$ 80 bilhões", s:"Folha", time:"há 1h" },{ t:"Ibovespa fecha em leve queda após dados do PIB", s:"InfoMoney", time:"há 3h" }],
  "CHINA":      [{ t:"China registra superávit comercial recorde em abril", s:"Xinhua", time:"há 30min" },{ t:"Tensão no estreito de Taiwan eleva prêmio de risco asiático", s:"Reuters", time:"há 2h" },{ t:"BYD ultrapassa Tesla em vendas globais pelo terceiro mês", s:"Bloomberg", time:"há 4h" }],
  "GUERRAS":    [{ t:"Negociações de cessar-fogo em andamento no Médio Oriente", s:"BBC", time:"há 8min" },{ t:"Ucrânia relata avanços no front norte após contraofensiva", s:"Reuters", time:"há 1h" },{ t:"ONU reporta crise humanitária em zona de conflito africana", s:"AP", time:"há 3h" }],
  "COMMODITIES":[{ t:"Petróleo sobe com tensões no Golfo Pérsico", s:"Bloomberg", time:"há 22min" },{ t:"Soja atinge máxima do ano puxada por clima adverso no Brasil", s:"AgFax", time:"há 1h" },{ t:"Minério de ferro recua com fraqueza na demanda chinesa", s:"FT", time:"há 2h" }],
  "BOLSA":      [{ t:"S&P 500 avança impulsionado por resultados do setor de tecnologia", s:"CNBC", time:"há 10min" },{ t:"Ibovespa cai 0.3% com pressão sobre papéis de bancos", s:"Infomoney", time:"há 35min" },{ t:"Europa fecha mista em sessão de realizações após máximas", s:"Reuters", time:"há 2h" }],
  "MOEDA":      [{ t:"Real se aprecia com entrada de capital estrangeiro", s:"Valor", time:"há 15min" },{ t:"Dólar recua ante moedas emergentes após dados de inflação", s:"Bloomberg", time:"há 1h" },{ t:"Euro oscila com dados mistos da zona do euro", s:"Reuters", time:"há 3h" }],
  "CRIPTO":     [{ t:"Bitcoin supera US$ 94k: analistas veem caminho para US$ 100k", s:"CoinDesk", time:"há 7min" },{ t:"Ethereum consolida ganhos após atualização de protocolo", s:"Decrypt", time:"há 40min" },{ t:"SEC aprova novo ETF de altcoins para mercado americano", s:"Reuters", time:"há 2h" }],
  "GERAL":      [{ t:"IA generativa transforma mercado de trabalho em setores-chave", s:"MIT Tech Review", time:"há 20min" },{ t:"Pesquisa aponta queda na confiança do consumidor global", s:"Economist", time:"há 1h" },{ t:"Startups de fintech captam recorde em rodadas série B", s:"TechCrunch", time:"há 3h" }],
};

function NewsBoardSection() {
  const [active, setActive] = useState(null);
  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
        <div style={{ fontSize:11, color:"var(--text-3)" }}>Dados simulados · integração de feeds em breve</div>
        <LiveBadge />
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(290px,1fr))", gap:14 }}>
        {NEWS_CATS.map(cat => (
          <div key={cat} style={{ background:"var(--bg-card)", border:"1px solid var(--border)", borderRadius:14, overflow:"hidden" }}>
            <div style={{ padding:"10px 16px", background:"var(--bg-bar)", borderBottom:"1px solid var(--border)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontSize:10, fontWeight:800, color:"var(--accent)", letterSpacing:2 }}>{cat}</span>
              <span style={{ fontSize:9, color:"var(--text-3)" }}>3 matérias</span>
            </div>
            {(MOCK_NEWS[cat]||[]).map((n,i) => (
              <div key={i} onClick={() => setActive(n)} style={{ padding:"10px 16px", borderBottom: i<2?"1px solid var(--border-2)":"none", cursor:"pointer" }}>
                <div style={{ fontSize:13, color:"var(--text-1)", lineHeight:1.5, marginBottom:4 }}>{n.t}</div>
                <div style={{ display:"flex", gap:10, fontSize:10, color:"var(--text-3)" }}><span>{n.s}</span><span>{n.time}</span></div>
              </div>
            ))}
          </div>
        ))}
      </div>
      {active && (
        <Modal title={active.t} onClose={() => setActive(null)}>
          <div style={{ fontSize:12, color:"var(--text-3)", marginBottom:16 }}>{active.s} · {active.time}</div>
          <p style={{ color:"var(--text-2)", lineHeight:1.7, fontSize:14 }}>Visualização rápida. Para o conteúdo completo, acesse a fonte original.</p>
          <a href="#" style={{ color:"var(--accent)", fontSize:13, display:"block", marginTop:12 }}>Abrir fonte original →</a>
        </Modal>
      )}
    </div>
  );
}

// ─── INDICATORS ───────────────────────────────────────────────────────────────
function IndicatorsSection() {
  const [monitor, setMonitor] = useState(false);
  const extras = [
    { l:"JUROS EUA (Fed Funds)", v:"5.25%",      s:"Próxima reunião: Jun 2026" },
    { l:"JUROS BR (Selic)",      v:"14.75%",     s:"Próxima reunião: Jul 2026" },
    { l:"INFLAÇÃO EUA (CPI)",    v:"3.2% a.a.",  s:"Divulgação: Jun 2026" },
    { l:"INFLAÇÃO BR (IPCA)",    v:"4.8% a.a.",  s:"Acumulado 12 meses" },
    { l:"PIB EUA",               v:"+2.4% a.a.", s:"Último dado: Q1 2026" },
    { l:"PIB BRASIL",            v:"+2.1% a.a.", s:"Último dado: Q1 2026" },
    { l:"PETRÓLEO (WTI)",        v:"$ 82.40",    s:"Variação: +0.8%" },
    { l:"PETRÓLEO (BRENT)",      v:"$ 85.10",    s:"Variação: +0.6%" },
    { l:"EURO / USD",            v:"1.0842",     s:"Variação: -0.2%" },
    { l:"GBP / USD",             v:"1.2715",     s:"Variação: +0.1%" },
    { l:"ETHEREUM",              v:"$ 3.240",    s:"Variação: +1.8%" },
    { l:"VIX (Medo)",            v:"17.4",       s:"Mercado: Calmo" },
  ];

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:24 }}>
        <LiveBadge label="TEMPO REAL · Atualiza a cada 3s" />
        <button onClick={() => setMonitor(!monitor)} style={{ background:"var(--bg-card)", border:"1px solid var(--border)", borderRadius:10, padding:"8px 16px", color:"var(--text-2)", fontSize:13, cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
          <Icon path={I.monitor} size={14} /> {monitor ? "Visão Completa" : "Monitor 1-Pager"}
        </button>
      </div>

      <MarketTicker />

      {!monitor && (
        <div style={{ marginTop:32, display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(270px,1fr))", gap:12 }}>
          {extras.map(x => (
            <div key={x.l} style={{ background:"var(--bg-card)", border:"1px solid var(--border)", borderRadius:12, padding:"14px 18px" }}>
              <div style={{ fontSize:10, color:"var(--text-3)", letterSpacing:1.5, fontWeight:700, marginBottom:6 }}>{x.l}</div>
              <div style={{ fontSize:20, fontWeight:800, fontFamily:"'DM Mono',monospace", marginBottom:4 }}>{x.v}</div>
              <div style={{ fontSize:11, color:"var(--text-3)" }}>{x.s}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── PROFESSIONAL PLACEHOLDER ─────────────────────────────────────────────────
function ProfessionalSection() {
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"80px 0", gap:16 }}>
      <Icon path={I.briefcase} size={52} color="var(--border)" />
      <div style={{ fontSize:16, color:"var(--text-3)", fontWeight:600 }}>Área Profissional</div>
      <div style={{ fontSize:13, color:"var(--border)", textAlign:"center", maxWidth:320 }}>Em construção. Em breve você poderá organizar projetos, tarefas e recursos profissionais aqui.</div>
    </div>
  );
}

// ─── SMALL HELPERS ────────────────────────────────────────────────────────────
const Empty = ({ text }) => (
  <div style={{ textAlign:"center", color:"var(--text-3)", padding:"40px 0", fontSize:14 }}>{text}</div>
);
const Label = ({ text, color, style: sx = {} }) => (
  <div style={{ fontSize:11, color: color||"var(--accent)", letterSpacing:2, fontWeight:700, marginBottom:14, paddingBottom:8, borderBottom:"1px solid var(--border-2)", ...sx }}>{text}</div>
);
const LiveBadge = ({ label = "LIVE" }) => (
  <div style={{ display:"flex", gap:6, alignItems:"center", color:"var(--green)", fontSize:12, fontWeight:600 }}>
    <span style={{ width:6, height:6, borderRadius:"50%", background:"var(--green)", display:"inline-block", animation:"pulse 2s infinite" }} />
    {label}
  </div>
);

// ─── APP SHELL ────────────────────────────────────────────────────────────────
const NAV = [
  { id:"pessoal",      label:"Pessoal",      icon: I.user },
  { id:"profissional", label:"Profissional", icon: I.briefcase },
  { id:"informacoes",  label:"Informações",  icon: I.info },
];
const TABS = {
  pessoal:      [{ id:"diario",        label:"Diário",       icon: I.diary    },
                 { id:"documentos",    label:"Documentos",   icon: I.folder   },
                 { id:"contas",        label:"Contas",       icon: I.bill     },
                 { id:"compromissos",  label:"Compromissos", icon: I.calendar }],
  profissional: [],
  informacoes:  [{ id:"curiosidades",  label:"Curiosidades", icon: I.star     },
                 { id:"noticias",      label:"Notícias",     icon: I.newspaper},
                 { id:"indicadores",   label:"Indicadores",  icon: I.chart    }],
};

export default function App() {
  const [section, setSection] = useState("pessoal");
  const [subTab,  setSubTab]  = useState("diario");

  useEffect(() => {
    const tabs = TABS[section];
    setSubTab(tabs.length > 0 ? tabs[0].id : "");
  }, [section]);

  const renderContent = () => {
    if (section === "profissional") return <ProfessionalSection />;
    switch (subTab) {
      case "diario":       return <DiarySection />;
      case "documentos":   return <DocsSection />;
      case "contas":       return <BillsSection />;
      case "compromissos": return <EventsSection />;
      case "curiosidades": return <CuriositiesSection />;
      case "noticias":     return <NewsBoardSection />;
      case "indicadores":  return <IndicatorsSection />;
      default:             return null;
    }
  };

  return (
    <div style={{ minHeight:"100vh", display:"flex", flexDirection:"column" }}>

      {/* ── TOP BAR ── */}
      <header style={{ background:"var(--bg-bar)", borderBottom:"1px solid var(--border)", padding:"0 32px", display:"flex", alignItems:"center", justifyContent:"space-between", height:56, flexShrink:0 }}>

        {/* Logo */}
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:30, height:30, borderRadius:9, background:"linear-gradient(135deg,#4f8ef7,#8b5cf6)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, fontWeight:900, color:"#fff", letterSpacing:-1 }}>P</div>
          <div>
            <div style={{ fontWeight:800, fontSize:12, letterSpacing:1.5, color:"var(--text-1)", lineHeight:1 }}>PAINEL DE CONTROLE</div>
            <div style={{ fontWeight:400, fontSize:9, letterSpacing:2, color:"var(--text-3)", lineHeight:1, marginTop:2 }}>PESSOAL</div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ display:"flex", gap:2 }}>
          {NAV.map(n => (
            <button key={n.id} onClick={() => setSection(n.id)}
              style={{ background: section===n.id ? "var(--accent-dim)" : "none", border: section===n.id ? "1px solid var(--accent-bdr)" : "1px solid transparent", borderRadius:9, padding:"6px 16px", color: section===n.id ? "var(--accent)" : "var(--text-3)", fontSize:13, fontWeight: section===n.id ? 700 : 500, cursor:"pointer", display:"flex", alignItems:"center", gap:7, transition:"all .2s" }}>
              <Icon path={n.icon} size={14} /> {n.label}
            </button>
          ))}
        </nav>

        {/* Ticker */}
        <MarketTicker compact />
      </header>

      {/* ── SUB TABS ── */}
      {TABS[section]?.length > 0 && (
        <div style={{ background:"var(--bg-sub)", borderBottom:"1px solid var(--border-2)", padding:"0 32px", display:"flex", gap:4 }}>
          {TABS[section].map(t => (
            <button key={t.id} onClick={() => setSubTab(t.id)}
              style={{ background:"none", border:"none", padding:"11px 16px", color: subTab===t.id ? "var(--text-1)" : "var(--text-3)", fontSize:13, fontWeight: subTab===t.id ? 700 : 400, cursor:"pointer", borderBottom: subTab===t.id ? "2px solid var(--accent)" : "2px solid transparent", display:"flex", alignItems:"center", gap:6, transition:"all .2s" }}>
              <Icon path={t.icon} size={13} /> {t.label}
            </button>
          ))}
        </div>
      )}

      {/* ── CONTENT ── */}
      <main style={{ flex:1, padding:32, maxWidth:1280, width:"100%", margin:"0 auto", animation:"fadeIn .25s ease" }}>
        {renderContent()}
      </main>

      {/* ── FOOTER ── */}
      <footer style={{ borderTop:"1px solid var(--border-2)", padding:"10px 32px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span style={{ fontSize:10, color:"var(--border)", letterSpacing:1 }}>PAINEL DE CONTROLE PESSOAL · v1.0</span>
        <span style={{ fontSize:10, color:"var(--border)" }}>{new Date().toLocaleDateString("pt-BR")}</span>
      </footer>
    </div>
  );
}
