import { useState, useEffect, useRef, useCallback } from "react";

// ─── ICONS ───────────────────────────────────────────────────────────────────
const Icon = ({ path, size = 18, color = "currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={path} />
  </svg>
);
const I = {
  x:       "M18 6 6 18 M6 6l12 12",
  trash:   "M3 6h18 M19 6l-1 14H6L5 6 M8 6V4h8v2",
  check:   "M20 6 9 17l-5-5",
  plus:    "M12 5v14 M5 12h14",
  edit:    "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z",
  bell:    "M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 0 1-3.46 0",
  back:    "M19 12H5 M12 19l-7-7 7-7",
  refresh: "M23 4v6h-6 M1 20v-6h6 M3.51 9a9 9 0 0 1 14.85-3.36L23 10 M1 14l4.64 4.36A9 9 0 0 0 20.49 15",
  monitor: "M8 21h8 M12 17v4 M2 3h20v14H2z",
  link:    "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  folder:  "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z",
  down:    "M6 9l6 6 6-6",
  up:      "M18 15l-6-6-6 6",
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const now     = () => new Date().toLocaleString("pt-BR");
const nowISO  = () => new Date().toISOString();
const fmtMoney= (v) => Number(v).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const fmtNum  = (v, dec=2) => Number(v).toLocaleString("pt-BR",{minimumFractionDigits:dec,maximumFractionDigits:dec});
const fmtPct  = (v) => v!=null&&!isNaN(v) ? `${Number(v)>=0?"+":""}${Number(v).toFixed(2)}%` : "--";
const fmt$    = (v,pre="",dec=2) => v!=null&&!isNaN(v) ? `${pre}${fmtNum(v,dec)}` : "--";

// ─── STORAGE ─────────────────────────────────────────────────────────────────
const S = {
  get:(k,d)=>{ try{ const v=localStorage.getItem(k); return v?JSON.parse(v):d; }catch{return d;} },
  set:(k,v)=>{ try{ localStorage.setItem(k,JSON.stringify(v)); }catch{} },
};

// ─── DB SYNC ─────────────────────────────────────────────────────────────────
const DB = {
  list:  async (t)=>{ try{ const r=await fetch(`/api/db?table=${t}`); return await r.json(); }catch{return null;} },
  insert:async (t,row)=>{ try{ await fetch(`/api/db?table=${t}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(row)}); }catch{} },
  update:async (t,row)=>{ try{ await fetch(`/api/db?table=${t}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(row)}); }catch{} },
  delete:async (t,id)=>{
    const r=await fetch(`/api/db?table=${t}&id=${id}`,{method:"DELETE"});
    if(!r.ok) throw new Error(`Delete failed ${r.status}`);
  },
};

// ── Generic key/value cloud sync (whiteboard, dayboard, letreiro, dj banks) ──
const KV = {
  get: async (key) => {
    try {
      const r = await fetch(`/api/db?table=sync_kv&key=${encodeURIComponent(key)}`);
      const v = await r.json();
      return v ? JSON.parse(v) : null;
    } catch { return null; }
  },
  set: async (key, value) => {
    try {
      await fetch(`/api/db?table=sync_kv`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: JSON.stringify(value) }),
      });
    } catch {}
  },
  del: async (key) => {
    try { await fetch(`/api/db?table=sync_kv&key=${encodeURIComponent(key)}`, { method: "DELETE" }); } catch {}
  },
};

// useKV — like useState but synced to cloud + localStorage, with polling
function useKV(key, def) {
  const [data, setData] = useState(() => {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch { return def; }
  });
  const [synced, setSynced] = useState(false);
  const dataRef = useRef(data);
  dataRef.current = data;
  const savingRef = useRef(false); // true briefly after a local save, to avoid self-clobber

  const pull = () => {
    KV.get(key).then(cloud => {
      if (cloud !== null && !savingRef.current) {
        // Only update if actually different (avoid needless re-renders)
        const cloudStr = JSON.stringify(cloud);
        const localStr = JSON.stringify(dataRef.current);
        if (cloudStr !== localStr) {
          setData(cloud);
          try { localStorage.setItem(key, cloudStr); } catch {}
        }
      }
      setSynced(true);
    });
  };

  // On mount: pull from cloud
  useEffect(() => { pull(); }, [key]);

  // Poll every 5s so other devices' changes appear without reload
  useEffect(() => {
    const id = setInterval(pull, 5000);
    return () => clearInterval(id);
  }, [key]);

  // Also re-sync when tab/app regains focus (covers app switching on mobile)
  useEffect(() => {
    const onFocus = () => pull();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', () => { if(!document.hidden) pull(); });
    return () => window.removeEventListener('focus', onFocus);
  }, [key]);

  const save = (next) => {
    const value = typeof next === 'function' ? next(dataRef.current) : next;
    setData(value);
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
    savingRef.current = true;
    KV.set(key, value).finally(() => {
      setTimeout(() => { savingRef.current = false; }, 1000);
    });
    return value;
  };

  return [data, save, synced];
}

function useDB(table, localKey, def=[]) {
  // localStorage é apenas cache de exibição rápida — banco é a única fonte da verdade
  const [data, setData] = useState(()=>{ try{ const v=localStorage.getItem(localKey); return v?JSON.parse(v):def; }catch{return def;} });
  const [synced, setSynced] = useState(false);
  const dataRef    = useRef(data);
  dataRef.current  = data;
  const writingRef = useRef(false); // bloqueia poll enquanto operação local está em andamento
  const timerRef   = useRef(null);

  const lock = () => {
    writingRef.current = true;
    clearTimeout(timerRef.current);
    // desbloqueia após tempo suficiente para o banco confirmar (6s é seguro)
    timerRef.current = setTimeout(() => { writingRef.current = false; }, 6000);
  };

  const applyRows = (rows) => {
    // Normaliza id para Number — banco pode retornar string, local usa Number
    const normalized = rows.map(r => ({...r, id: Number(r.id)}));
    const sorted = [...normalized].sort((a,b)=>b.id-a.id);
    setData(sorted);
    try { localStorage.setItem(localKey, JSON.stringify(sorted)); } catch {}
    setSynced(true);
  };

  const pull = async () => {
    if (writingRef.current) return; // operação local em andamento — não sobrescrever
    const rows = await DB.list(table);
    if (writingRef.current) return; // re-checagem pós-await
    if (!rows || !Array.isArray(rows)) return;
    applyRows(rows);
  };

  // Mount: carrega do banco (sem re-inserir nada do localStorage)
  useEffect(() => {
    DB.list(table).then(rows => {
      if (rows && Array.isArray(rows)) applyRows(rows);
      else setSynced(true);
    });
  }, [table]);

  // Pull ref garante que o setInterval sempre chama a versão atual de pull
  const pullRef = useRef(pull);
  pullRef.current = pull;

  // Poll a cada 5s
  useEffect(() => {
    const id = setInterval(() => pullRef.current(), 5000);
    return () => clearInterval(id);
  }, [table]);

  // Re-sync ao focar/retornar ao app
  useEffect(() => {
    const onVisible = () => { if (!document.hidden && !writingRef.current) pull(); };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.removeEventListener('focus', onVisible); document.removeEventListener('visibilitychange', onVisible); };
  }, [table]);

  // setData que bloqueia o poll temporariamente — usado por toda operação de escrita/delete
  const setDataSafe = (next) => {
    lock();
    const value = typeof next === 'function' ? next(dataRef.current) : next;
    setData(value);
    try { localStorage.setItem(localKey, JSON.stringify(value)); } catch {}
  };

  return [data, setDataSafe, synced];
}

// ─── SHARED UI ───────────────────────────────────────────────────────────────
const inp = { width:"100%",background:"var(--bg-input)",border:"1px solid var(--border)",borderRadius:10,padding:"10px 14px",color:"var(--text-1)",fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"inherit" };
const btn = (c="var(--accent)") => ({ background:c,border:"none",borderRadius:10,padding:"10px 20px",color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer",fontFamily:"inherit" });

function Modal({ title, onClose, children, wide }) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",backdropFilter:"blur(8px)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:20,width:"100%",maxWidth:wide?760:520,maxHeight:"85vh",overflow:"auto",animation:"fadeIn .2s ease"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"20px 24px",borderBottom:"1px solid var(--border)"}}>
          <span style={{fontWeight:700,fontSize:16}}>{title}</span>
          <button onClick={onClose} style={{background:"none",border:"none",color:"var(--text-3)",cursor:"pointer"}}><Icon path={I.x} size={20}/></button>
        </div>
        <div style={{padding:24}}>{children}</div>
      </div>
    </div>
  );
}

const Empty = ({text})=><div style={{textAlign:"center",color:"var(--text-3)",padding:"40px 0",fontSize:14}}>{text}</div>;
const LiveBadge = ({label="LIVE"})=>(
  <div style={{display:"flex",gap:6,alignItems:"center",color:"var(--green)",fontSize:12,fontWeight:600}}>
    <span style={{width:6,height:6,borderRadius:"50%",background:"var(--green)",display:"inline-block",animation:"pulse 2s infinite"}}/>
    {label}
  </div>
);

// ─── MARKET DATA ─────────────────────────────────────────────────────────────
function useMarketData() {
  const [data, setData] = useState({
    dolar:{val:"--",chg:"--"}, ibov:{val:"--",chg:"--"},
    sp500:{val:"--",chg:"--"}, ouro:{val:"--",chg:"--"},
    btc:  {val:"--",chg:"--"}, euro:{val:"--",chg:"--"},
  });
  const [loading, setLoading] = useState(true);

  const fetch_ = async () => {
    try {
      const r = await fetch("/api/market");
      const d = await r.json();
      setData({
        dolar:{val:fmt$(d.dolar?.price,"R$ "),  chg:fmtPct(d.dolar?.chg)},
        ibov: {val:fmt$(d.ibov?.price,"",0),    chg:fmtPct(d.ibov?.chg)},
        sp500:{val:fmt$(d.sp500?.price,"",0),   chg:fmtPct(d.sp500?.chg)},
        ouro: {val:fmt$(d.ouro?.price,"R$ ",0), chg:fmtPct(d.ouro?.chg)},
        btc:  {val:fmt$(d.btc?.price,"$ ",0),   chg:fmtPct(d.btc?.chg)},
        euro: {val:fmt$(d.euro?.price,"R$ "),   chg:fmtPct(d.euro?.chg)},
      });
      setLoading(false);
    } catch {}
  };

  useEffect(()=>{ fetch_(); const id=setInterval(fetch_,90000); return()=>clearInterval(id); },[]);
  return {data,loading,refresh:fetch_};
}

// ─── WEATHER ─────────────────────────────────────────────────────────────────
function useWeather() {
  const [weather, setWeather] = useState(null);
  useEffect(()=>{
    if(!navigator.geolocation){ setWeather({error:"GPS indisponível"}); return; }
    navigator.geolocation.getCurrentPosition(async pos=>{
      try {
        const {latitude:lat,longitude:lon} = pos.coords;
        const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto`);
        const d = await r.json();
        const c = d.current;
        const codes = {0:"☀️ Céu limpo",1:"🌤 Quase limpo",2:"⛅ Parcialmente nublado",3:"☁️ Nublado",45:"🌫 Névoa",48:"🌫 Névoa com gelo",51:"🌦 Chuvisco leve",61:"🌧 Chuva leve",63:"🌧 Chuva moderada",65:"🌧 Chuva forte",71:"❄️ Neve leve",80:"🌦 Aguaceiros",95:"⛈ Tempestade"};
        setWeather({ temp:c.temperature_2m, humidity:c.relative_humidity_2m, wind:c.wind_speed_10m, desc:codes[c.weather_code]||"🌡 Variável", unit:d.current_units?.temperature_2m||"°C" });
        // Reverse geocode
        const geo = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`);
        const gd  = await geo.json();
        setWeather(prev=>({...prev, city: gd.address?.city||gd.address?.town||gd.address?.county||"Sua localização"}));
      } catch { setWeather({error:"Erro ao buscar clima"}); }
    }, ()=>setWeather({error:"Permissão negada"}));
  },[]);
  return weather;
}

// ─── TICKER STRIP ────────────────────────────────────────────────────────────
function TickerStrip({ market }) {
  const { data, loading } = market;
  const items = [
    {l:"DÓLAR",   v:data.dolar.val, c:data.dolar.chg, color:"var(--green)" },
    {l:"IBOV",    v:data.ibov.val,  c:data.ibov.chg,  color:"var(--accent)"},
    {l:"S&P 500", v:data.sp500.val, c:data.sp500.chg, color:"var(--purple)"},
    {l:"OURO",    v:data.ouro.val,  c:data.ouro.chg,  color:"var(--yellow)"},
    {l:"BITCOIN", v:data.btc.val,   c:data.btc.chg,   color:"var(--orange)"},
    {l:"EURO",    v:data.euro.val,  c:data.euro.chg,  color:"var(--text-2)"},
  ];
  const isUp = c => c && !c.startsWith("-") && c!=="--";
  return (
    <div style={{display:"flex",gap:28,alignItems:"center",overflowX:"auto",paddingBottom:2}}>
      {items.map(i=>(
        <div key={i.l} style={{display:"flex",flexDirection:"column",flexShrink:0}}>
          <span style={{fontSize:9,color:"var(--text-3)",letterSpacing:1,fontWeight:700}}>{i.l}</span>
          <span style={{fontSize:13,fontWeight:700,color:loading?"var(--text-3)":i.color,fontFamily:"'DM Mono',monospace"}}>{loading?"···":i.v}</span>
          <span style={{fontSize:10,color:isUp(i.c)?"var(--green)":i.c==="--"?"var(--text-3)":"var(--red)"}}>
            {!loading&&i.c!=="--"?(isUp(i.c)?"▲":"▼")+" "+i.c:""}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── DIARY CARDS ─────────────────────────────────────────────────────────────
function NoteColumn({ storageKey, title, placeholder, accent, emoji, hasCheck }) {
  const [entries, setEntries, synced] = useKV(storageKey+"_v1",[]);
  const [text, setText] = useState("");
  const [mood, setMood] = useState("🙂");
  const moods = ["😄","🙂","😐","😔","😤","🤔","🎉"];
  const showMoods = storageKey === "diary";

  const add = () => {
    if(!text.trim()) return;
    const e = {id:Date.now(), text, mood, done:false, date:nowISO()};
    const n = [e, ...entries];
    setEntries(n); setText("");
  };
  const del  = id => { setEntries(p=>p.filter(e=>e.id!==id)); };
  const tick = id => {
    const cur = entries.find(e=>e.id===id);
    const n = entries.map(e=>e.id===id?{...e,done:!e.done}:e);
    setEntries(n);
  };

  // Group by day
  const grouped = entries.reduce((acc, e) => {
    const d = new Date(e.date).toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
    (acc[d] = acc[d] || []).push(e); return acc;
  }, {});

  return (
    <div>
      {/* Input box */}
      <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:14,padding:16,marginBottom:24}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          {showMoods && (
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {moods.map(m=><button key={m} onClick={()=>setMood(m)} style={{fontSize:20,background:mood===m?"var(--bg-input)":"none",border:mood===m?`1px solid ${accent}`:"1px solid transparent",borderRadius:8,padding:"3px 7px",cursor:"pointer"}}>{m}</button>)}
            </div>
          )}
          <span style={{fontSize:9,color:synced?"var(--green)":"var(--text-3)",marginLeft:"auto"}}>
            {synced?"☁ sync":"syncing..."}
          </span>
        </div>
        <textarea value={text} onChange={e=>setText(e.target.value)} placeholder={placeholder} rows={3}
          style={{...inp,resize:"vertical",marginBottom:10,fontSize:13}}
          onKeyDown={e=>{if(e.ctrlKey&&e.key==="Enter")add();}}/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:10,color:"var(--text-3)"}}>{entries.length} registro{entries.length!==1?"s":""}</span>
          <button onClick={add} style={{...btn(accent),padding:"8px 20px"}}>+ Salvar</button>
        </div>
      </div>

      {/* Cards grouped by day */}
      {Object.entries(grouped).map(([date, es]) => (
        <div key={date} style={{marginBottom:28}}>
          {/* Day header */}
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
            <div style={{height:1,flex:1,background:"var(--border-2)"}}/>
            <span style={{fontSize:10,color:accent,letterSpacing:2,fontWeight:800,whiteSpace:"nowrap"}}>{date.toUpperCase()}</span>
            <div style={{height:1,flex:1,background:"var(--border-2)"}}/>
          </div>
          {/* Cards row — masonry-like, no stretching */}
          <div style={{columns:"300px",columnGap:12}}>
            {es.map(e=>(
              <div key={e.id} style={{
                breakInside:"avoid",
                background:"var(--bg-card)",
                border:"1px solid var(--border)",
                borderRadius:12,
                padding:"12px 14px",
                marginBottom:12,
                display:"flex",
                gap:10,
                alignItems:"flex-start",
                opacity: e.done ? 0.55 : 1,
              }}>
                {hasCheck && (
                  <button onClick={()=>tick(e.id)} style={{width:20,height:20,borderRadius:5,border:`2px solid ${e.done?"var(--green)":"var(--border)"}`,background:e.done?"var(--green)":"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:2}}>
                    {e.done&&<Icon path={I.check} size={11} color="#fff"/>}
                  </button>
                )}
                {showMoods && <span style={{fontSize:20,flexShrink:0,lineHeight:1.4}}>{e.mood}</span>}
                <div style={{flex:1,minWidth:0}}>
                  <p style={{margin:0,color:"var(--text-1)",lineHeight:1.65,fontSize:13,whiteSpace:"pre-wrap",wordBreak:"break-word",textDecoration:e.done?"line-through":"none"}}>{e.text}</p>
                  <span style={{fontSize:10,color:"var(--text-3)",marginTop:5,display:"block"}}>
                    🕐 {new Date(e.date).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}
                  </span>
                </div>
                <button onClick={()=>del(e.id)} style={{background:"none",border:"none",color:"var(--text-3)",cursor:"pointer",flexShrink:0,marginTop:2}}>
                  <Icon path={I.trash} size={12}/>
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
      {entries.length===0&&<Empty text="Nenhum registro ainda"/>}
    </div>
  );
}


// ─── DAY BOARD (whiteboard de post-its por dia) ───────────────────────────────
const DB_BOARD_KEY = 'dayboard_v1';

// Cores dos post-its
const POST_COLORS = [
  '#FFE066','#FFB347','#FF6B6B','#C3E88D','#89DDFF','#C792EA','#F78C6C','#80CBC4',
];

// loadBoards / saveBoards — localStorage only (fast local access)
// Cloud sync is handled by useKV inside DayBoardPage
function loadBoards() {
  try { const r = localStorage.getItem(DB_BOARD_KEY); return r ? JSON.parse(r) : {}; } catch { return {}; }
}
function saveBoards(boards) {
  try { localStorage.setItem(DB_BOARD_KEY, JSON.stringify(boards)); } catch {}
}

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function fmtBoardDate(key) {
  const [y,m,d] = key.split('-');
  const dt = new Date(Number(y), Number(m)-1, Number(d));
  return dt.toLocaleDateString('pt-BR', {weekday:'long', day:'numeric', month:'long', year:'numeric'});
}

function DayBoardCanvas({ dayKey, readOnly, onAddNode }) {
  const [nodes,      setNodes]      = useState([]);
  const [edges,      setEdges]      = useState([]);
  const [selected,   setSelected]   = useState(null);
  const [editing,    setEditing]    = useState(null);
  const [connecting, setConnecting] = useState(null);
  const [pan,        setPan]        = useState({ x:40, y:40 });
  const [scale,      setScale]      = useState(1);

  const ref = useRef({});
  ref.current = { nodes, edges, pan, scale, selected, editing, connecting, readOnly };

  const containerRef = useRef(null);
  const mouseDrag    = useRef(null);
  const savingRef    = useRef(false); // true briefly after local save — avoid self-clobber from poll
  const loadedOnceRef = useRef(false);

  // Initial load: localStorage first (instant), then cloud (authoritative)
  useEffect(() => {
    loadedOnceRef.current = false;
    const b = loadBoards()[dayKey] || { nodes:[], edges:[] };
    setNodes(b.nodes||[]); setEdges(b.edges||[]);
    setSelected(null); setEditing(null); setConnecting(null);
    setPan({x:40,y:40}); setScale(1);

    KV.get(DB_BOARD_KEY).then(cloud => {
      if (cloud && cloud[dayKey]) {
        const cb = cloud[dayKey];
        setNodes(cb.nodes||[]);
        setEdges(cb.edges||[]);
        const all = loadBoards(); all[dayKey] = cb;
        try { localStorage.setItem(DB_BOARD_KEY, JSON.stringify(all)); } catch {}
      }
      loadedOnceRef.current = true;
    });
  }, [dayKey]);

  // Save to localStorage + cloud whenever nodes/edges change (debounced via savingRef)
  useEffect(() => {
    if (!loadedOnceRef.current) return; // don't save before initial cloud pull completes
    const boards = loadBoards();
    boards[dayKey] = { nodes, edges };
    try { localStorage.setItem(DB_BOARD_KEY, JSON.stringify(boards)); } catch {}
    savingRef.current = true;
    KV.set(DB_BOARD_KEY, boards).finally(() => {
      setTimeout(() => { savingRef.current = false; }, 1200);
    });
  }, [nodes, edges, dayKey]);

  // Poll cloud every 5s for this specific day — pick up changes from other devices
  useEffect(() => {
    const id = setInterval(() => {
      if (savingRef.current) return; // don't clobber an in-flight local save
      // Don't interrupt active editing
      if (ref.current.editing) return;
      KV.get(DB_BOARD_KEY).then(cloud => {
        if (!cloud || !cloud[dayKey]) return;
        const cb = cloud[dayKey];
        const newStr = JSON.stringify({nodes:cb.nodes||[], edges:cb.edges||[]});
        const curStr = JSON.stringify({nodes:ref.current.nodes, edges:ref.current.edges});
        if (newStr !== curStr) {
          setNodes(cb.nodes||[]);
          setEdges(cb.edges||[]);
          const all = loadBoards(); all[dayKey] = cb;
          try { localStorage.setItem(DB_BOARD_KEY, JSON.stringify(all)); } catch {}
        }
      });
    }, 5000);
    return () => clearInterval(id);
  }, [dayKey]);

  // Re-sync on focus/visibility change
  useEffect(() => {
    const onFocus = () => {
      if (ref.current.editing) return;
      KV.get(DB_BOARD_KEY).then(cloud => {
        if (!cloud || !cloud[dayKey]) return;
        const cb = cloud[dayKey];
        setNodes(cb.nodes||[]);
        setEdges(cb.edges||[]);
      });
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', () => { if(!document.hidden) onFocus(); });
    return () => window.removeEventListener('focus', onFocus);
  }, [dayKey]);

  const nextColor = n => POST_COLORS[n % POST_COLORS.length];
  const makeNode  = (x, y, color, text) => ({
    id: Date.now()+Math.random(), x, y, w:160, h:110,
    color: color||nextColor(0), text:text||'',
  });
  const toWorld = (cx, cy) => ({
    x:(cx-ref.current.pan.x)/ref.current.scale,
    y:(cy-ref.current.pan.y)/ref.current.scale,
  });

  // Expose addNode to parent button
  useEffect(() => {
    if (!onAddNode) return;
    onAddNode(() => {
      const { pan, scale, nodes } = ref.current;
      const col = nodes.length % 4;
      const row = Math.floor(nodes.length / 4);
      const node = makeNode(
        (-pan.x/scale)+40+col*200,
        (-pan.y/scale)+40+row*140,
        nextColor(nodes.length)
      );
      setNodes(n => [...n, node]);
      setSelected(node.id); setEditing(node.id);
    });
  }, [onAddNode]);

  // Mouse wheel zoom
  useEffect(() => {
    const el = containerRef.current; if(!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 0.9;
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setScale(prev => {
        const next = Math.min(3, Math.max(0.25, prev * factor));
        const ratio = next / prev;
        setPan(p => ({ x: cx-(cx-p.x)*ratio, y: cy-(cy-p.y)*ratio }));
        return next;
      });
    };
    el.addEventListener('wheel', onWheel, { passive:false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Global mouse move/up
  useEffect(() => {
    const onMove = (e) => {
      const d = mouseDrag.current; if(!d) return;
      const dx = e.clientX-d.sx, dy = e.clientY-d.sy;
      if (d.kind==='pan') setPan({ x:d.ox+dx, y:d.oy+dy });
      else if (d.kind==='node') {
        const s = ref.current.scale;
        setNodes(ns => ns.map(n => n.id===d.id ? {...n,x:d.ox+dx/s,y:d.oy+dy/s} : n));
      }
    };
    const onUp = () => { mouseDrag.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    return () => { window.removeEventListener('mousemove',onMove); window.removeEventListener('mouseup',onUp); };
  }, []);

  // Touch events — completely separate from mouse/pointer
  useEffect(() => {
    const el = containerRef.current; if(!el) return;
    const dist  = (a,b) => Math.hypot(a.clientX-b.clientX, a.clientY-b.clientY);
    const midXY = (a,b,r) => ({ x:(a.clientX+b.clientX)/2-r.left, y:(a.clientY+b.clientY)/2-r.top });

    const ts = {
      fingers:0, panOx:0, panOy:0, t0x:0, t0y:0,
      lastDist:0, lastMidX:0, lastMidY:0,
      nodeDrag:null, isPanning:false, moved:false,
    };

    const onTouchStart = (e) => {
      ts.fingers = e.touches.length;
      ts.moved   = false;
      if (e.touches.length === 2) {
        e.preventDefault();
        ts.nodeDrag = null; ts.isPanning = false;
        const [a,b] = [e.touches[0],e.touches[1]];
        const r = el.getBoundingClientRect();
        ts.lastDist = dist(a,b);
        const m = midXY(a,b,r); ts.lastMidX=m.x; ts.lastMidY=m.y;
        ts.panOx = ref.current.pan.x; ts.panOy = ref.current.pan.y;
      } else if (e.touches.length === 1) {
        const t = e.touches[0];
        ts.t0x=t.clientX; ts.t0y=t.clientY;
        ts.panOx=ref.current.pan.x; ts.panOy=ref.current.pan.y;
        const nodeEl = t.target.closest('[data-nid]');
        if (nodeEl && !ref.current.readOnly && !ref.current.editing) {
          const nid  = nodeEl.getAttribute('data-nid');
          const node = ref.current.nodes.find(n => String(n.id)===nid);
          if (node) { ts.nodeDrag={id:node.id,ox:node.x,oy:node.y}; ts.isPanning=false; return; }
        }
        ts.nodeDrag = null; ts.isPanning = !ref.current.editing;
      }
    };

    const onTouchMove = (e) => {
      e.preventDefault();
      ts.fingers = e.touches.length;
      if (e.touches.length === 2) {
        const [a,b] = [e.touches[0],e.touches[1]];
        const r = el.getBoundingClientRect();
        const newDist = dist(a,b);
        const m = midXY(a,b,r);
        if (ts.lastDist > 0) {
          const f = newDist/ts.lastDist;
          const pdx=m.x-ts.lastMidX, pdy=m.y-ts.lastMidY;
          setScale(prev => {
            const next = Math.min(3, Math.max(0.25, prev*f));
            const ratio = next/prev;
            setPan(p => ({
              x: m.x-(ts.lastMidX-p.x)*ratio+pdx,
              y: m.y-(ts.lastMidY-p.y)*ratio+pdy,
            }));
            return next;
          });
        }
        ts.lastDist=newDist; ts.lastMidX=m.x; ts.lastMidY=m.y;
      } else if (e.touches.length === 1) {
        const t = e.touches[0];
        const dx = t.clientX-ts.t0x, dy = t.clientY-ts.t0y;
        if (!ts.moved && Math.hypot(dx,dy)>8) ts.moved=true;
        if (!ts.moved) return;
        if (ts.nodeDrag) {
          const s=ref.current.scale;
          setNodes(ns=>ns.map(n=>n.id===ts.nodeDrag.id?{...n,x:ts.nodeDrag.ox+dx/s,y:ts.nodeDrag.oy+dy/s}:n));
        } else if (ts.isPanning && !ref.current.editing) {
          setPan({ x:ts.panOx+dx, y:ts.panOy+dy });
        }
      }
    };

    const onTouchEnd = (e) => {
      ts.fingers = e.touches.length;
      if (e.touches.length < 2) ts.lastDist=0;
      // Tap detection
      if (!ts.moved && e.changedTouches.length===1) {
        const t = e.changedTouches[0];
        const nodeEl = t.target.closest('[data-nid]');
        if (nodeEl) {
          const nid = nodeEl.getAttribute('data-nid');
          if (ref.current.connecting) connectNodes(nid);
          else setSelected(prev => String(prev)===nid ? null : nid);
        } else {
          setSelected(null);
          if (ref.current.connecting) setConnecting(null);
        }
      }
      if (e.touches.length===0) { ts.nodeDrag=null; ts.isPanning=false; ts.moved=false; }
      if (e.touches.length===1) { const t=e.touches[0]; ts.t0x=t.clientX; ts.t0y=t.clientY; ts.panOx=ref.current.pan.x; ts.panOy=ref.current.pan.y; ts.nodeDrag=null; ts.isPanning=!ref.current.editing; }
    };

    el.addEventListener('touchstart', onTouchStart, {passive:false});
    el.addEventListener('touchmove',  onTouchMove,  {passive:false});
    el.addEventListener('touchend',   onTouchEnd,   {passive:true});
    el.addEventListener('touchcancel',onTouchEnd,   {passive:true});
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove',  onTouchMove);
      el.removeEventListener('touchend',   onTouchEnd);
      el.removeEventListener('touchcancel',onTouchEnd);
    };
  }, []);

  const onBgMouseDown = (e) => {
    if (e.button!==0||e.target!==e.currentTarget) return;
    if (ref.current.connecting) { setConnecting(null); return; }
    setSelected(null);
    mouseDrag.current = { kind:'pan', ox:ref.current.pan.x, oy:ref.current.pan.y, sx:e.clientX, sy:e.clientY };
  };

  const onBgDblClick = (e) => {
    if (e.target!==e.currentTarget||readOnly) return;
    const r=containerRef.current.getBoundingClientRect();
    const {x,y}=toWorld(e.clientX-r.left, e.clientY-r.top);
    const node=makeNode(x-80,y-55,nextColor(ref.current.nodes.length));
    setNodes(n=>[...n,node]); setSelected(node.id); setEditing(node.id);
  };

  const onNodeMouseDown = (e, node) => {
    if (e.button!==0) return;
    const {editing,connecting,readOnly}=ref.current;
    if (readOnly) return;
    if (editing===node.id) return;
    if (connecting) { connectNodes(String(node.id)); return; }
    e.stopPropagation();
    mouseDrag.current = { kind:'node', id:node.id, ox:node.x, oy:node.y, sx:e.clientX, sy:e.clientY };
  };

  const deleteNode = (id) => {
    setNodes(n=>n.filter(x=>x.id!==id));
    setEdges(e=>e.filter(x=>x.from!==id&&x.to!==id));
    setSelected(s=>s===id?null:s);
    setEditing(v=>v===id?null:v);
  };

  const addConnectedNode = (src) => {
    if (readOnly) return;
    const child=makeNode(src.x+src.w+50,src.y,src.color);
    setNodes(n=>[...n,child]);
    setEdges(e=>[...e,{id:Date.now()+Math.random(),from:src.id,to:child.id}]);
    setSelected(child.id); setEditing(child.id);
  };

  const connectNodes = (toId) => {
    const fromId = ref.current.connecting;
    if (!fromId) return;
    setConnecting(null);
    if (String(fromId)===String(toId)) return;
    setEdges(prev => {
      const dup=prev.find(e=>(String(e.from)===String(fromId)&&String(e.to)===String(toId))||(String(e.from)===String(toId)&&String(e.to)===String(fromId)));
      return dup ? prev : [...prev,{id:Date.now()+Math.random(),from:fromId,to:toId}];
    });
  };

  const changeColor = (id,c) => setNodes(n=>n.map(x=>x.id===id?{...x,color:c}:x));
  const updateText  = (id,t) => setNodes(n=>n.map(x=>x.id===id?{...x,text:t}:x));
  const getCenter   = n => ({cx:n.x+n.w/2,cy:n.y+n.h/2});

  return (
    <div ref={containerRef} style={{
        position:'relative',width:'100%',height:'100%',overflow:'hidden',
        background:'#eef3f8',
        backgroundImage:'radial-gradient(circle,#b8cedd 1px,transparent 1px)',
        backgroundSize:'28px 28px',
        touchAction:'none', userSelect:'none', cursor:'default',
      }}
      onMouseDown={onBgMouseDown}
      onDoubleClick={onBgDblClick}
    >
      {connecting && (
        <div style={{position:'absolute',top:10,left:'50%',transform:'translateX(-50%)',zIndex:40,
            background:'#7c3aed',color:'#fff',borderRadius:20,padding:'7px 18px',
            fontSize:13,fontWeight:600,pointerEvents:'none',boxShadow:'0 4px 20px #7c3aed55'}}>
          Toque no post-it destino para conectar 🔗
        </div>
      )}
      <div style={{position:'absolute',bottom:8,right:8,zIndex:20,display:'flex',gap:6,alignItems:'center'}}>
        <button onClick={()=>{setPan({x:40,y:40});setScale(1);}}
          style={{background:'rgba(255,255,255,0.9)',border:'1px solid #dde',borderRadius:8,
            color:'#64748b',fontSize:11,padding:'3px 9px',cursor:'pointer'}}>↺</button>
        <div style={{background:'rgba(255,255,255,0.85)',border:'1px solid #e2e8f0',borderRadius:8,
            padding:'3px 8px',fontSize:10,color:'#94a3b8',pointerEvents:'none'}}>
          {Math.round(scale*100)}% · {nodes.length} post-it{nodes.length!==1?'s':''}
        </div>
      </div>
      <svg style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none',zIndex:1,overflow:'visible'}}>
        <defs>
          <marker id="dbArr" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L7,3 z" fill="#94a3b8"/>
          </marker>
        </defs>
        <g transform={"translate("+pan.x+","+pan.y+") scale("+scale+")"}>
          {edges.map(e=>{
            const f=nodes.find(n=>n.id===e.from),t=nodes.find(n=>n.id===e.to);
            if(!f||!t) return null;
            const fc=getCenter(f),tc=getCenter(t),mx=(fc.cx+tc.cx)/2;
            return <path key={e.id} d={"M"+fc.cx+" "+fc.cy+" C"+mx+" "+fc.cy+","+mx+" "+tc.cy+","+tc.cx+" "+tc.cy}
              stroke="#94a3b8" strokeWidth={1.5/scale} fill="none"
              strokeDasharray={(5/scale)+","+(3/scale)} markerEnd="url(#dbArr)" opacity={0.75}/>;
          })}
        </g>
      </svg>
      {nodes.map(node=>{
        const isSel  = String(selected)===String(node.id);
        const isEdit = String(editing)===String(node.id);
        const isConn = String(connecting)===String(node.id);
        const tx=pan.x+node.x*scale, ty=pan.y+node.y*scale;
        const nw=node.w*scale, nh=node.h*scale;
        const fz=Math.max(11*scale,10);
        const br=Math.max(9*scale,8);
        return (
          <div key={node.id} data-nid={String(node.id)} style={{
              position:'absolute',left:tx,top:ty,width:nw,height:nh,
              background:node.color, borderRadius:br,
              boxShadow:isSel?'0 0 0 3px #3a8fd4,0 6px 24px #0003':isConn?'0 0 0 3px #7c3aed,0 6px 24px #0003':'0 2px 10px #0002',
              display:'flex',flexDirection:'column',zIndex:isSel?20:3,transition:'box-shadow .1s',
            }}
            onMouseDown={e=>onNodeMouseDown(e,node)}
            onClick={e=>{e.stopPropagation();if(ref.current.connecting)connectNodes(String(node.id));else setSelected(s=>String(s)===String(node.id)?null:node.id);}}
            onDoubleClick={e=>{e.stopPropagation();if(!readOnly)setEditing(node.id);}}
          >
            <div style={{height:Math.max(20*scale,20),flexShrink:0,background:'rgba(0,0,0,0.10)',
                borderRadius:br+"px "+br+"px 0 0",display:'flex',alignItems:'center',
                justifyContent:isSel&&!readOnly?'space-between':'flex-start',
                padding:"0 "+Math.max(6*scale,6)+"px",gap:4}}>
              <span style={{fontSize:Math.max(9*scale,9),opacity:.35}}>⠿</span>
              {isSel&&!readOnly&&(
                <div style={{display:'flex',gap:Math.max(3*scale,3),flexWrap:'wrap',justifyContent:'flex-end'}}>
                  {POST_COLORS.map(c=>(
                    <div key={c}
                      onMouseDown={e=>{e.stopPropagation();changeColor(node.id,c);}}
                      onTouchEnd={e=>{e.stopPropagation();e.preventDefault();changeColor(node.id,c);}}
                      style={{width:Math.max(10*scale,10),height:Math.max(10*scale,10),borderRadius:'50%',background:c,cursor:'pointer',flexShrink:0,
                        border:node.color===c?Math.max(1.5*scale,1.5)+"px solid rgba(0,0,0,0.55)":"1px solid rgba(0,0,0,0.15)"}}/>
                  ))}
                </div>
              )}
            </div>
            <div style={{flex:1,padding:Math.max(5*scale,5)+"px "+Math.max(8*scale,7)+"px",overflow:'hidden'}}>
              {isEdit&&!readOnly?(
                <textarea autoFocus value={node.text}
                  onChange={e=>updateText(node.id,e.target.value)}
                  onBlur={()=>setEditing(null)}
                  onKeyDown={e=>{if(e.key==='Escape')setEditing(null);e.stopPropagation();}}
                  onMouseDown={e=>e.stopPropagation()}
                  onTouchStart={e=>e.stopPropagation()}
                  style={{width:'100%',height:'100%',background:'transparent',border:'none',outline:'none',
                    resize:'none',fontSize:fz,fontFamily:'inherit',color:'rgba(0,0,0,0.78)',lineHeight:1.45,padding:0}}/>
              ):(
                <div style={{fontSize:fz,color:'rgba(0,0,0,0.75)',lineHeight:1.45,wordBreak:'break-word',whiteSpace:'pre-wrap',height:'100%',overflow:'hidden'}}>
                  {node.text||<span style={{opacity:.3,fontStyle:'italic'}}>toque 2× para editar</span>}
                </div>
              )}
            </div>
            {!readOnly&&!isEdit&&(
              <div style={{display:'flex',gap:Math.max(3*scale,3),
                  padding:Math.max(3*scale,4)+"px "+Math.max(5*scale,5)+"px "+Math.max(4*scale,5)+"px",
                  flexShrink:0,borderTop:"1px solid rgba(0,0,0,0.08)",background:'rgba(0,0,0,0.05)',
                  borderRadius:"0 0 "+br+"px "+br+"px"}}
                onMouseDown={e=>e.stopPropagation()}
                onTouchStart={e=>e.stopPropagation()}>
                <button
                  onTouchEnd={e=>{e.stopPropagation();e.preventDefault();addConnectedNode(node);}}
                  onClick={e=>{e.stopPropagation();addConnectedNode(node);}}
                  style={{flex:1,background:'rgba(58,143,212,0.85)',border:'none',borderRadius:Math.max(5*scale,5),
                    color:'#fff',fontSize:Math.max(9*scale,10),fontWeight:700,
                    padding:Math.max(2*scale,4)+"px "+Math.max(4*scale,4)+"px",cursor:'pointer',whiteSpace:'nowrap'}}>
                  + Fio
                </button>
                <button
                  onTouchEnd={e=>{e.stopPropagation();e.preventDefault();setConnecting(node.id);}}
                  onClick={e=>{e.stopPropagation();setConnecting(node.id);}}
                  style={{background:'rgba(124,58,237,0.8)',border:'none',borderRadius:Math.max(5*scale,5),
                    color:'#fff',fontSize:Math.max(9*scale,10),
                    padding:Math.max(2*scale,4)+"px "+Math.max(5*scale,6)+"px",cursor:'pointer'}}>
                  🔗
                </button>
                <button
                  onTouchEnd={e=>{e.stopPropagation();e.preventDefault();deleteNode(node.id);}}
                  onClick={e=>{e.stopPropagation();deleteNode(node.id);}}
                  style={{background:'rgba(220,38,38,0.7)',border:'none',borderRadius:Math.max(5*scale,5),
                    color:'#fff',fontSize:Math.max(9*scale,10),
                    padding:Math.max(2*scale,4)+"px "+Math.max(5*scale,6)+"px",cursor:'pointer'}}>
                  ✕
                </button>
              </div>
            )}
          </div>
        );
      })}
      {nodes.length===0&&!readOnly&&(
        <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',
            alignItems:'center',justifyContent:'center',pointerEvents:'none',gap:8}}>
          <div style={{fontSize:44,opacity:.1}}>📌</div>
          <div style={{fontSize:13,color:'#94a3b8',textAlign:'center',lineHeight:1.8}}>
            Toque em <b>+ Post-it</b> para começar<br/>
            <span style={{fontSize:11,opacity:.7}}>Desktop: duplo clique no fundo</span>
          </div>
        </div>
      )}
      {nodes.length===0&&readOnly&&(
        <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',pointerEvents:'none'}}>
          <span style={{fontSize:12,color:'#94a3b8'}}>Board vazio neste dia</span>
        </div>
      )}
    </div>
  );
}

function DayBoardPage() {
  const [allBoards, setAllBoards] = useState(loadBoards);
  const today  = todayKey();
  const [viewKey, setViewKey] = useState(today);
  const [showHistory, setShowHistory] = useState(false);
  const [kvSynced, setKvSynced] = useState(false);

  // On mount: pull boards from cloud, merge with local
  useEffect(() => {
    KV.get(DB_BOARD_KEY).then(cloud => {
      if (cloud && typeof cloud === 'object') {
        const local = loadBoards();
        // Merge: cloud wins for same day, local adds days cloud doesn't have
        const merged = { ...local, ...cloud };
        saveBoards(merged);
        setAllBoards(merged);
      }
      setKvSynced(true);
    });
  }, []);

  const refreshBoards = () => setAllBoards(loadBoards());

  // All days that have data, sorted desc
  const historyKeys = Object.keys(allBoards)
    .filter(k => (allBoards[k]?.nodes||[]).length > 0)
    .sort((a,b) => b.localeCompare(a));

  const isToday = viewKey === today;

  const addNodeFnRef = useRef(null);
  const handleAddNode = () => { if(addNodeFnRef.current) addNodeFnRef.current(); };

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'calc(100vh - 196px)', minHeight:400 }}>
      {/* Header bar */}
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8, flexWrap:'wrap' }}>
        {/* Today / History toggle */}
        <button onClick={()=>{setViewKey(today);setShowHistory(false);}} style={{...btn(isToday&&!showHistory?'var(--accent)':'var(--bg-card)'),border:`1px solid ${isToday&&!showHistory?'var(--accent)':'var(--border)'}`,color:isToday&&!showHistory?'#fff':'var(--text-2)',padding:'7px 16px',fontSize:13,borderRadius:20}}>
          📌 Hoje
        </button>
        <button onClick={()=>setShowHistory(h=>!h)} style={{...btn(showHistory?'var(--purple)':'var(--bg-card)'),border:`1px solid ${showHistory?'var(--purple)':'var(--border)'}`,color:showHistory?'#fff':'var(--text-2)',padding:'7px 16px',fontSize:13,borderRadius:20}}>
          🗂 {historyKeys.length>0?`(${historyKeys.length})`:''}
        </button>
        {/* External Add button — only on today's board */}
        {isToday && !showHistory && (
          <button onClick={handleAddNode}
            style={{background:'#3a8fd4',border:'none',borderRadius:20,color:'#fff',
              fontSize:13,fontWeight:700,padding:'7px 18px',cursor:'pointer',
              boxShadow:'0 2px 10px #3a8fd433',display:'flex',alignItems:'center',gap:6}}>
            📌 + Post-it
          </button>
        )}
        {/* Reset view */}
        {isToday && !showHistory && (
          <button onClick={()=>{ if(addNodeFnRef.current) { /* trigger reset via canvas */ } }}
            style={{background:'transparent',border:'1px solid var(--border)',borderRadius:20,
              color:'var(--text-3)',fontSize:12,padding:'6px 12px',cursor:'pointer'}}
            title="Centralizar vista"
            id="wb-reset-btn">
            ↺
          </button>
        )}
        {/* Date label */}
        <span style={{fontSize:12,color:'var(--text-3)',marginLeft:2}}>
          {isToday&&!showHistory?new Date().toLocaleDateString('pt-BR',{weekday:'short',day:'numeric',month:'short'}):showHistory?'Selecione um dia':fmtBoardDate(viewKey)}
        </span>

        {/* Nav arrows when viewing history */}
        {!showHistory && viewKey !== today && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {(() => {
              const idx = historyKeys.indexOf(viewKey);
              return (<>
                {idx > 0 && <button onClick={()=>setViewKey(historyKeys[idx-1])} style={{ ...btn('var(--bg-card)'), border:'1px solid var(--border)', color:'var(--text-2)', padding:'6px 14px', borderRadius:12, fontSize:12 }}>← Mais recente</button>}
                {idx < historyKeys.length-1 && <button onClick={()=>setViewKey(historyKeys[idx+1])} style={{ ...btn('var(--bg-card)'), border:'1px solid var(--border)', color:'var(--text-2)', padding:'6px 14px', borderRadius:12, fontSize:12 }}>Mais antigo →</button>}
                <button onClick={()=>{setViewKey(today);setShowHistory(false);}} style={{ ...btn('var(--accent)'), padding:'6px 14px', borderRadius:12, fontSize:12 }}>Ir para Hoje</button>
              </>);
            })()}
          </div>
        )}
      </div>

      {/* History grid */}
      {showHistory && (
        <div style={{ marginBottom: 14 }}>
          {historyKeys.length === 0 && <Empty text="Nenhum dia registrado ainda"/>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {historyKeys.map(k => {
              const board = allBoards[k] || {};
              const count = (board.nodes||[]).length;
              const isActive = k === viewKey && !showHistory;
              return (
                <button key={k} onClick={() => { setViewKey(k); setShowHistory(false); }}
                  style={{ background: 'var(--bg-card)', border: `1px solid ${isActive?'var(--accent)':'var(--border)'}`, borderRadius: 12, padding: '10px 16px', cursor: 'pointer', textAlign: 'left', minWidth: 160 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)', marginBottom: 3 }}>{fmtBoardDate(k)}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>📌 {count} post-it{count!==1?'s':''}</div>
                  {/* Mini preview: colored dots */}
                  <div style={{ display:'flex', gap:3, marginTop:6, flexWrap:'wrap' }}>
                    {(board.nodes||[]).slice(0,8).map(n=>(
                      <div key={n.id} style={{ width:10,height:10,borderRadius:3,background:n.color,flexShrink:0 }} title={n.text?.slice(0,30)}/>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Canvas */}
      {!showHistory && (
        <div style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', position: 'relative' }}
          onMouseUp={refreshBoards}>
          <DayBoardCanvas key={viewKey} dayKey={viewKey} readOnly={!isToday}
          onAddNode={fn=>{addNodeFnRef.current=fn;}}/>
          {!isToday && (
            <div style={{ position:'absolute', top:10, right:14, background:'var(--purple)', color:'#fff', fontSize:11, fontWeight:700, padding:'4px 12px', borderRadius:20, letterSpacing:1, pointerEvents:'none', zIndex:30 }}>
              📖 LEITURA — {fmtBoardDate(viewKey)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── IDEIAS — CARDS ──────────────────────────────────────────────────────────
function IdeasCards() {
  const [entries, setEntries, synced] = useKV("ideas_v1",[]);
  const [text, setText]   = useState("");
  const [tag, setTag]     = useState("");
  const [editing, setEditing] = useState(null);
  const [editText, setEditText] = useState("");
  const [editTag, setEditTag]   = useState("");

  const add = () => {
    if(!text.trim()) return;
    const e={id:Date.now(),text,tag,mood:"💡",date:nowISO()};
    const n=[e,...entries]; setEntries(n); setText(""); setTag("");
  };
  const del = id=>{ setEntries(p=>p.filter(e=>e.id!==id)); };
  const openEdit = e=>{ setEditing(e); setEditText(e.text); setEditTag(e.tag||""); };
  const saveEdit = ()=>{
    const n=entries.map(e=>e.id===editing.id?{...e,text:editText,tag:editTag}:e);
    setEntries(n); setEditing(null);
  };

  return (
    <div>
      <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:14,padding:18,marginBottom:20}}>
        <textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Anote uma ideia..." rows={3}
          style={{...inp,resize:"none",marginBottom:10}} onKeyDown={e=>{if(e.ctrlKey&&e.key==="Enter")add();}}/>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <input style={{...inp,flex:1}} placeholder="Tag (opcional)" value={tag} onChange={e=>setTag(e.target.value)}/>
          <button onClick={add} style={{...btn("var(--purple)"),padding:"10px 20px",whiteSpace:"nowrap"}}>+ Salvar</button>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:14}}>
        {entries.map(e=>(
          <div key={e.id} style={{background:"var(--bg-card)",border:"1px solid rgba(160,112,224,0.3)",borderRadius:14,padding:16,display:"flex",flexDirection:"column",gap:10}}>
            {e.tag&&<span style={{background:"rgba(160,112,224,0.15)",border:"1px solid rgba(160,112,224,0.3)",borderRadius:20,padding:"2px 10px",fontSize:10,color:"var(--purple)",fontWeight:700,letterSpacing:1,alignSelf:"flex-start"}}>{e.tag.toUpperCase()}</span>}
            <p style={{margin:0,color:"var(--text-1)",lineHeight:1.7,fontSize:14,whiteSpace:"pre-wrap",flex:1}}>{e.text}</p>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:10,color:"var(--text-3)"}}>{new Date(e.date).toLocaleDateString("pt-BR")} {new Date(e.date).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</span>
              <div style={{display:"flex",gap:6}}>
                <button onClick={()=>openEdit(e)} style={{background:"var(--accent-dim)",border:"1px solid var(--accent-bdr)",borderRadius:8,padding:"4px 10px",color:"var(--accent)",fontSize:11,cursor:"pointer"}}>✏️ Editar</button>
                <button onClick={()=>del(e.id)} style={{background:"none",border:"none",color:"var(--text-3)",cursor:"pointer"}}><Icon path={I.trash} size={14}/></button>
              </div>
            </div>
          </div>
        ))}
        {entries.length===0&&<div style={{gridColumn:"1/-1",textAlign:"center",color:"var(--text-3)",padding:"40px 0",fontSize:14}}>Nenhuma ideia ainda. Anote a primeira! 💡</div>}
      </div>
      {editing&&<Modal title="Editar Ideia" onClose={()=>setEditing(null)}>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <textarea style={{...inp,resize:"vertical"}} rows={6} value={editText} onChange={e=>setEditText(e.target.value)}/>
          <input style={inp} placeholder="Tag" value={editTag} onChange={e=>setEditTag(e.target.value)}/>
          <button onClick={saveEdit} style={btn()}>Salvar</button>
        </div>
      </Modal>}
    </div>
  );
}

// ─── LEMBRETES — CARDS ───────────────────────────────────────────────────────
function RemindersCards() {
  const [entries, setEntries, synced] = useKV("reminders_v1",[]);
  const [text, setText]   = useState("");
  const [editing, setEditing] = useState(null);
  const [editText, setEditText] = useState("");
  const [filter, setFilter]   = useState("all");

  const add = () => {
    if(!text.trim()) return;
    const e={id:Date.now(),text,mood:"🔔",done:false,date:nowISO()};
    const n=[e,...entries]; setEntries(n); setText("");
  };
  const tick = id=>{
    const cur=entries.find(e=>e.id===id);
    const n=entries.map(e=>e.id===id?{...e,done:!e.done}:e);
    setEntries(n);
  };
  const del = id=>{ setEntries(p=>p.filter(e=>e.id!==id)); };
  const openEdit = e=>{ setEditing(e); setEditText(e.text); };
  const saveEdit = ()=>{
    const n=entries.map(e=>e.id===editing.id?{...e,text:editText}:e);
    setEntries(n); setEditing(null);
  };
  const filtered = filter==="all"?entries: filter==="done"?entries.filter(e=>e.done): entries.filter(e=>!e.done);

  return (
    <div>
      <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:14,padding:18,marginBottom:16}}>
        <textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Adicione um lembrete..." rows={2}
          style={{...inp,resize:"none",marginBottom:10}} onKeyDown={e=>{if(e.ctrlKey&&e.key==="Enter")add();}}/>
        <div style={{display:"flex",justifyContent:"flex-end"}}>
          <button onClick={add} style={{...btn("var(--yellow)"),padding:"10px 20px",color:"#000"}}>+ Salvar</button>
        </div>
      </div>
      <div style={{display:"flex",gap:6,marginBottom:16}}>
        {[["all","Todos"],["todo","Pendentes"],["done","Feitos"]].map(([id,l])=>(
          <button key={id} onClick={()=>setFilter(id)} style={{background:filter===id?"var(--yellow)":"var(--bg-card)",border:"none",borderRadius:20,padding:"5px 14px",color:filter===id?"#000":"var(--text-2)",fontSize:12,fontWeight:600,cursor:"pointer"}}>{l}</button>
        ))}
        <span style={{marginLeft:"auto",fontSize:11,color:"var(--text-3)",alignSelf:"center"}}>{entries.filter(e=>!e.done).length} pendentes</span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:14}}>
        {filtered.map(e=>(
          <div key={e.id} style={{background:"var(--bg-card)",border:`1px solid ${e.done?"var(--border-2)":"rgba(240,192,64,0.3)"}`,borderRadius:14,padding:16,opacity:e.done?0.6:1,transition:"opacity .2s"}}>
            <div style={{display:"flex",gap:10,alignItems:"flex-start",marginBottom:10}}>
              <button onClick={()=>tick(e.id)} style={{width:24,height:24,borderRadius:6,border:`2px solid ${e.done?"var(--green)":"var(--yellow)"}`,background:e.done?"var(--green)":"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1}}>
                {e.done&&<Icon path={I.check} size={13} color="#fff"/>}
              </button>
              <p style={{margin:0,color:"var(--text-1)",lineHeight:1.7,fontSize:14,flex:1,textDecoration:e.done?"line-through":"none",whiteSpace:"pre-wrap"}}>{e.text}</p>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:10,color:"var(--text-3)"}}>{new Date(e.date).toLocaleDateString("pt-BR")} {new Date(e.date).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</span>
              <div style={{display:"flex",gap:6}}>
                <button onClick={()=>openEdit(e)} style={{background:"var(--accent-dim)",border:"1px solid var(--accent-bdr)",borderRadius:8,padding:"4px 10px",color:"var(--accent)",fontSize:11,cursor:"pointer"}}>✏️</button>
                <button onClick={()=>del(e.id)} style={{background:"none",border:"none",color:"var(--text-3)",cursor:"pointer"}}><Icon path={I.trash} size={14}/></button>
              </div>
            </div>
          </div>
        ))}
        {filtered.length===0&&<div style={{gridColumn:"1/-1",textAlign:"center",color:"var(--text-3)",padding:"40px 0",fontSize:14}}>Nenhum lembrete aqui.</div>}
      </div>
      {editing&&<Modal title="Editar Lembrete" onClose={()=>setEditing(null)}>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <textarea style={{...inp,resize:"vertical"}} rows={4} value={editText} onChange={e=>setEditText(e.target.value)}/>
          <button onClick={saveEdit} style={btn()}>Salvar</button>
        </div>
      </Modal>}
    </div>
  );
}

// ─── DIARY PAGE ───────────────────────────────────────────────────────────────
// ─── TEMAS PAGE ───────────────────────────────────────────────────────────────
function TemasPage() {
  const todayKey = () => new Date().toISOString().slice(0,10);
  const fmtDt    = (iso) => new Date(iso).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",year:"2-digit",hour:"2-digit",minute:"2-digit"});
  const fmtDay   = (key) => {
    const [y,m,d] = key.split("-");
    return new Date(Number(y),Number(m)-1,Number(d))
      .toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
  };

  // ── Mode: "fixed" (pinned boards) | "daily" (today's boards + history) ──
  const [mode, setMode] = useState("fixed");

  // ── Persistent state via useKV ──
  const [fixedBoards, setFixedBoards, fSynced] = useKV("temas_fixed_v1", []);
  const [dailyData,   setDailyData,   dSynced] = useKV("temas_daily_v1", {}); // { "YYYY-MM-DD": [board,...] }

  // ── UI state ──
  const [addOpen,      setAddOpen]      = useState(false);
  const [editCard,     setEditCard]     = useState(null); // { board, mode, day? }
  const [historyDay,   setHistoryDay]   = useState(null); // viewing a past day
  const [form,         setForm]         = useState({ title:"", text:"" });
  const [updateText,   setUpdateText]   = useState("");
  const [viewCard,     setViewCard]     = useState(null); // modal to view/edit

  const today = todayKey();
  const todayBoards = dailyData[today] || [];

  // ── Helpers ──
  const makeBoard = (title, text, mode) => ({
    id:    Date.now() + Math.random(),
    title: title.trim(),
    text:  text.trim(),
    mode,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updates:   [],
  });

  // ── Fixed boards CRUD ──
  const addFixed = () => {
    if (!form.title.trim()) return;
    const b = makeBoard(form.title, form.text, "fixed");
    setFixedBoards([b, ...fixedBoards]);
    setForm({ title:"", text:"" }); setAddOpen(false);
  };

  const updateFixed = (id, patch) => {
    const entry = { text: patch.text, date: new Date().toISOString() };
    const next = fixedBoards.map(b => b.id===id
      ? { ...b, ...patch, updatedAt: new Date().toISOString(), updates: [...(b.updates||[]), entry] }
      : b
    );
    setFixedBoards(next);
  };

  const deleteFixed = (id) => {
    setFixedBoards(fixedBoards.filter(b => b.id !== id));
    setViewCard(null);
  };

  // ── Daily boards CRUD ──
  const addDaily = () => {
    if (!form.title.trim()) return;
    const b = makeBoard(form.title, form.text, "daily");
    const next = { ...dailyData, [today]: [b, ...(dailyData[today]||[])] };
    setDailyData(next);
    setForm({ title:"", text:"" }); setAddOpen(false);
  };

  const updateDaily = (id, patch) => {
    const entry = { text: patch.text, date: new Date().toISOString() };
    const dayKey = historyDay || today;
    const next = {
      ...dailyData,
      [dayKey]: (dailyData[dayKey]||[]).map(b => b.id===id
        ? { ...b, ...patch, updatedAt: new Date().toISOString(), updates: [...(b.updates||[]), entry] }
        : b
      )
    };
    setDailyData(next);
  };

  const deleteDaily = (id) => {
    const dayKey = historyDay || today;
    const next = { ...dailyData, [dayKey]: (dailyData[dayKey]||[]).filter(b=>b.id!==id) };
    setDailyData(next);
    setViewCard(null);
  };

  const handleAdd  = () => mode==="fixed" ? addFixed()  : addDaily();
  const handleEdit = (board) => { mode==="fixed" ? updateFixed(board.id,  {text:updateText}) : updateDaily(board.id, {text:updateText}); setUpdateText(""); setViewCard(null); };
  const handleDel  = (id)    => mode==="fixed" ? deleteFixed(id)  : deleteDaily(id);

  // ── History keys (daily mode only) ──
  const histKeys = Object.keys(dailyData)
    .filter(k => k!==today && (dailyData[k]||[]).length>0)
    .sort((a,b)=>b.localeCompare(a));

  const displayBoards = mode==="fixed"
    ? fixedBoards
    : historyDay ? (dailyData[historyDay]||[]) : todayBoards;

  const isReadOnly = mode==="daily" && historyDay !== null;

  // ── Board card colors (cycle) ──
  const CARD_COLORS = [
    "#2563eb","#7c3aed","#059669","#d97706",
    "#dc2626","#0891b2","#be185d","#065f46",
  ];

  // ── RENDER ──
  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>

      {/* Mode selector + Add button */}
      <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
        <div style={{display:"flex",gap:6,background:"var(--bg-sub)",borderRadius:30,padding:4,border:"1px solid var(--border)"}}>
          {[
            {k:"fixed", icon:"📌", label:"Fixos"},
            {k:"daily", icon:"🗓", label:"Por dia"},
          ].map(o=>(
            <button key={o.k} onClick={()=>{setMode(o.k);setHistoryDay(null);}}
              style={{background:mode===o.k?"var(--accent)":"transparent",
                border:"none",borderRadius:26,padding:"7px 18px",
                color:mode===o.k?"#fff":"var(--text-2)",
                fontSize:13,fontWeight:700,cursor:"pointer",transition:"all .15s",
                display:"flex",alignItems:"center",gap:6}}>
              {o.icon} {o.label}
            </button>
          ))}
        </div>

        {!isReadOnly && (
          <button onClick={()=>{setAddOpen(true);setForm({title:"",text:""}); }}
            style={{...btn(),display:"flex",alignItems:"center",gap:8,padding:"10px 20px",borderRadius:30}}>
            <Icon path={I.plus} size={14}/> Novo quadro
          </button>
        )}

        {/* Daily: today/history toggle */}
        {mode==="daily" && (
          <div style={{display:"flex",gap:6,marginLeft:"auto",flexWrap:"wrap"}}>
            <button onClick={()=>setHistoryDay(null)}
              style={{...btn(historyDay===null?"var(--accent)":"var(--bg-card)"),
                border:`1px solid ${historyDay===null?"var(--accent)":"var(--border)"}`,
                color:historyDay===null?"#fff":"var(--text-2)",
                padding:"7px 16px",borderRadius:20,fontSize:12}}>
              📌 Hoje
            </button>
            {histKeys.length>0 && (
              <select value={historyDay||""} onChange={e=>setHistoryDay(e.target.value||null)}
                style={{...inp,padding:"7px 12px",borderRadius:20,fontSize:12,width:"auto",cursor:"pointer"}}>
                <option value="">🗂 Histórico ({histKeys.length} dias)</option>
                {histKeys.map(k=>(
                  <option key={k} value={k}>{fmtDay(k)}</option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      {/* Day label */}
      {mode==="daily" && (
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{fontSize:13,color:"var(--text-3)",fontWeight:600}}>
            {historyDay
              ? <>📖 {fmtDay(historyDay)} <span style={{background:"var(--purple)",color:"#fff",borderRadius:10,padding:"2px 10px",fontSize:10,marginLeft:6}}>Leitura</span></>
              : <>📅 {new Date().toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"})}</>
            }
          </div>
          {historyDay && (
            <button onClick={()=>setHistoryDay(null)}
              style={{...btn("transparent"),border:"1px solid var(--border)",color:"var(--accent)",padding:"4px 12px",borderRadius:12,fontSize:11}}>
              ← Voltar para hoje
            </button>
          )}
        </div>
      )}

      {/* Boards grid */}
      {displayBoards.length===0 ? (
        <div style={{textAlign:"center",padding:"60px 0",color:"var(--text-3)"}}>
          <div style={{fontSize:48,opacity:.15,marginBottom:12}}>📋</div>
          <div style={{fontSize:14}}>
            {isReadOnly ? "Nenhum quadro criado neste dia." : "Nenhum quadro ainda. Clique em + Novo quadro."}
          </div>
        </div>
      ) : (
        <div style={{
          display:"grid",
          gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",
          gap:14,
        }}>
          {displayBoards.map((board, idx) => (
            <div key={board.id}
              onClick={()=>{ setViewCard({board, mode, dayKey: historyDay||today}); setUpdateText(""); }}
              style={{
                background:"var(--bg-card)",
                border:"1px solid var(--border)",
                borderTop:`4px solid ${CARD_COLORS[idx%CARD_COLORS.length]}`,
                borderRadius:14, padding:20, cursor:"pointer",
                transition:"transform .15s, box-shadow .15s",
                display:"flex", flexDirection:"column", gap:10,
                boxShadow:"0 2px 8px #0001",
              }}
              onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 8px 24px #0002";}}
              onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="0 2px 8px #0001";}}>

              {/* Header */}
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:8}}>
                <h3 style={{margin:0,fontSize:15,fontWeight:800,color:"var(--text-1)",lineHeight:1.3}}>
                  {board.title}
                </h3>
                <div style={{width:10,height:10,borderRadius:"50%",background:CARD_COLORS[idx%CARD_COLORS.length],flexShrink:0,marginTop:4}}/>
              </div>

              {/* Text preview */}
              <p style={{margin:0,fontSize:13,color:"var(--text-2)",lineHeight:1.6,
                display:"-webkit-box",WebkitLineClamp:3,WebkitBoxOrient:"vertical",overflow:"hidden"}}>
                {board.text || <span style={{opacity:.4,fontStyle:"italic"}}>Sem conteúdo</span>}
              </p>

              {/* Footer */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:"auto",paddingTop:10,borderTop:"1px solid var(--border)"}}>
                <span style={{fontSize:10,color:"var(--text-3)"}}>
                  {board.updates?.length>0
                    ? `Atualizado ${fmtDt(board.updatedAt)}`
                    : `Criado ${fmtDt(board.createdAt)}`}
                </span>
                {board.updates?.length>0 && (
                  <span style={{fontSize:10,color:"var(--accent)",background:"var(--accent-dim)",borderRadius:8,padding:"2px 8px"}}>
                    {board.updates.length} atualiz.
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── ADD MODAL ── */}
      {addOpen && (
        <Modal title={`Novo quadro — ${mode==="fixed"?"Fixo":"Dia de hoje"}`} onClose={()=>setAddOpen(false)}>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div>
              <label style={{fontSize:11,color:"var(--text-3)",letterSpacing:2,fontWeight:700,display:"block",marginBottom:6}}>TÍTULO</label>
              <input autoFocus style={inp} placeholder="Ex: Projeto X, Reflexão, Ideia..." value={form.title}
                onChange={e=>setForm({...form,title:e.target.value})}
                onKeyDown={e=>{if(e.key==="Enter")document.getElementById("temas-text-area")?.focus();}}/>
            </div>
            <div>
              <label style={{fontSize:11,color:"var(--text-3)",letterSpacing:2,fontWeight:700,display:"block",marginBottom:6}}>CONTEÚDO</label>
              <textarea id="temas-text-area" style={{...inp,resize:"vertical",minHeight:120}} placeholder="Descreva, anote, reflita..."
                value={form.text} onChange={e=>setForm({...form,text:e.target.value})}/>
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <button onClick={()=>setAddOpen(false)} style={{...btn("var(--bg-input)"),color:"var(--text-2)"}}>Cancelar</button>
              <button onClick={handleAdd} style={{...btn(),padding:"10px 24px",fontWeight:700}}
                disabled={!form.title.trim()}>
                Criar quadro
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── VIEW / EDIT MODAL ── */}
      {viewCard && (
        <Modal title={viewCard.board.title} onClose={()=>{setViewCard(null);setUpdateText("");}}>
          <div style={{display:"flex",flexDirection:"column",gap:16}}>

            {/* Meta */}
            <div style={{display:"flex",gap:12,fontSize:10,color:"var(--text-3)",flexWrap:"wrap"}}>
              <span>📅 Criado: {fmtDt(viewCard.board.createdAt)}</span>
              {viewCard.board.updates?.length>0 && <span>✏️ Atualizado: {fmtDt(viewCard.board.updatedAt)}</span>}
              <span style={{background:"var(--bg-sub)",borderRadius:8,padding:"2px 8px",color:"var(--text-2)"}}>
                {viewCard.mode==="fixed"?"📌 Fixo":"🗓 Dia"}
              </span>
            </div>

            {/* Main text */}
            <div style={{background:"var(--bg-sub)",borderRadius:12,padding:16,fontSize:14,color:"var(--text-1)",lineHeight:1.8,whiteSpace:"pre-wrap",minHeight:80}}>
              {viewCard.board.text || <span style={{opacity:.4,fontStyle:"italic"}}>Sem conteúdo</span>}
            </div>

            {/* Update history */}
            {viewCard.board.updates?.length>0 && (
              <div>
                <div style={{fontSize:10,color:"var(--accent)",letterSpacing:2,fontWeight:700,marginBottom:10}}>
                  HISTÓRICO DE ATUALIZAÇÕES
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:200,overflowY:"auto"}}>
                  {[...viewCard.board.updates].reverse().map((u,i)=>(
                    <div key={i} style={{background:"var(--bg-input)",borderRadius:10,padding:"10px 14px"}}>
                      <div style={{fontSize:13,color:"var(--text-2)",lineHeight:1.6,whiteSpace:"pre-wrap"}}>{u.text}</div>
                      <div style={{fontSize:10,color:"var(--text-3)",marginTop:4}}>🕐 {fmtDt(u.date)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Add update (only if not read-only history) */}
            {!isReadOnly && (
              <div style={{borderTop:"1px solid var(--border)",paddingTop:16}}>
                <div style={{fontSize:11,color:"var(--text-3)",letterSpacing:2,fontWeight:700,marginBottom:10}}>
                  ADICIONAR ATUALIZAÇÃO
                </div>
                <textarea
                  style={{...inp,resize:"vertical",minHeight:80,marginBottom:10}}
                  placeholder="O que mudou? Adicione uma nota com data e hora automáticas..."
                  value={updateText}
                  onChange={e=>setUpdateText(e.target.value)}
                />
                <button onClick={()=>handleEdit(viewCard.board)}
                  disabled={!updateText.trim()}
                  style={{...btn("var(--green)"),width:"100%",padding:"10px",fontWeight:700}}>
                  Salvar atualização
                </button>
              </div>
            )}

            {/* Delete */}
            {!isReadOnly && (
              <button onClick={()=>handleDel(viewCard.board.id)}
                style={{background:"rgba(220,38,38,0.08)",border:"1px solid rgba(220,38,38,0.25)",
                  borderRadius:10,padding:"8px 16px",color:"var(--red)",fontSize:13,cursor:"pointer"}}>
                🗑 Excluir quadro
              </button>
            )}
          </div>
        </Modal>
      )}

    </div>
  );
}

function DiaryPage() {
  const [active, setActive] = useState("diary");
  const tabs = [
    {id:"dia",       label:"📌 Dia",       color:"#e67e22"},
    {id:"diary",     label:"📓 Diário",    color:"var(--accent)"},
    {id:"temas",     label:"📋 Temas",     color:"#0891b2"},
    {id:"ideas",     label:"💡 Ideias",    color:"var(--purple)"},
    {id:"reminders", label:"🔔 Lembretes", color:"var(--yellow)"},
  ];
  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap"}}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setActive(t.id)}
            style={{background:active===t.id?t.color:"var(--bg-card)",border:`1px solid ${active===t.id?t.color:"var(--border)"}`,borderRadius:24,padding:"10px 24px",color:active===t.id?t.id==="reminders"?"#000":"#fff":"var(--text-2)",fontSize:14,fontWeight:700,cursor:"pointer",transition:"all .2s"}}>
            {t.label}
          </button>
        ))}
      </div>
      <div style={{flex:1,animation:"fadeIn .2s ease",overflow:"hidden"}}>
        {active==="dia"       && <DayBoardPage/>}
        {active==="diary"     && <NoteColumn storageKey="diary" title="Diário" placeholder="O que está em sua mente hoje?" accent="var(--accent)" emoji="📓"/>}
        {active==="temas"     && <TemasPage/>}
        {active==="ideas"     && <IdeasCards/>}
        {active==="reminders" && <RemindersCards/>}
      </div>
    </div>
  );
}

// ─── TASKS PAGE ───────────────────────────────────────────────────────────────
function TasksPage() {
  const [tasks, setTasks, synced] = useKV("tasks_v1",[]);
  const [text, setText]   = useState("");
  const [prio, setPrio]   = useState("normal");
  const [editModal, setEditModal] = useState(null);
  const [addNote, setAddNote] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  const prioColor = {alta:"var(--red)",normal:"var(--accent)",baixa:"var(--text-3)"};
  const prioLabel = {alta:"🔴 Alta",normal:"🔵 Normal",baixa:"⚪ Baixa"};

  const COLS = [
    { id:"todo",    label:"📋 A Fazer",     color:"var(--text-3)" },
    { id:"doing",   label:"⚡ Em Andamento", color:"var(--yellow)" },
    { id:"standby", label:"⏸ Stand By",     color:"var(--purple)" },
    { id:"done",    label:"✅ Concluído",    color:"var(--green)"  },
  ];

  const getStatus = (t) => t.status || (t.done ? "done" : "todo");
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  const save = n => { setTasks(n); };

  const add = () => {
    if (!text.trim()) return;
    const t = { id:Date.now(), text, prio, status:"todo", done:false, date:nowISO(), notes:[], updates:[] };
    const n = [t, ...tasks];
    save(n);
    setText(""); setAddOpen(false);
  };

  const setStatus = (id, status) => {
    const n = tasksRef.current.map(t => t.id===id ? { ...t, status, done: status==="done" } : t);
    save(n);
  };

  const del = (id) => { setTasks(p=>p.filter(t=>t.id!==id)); };

  const addTaskNote = (id) => {
    if (!addNote.trim()) return;
    const note = { text:addNote, date:now() };
    const n = tasksRef.current.map(t => t.id===id ? { ...t, updates:[...(t.updates||[]), note] } : t);
    save(n);
    const updated = n.find(t=>t.id===id);
    DB.update("tasks", { id, updates:updated.updates });
    setEditModal(updated);
    setAddNote("");
  };

  // ════════════════════════════════════════════════════════════════
  // DRAG AND DROP — simplified, reliable: separate "tap" vs "drag"
  // using a ref that is read synchronously (no stale-closure / event-
  // ordering issues). Click handler is NOT used at all — open/drag
  // decision happens entirely inside pointerup.
  // ════════════════════════════════════════════════════════════════
  const [dragId, setDragId]   = useState(null);
  const [overCol, setOverCol] = useState(null);
  const drag = useRef(null); // { id, startX, startY, moved, task }
  const colRefs = useRef({});

  const findColAt = (x, y) => {
    for (const col of COLS) {
      const el = colRefs.current[col.id];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return col.id;
    }
    return null;
  };

  const onCardPointerDown = (e, task) => {
    if (e.button !== undefined && e.button !== 0) return;
    const point = e.touches ? e.touches[0] : e;
    drag.current = { id: task.id, task, startX: point.clientX, startY: point.clientY, moved: false };
  };

  useEffect(() => {
    const onMove = (e) => {
      const d = drag.current; if (!d) return;
      const point = e.touches ? e.touches[0] : e;
      const dx = point.clientX - d.startX, dy = point.clientY - d.startY;
      if (!d.moved && Math.hypot(dx, dy) > 8) {
        d.moved = true;
        setDragId(d.id); // only now show drag visuals — avoids flicker on simple taps
      }
      if (!d.moved) return;
      if (e.cancelable) e.preventDefault();
      const col = findColAt(point.clientX, point.clientY);
      setOverCol(col);
    };

    const onUp = (e) => {
      const d = drag.current;
      if (!d) return;
      if (d.moved) {
        // It was a drag — drop into the column under the pointer
        if (overCol && getStatus(d.task) !== overCol) {
          setStatus(d.id, overCol);
        }
      } else {
        // It was a tap/click — open the modal
        const fresh = tasksRef.current.find(t => t.id === d.id) || d.task;
        setEditModal(fresh);
      }
      drag.current = null;
      setDragId(null);
      setOverCol(null);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    window.addEventListener('touchcancel', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
      window.removeEventListener('touchcancel', onUp);
    };
  }, [overCol]);

  const grouped = { todo:[], doing:[], standby:[], done:[] };
  tasks.forEach(t => { const s = getStatus(t); (grouped[s] || grouped.todo).push(t); });

  const TaskCard = ({ t }) => {
    const isDragging = dragId === t.id;
    return (
      <div
        onMouseDown={e => onCardPointerDown(e, t)}
        onTouchStart={e => onCardPointerDown(e, t)}
        style={{
          background:"var(--bg-card)",
          border:`1px solid ${prioColor[t.prio]}33`,
          borderLeft:`3px solid ${prioColor[t.prio]}`,
          borderRadius:10, padding:"12px 14px", marginBottom:10,
          cursor: isDragging ? "grabbing" : "pointer",
          opacity: isDragging ? 0.4 : 1,
          touchAction:"none", userSelect:"none",
          transition: isDragging ? "none" : "opacity .15s",
          boxShadow: isDragging ? "0 8px 24px #0003" : "0 1px 4px #0001",
        }}
      >
        <p style={{margin:0,fontSize:13,color:"var(--text-1)",lineHeight:1.5,marginBottom:8,pointerEvents:"none"}}>{t.text}</p>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:10,color:"var(--text-3)",pointerEvents:"none"}}>
          <span style={{color:prioColor[t.prio],fontWeight:700}}>{prioLabel[t.prio]}</span>
          <span>{new Date(t.date).toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})}</span>
        </div>
        {t.updates?.length>0 && <div style={{fontSize:10,color:"var(--accent)",marginTop:6,pointerEvents:"none"}}>💬 {t.updates.length}</div>}
      </div>
    );
  };

  return (
    <div>
      {/* Add task bar */}
      <div style={{ background:"var(--bg-card)", border:"1px solid var(--border)", borderRadius:14, padding:16, marginBottom:18 }}>
        {!addOpen ? (
          <button onClick={()=>setAddOpen(true)} style={{...btn(),display:"flex",alignItems:"center",gap:8,width:"100%",justifyContent:"center"}}>
            <Icon path={I.plus} size={14}/> Nova Tarefa
          </button>
        ) : (
          <div>
            <textarea autoFocus value={text} onChange={e=>setText(e.target.value)} placeholder="Descreva a tarefa..." rows={2}
              style={{...inp,resize:"none",marginBottom:12}} onKeyDown={e=>{if(e.ctrlKey&&e.key==="Enter")add();}}/>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
              <div style={{display:"flex",gap:8}}>
                {["alta","normal","baixa"].map(p=>(
                  <button key={p} onClick={()=>setPrio(p)} style={{background:prio===p?prioColor[p]+"22":"var(--bg-input)",border:`1px solid ${prio===p?prioColor[p]:"var(--border)"}`,borderRadius:20,padding:"5px 12px",color:prio===p?prioColor[p]:"var(--text-3)",fontSize:11,fontWeight:700,cursor:"pointer"}}>{prioLabel[p]}</button>
                ))}
              </div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>setAddOpen(false)} style={{...btn("var(--bg-input)"),color:"var(--text-2)",padding:"8px 16px"}}>Cancelar</button>
                <button onClick={add} style={{...btn(),padding:"8px 20px"}}>+ Adicionar</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Kanban board */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:14 }} className="kanban-grid">
        {COLS.map(col => (
          <div key={col.id} ref={el => colRefs.current[col.id]=el}
            style={{
              background: overCol===col.id ? "var(--accent-dim)" : "var(--bg-sub)",
              border: `2px ${overCol===col.id ? "dashed var(--accent)" : "solid var(--border)"}`,
              borderRadius:14, padding:14, minHeight:300,
              transition:"background .15s, border-color .15s",
              display:"flex", flexDirection:"column",
            }}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,paddingBottom:10,borderBottom:"1px solid var(--border)"}}>
              <span style={{fontSize:13,fontWeight:800,color:col.color}}>{col.label}</span>
              <span style={{fontSize:11,color:"var(--text-3)",background:"var(--bg-input)",borderRadius:10,padding:"2px 8px"}}>{grouped[col.id].length}</span>
            </div>
            <div style={{flex:1}}>
              {grouped[col.id].map(t => <TaskCard key={t.id} t={t}/>)}
              {grouped[col.id].length===0 && (
                <div style={{textAlign:"center",color:"var(--text-3)",fontSize:12,padding:"30px 0",opacity:.6}}>
                  {overCol===col.id ? "Solte aqui" : "Vazio"}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      <style>{`
        @media (max-width: 760px) {
          .kanban-grid { grid-template-columns: 1fr !important; }
          @media (min-width:761px) and (max-width:1100px) {
            .kanban-grid { grid-template-columns: repeat(2,1fr) !important; }
          }
        }
      `}</style>

      {editModal && (
        <Modal title={editModal.text.slice(0,40)+(editModal.text.length>40?"...":"")} onClose={()=>{setEditModal(null);setAddNote("");}}>
          <div style={{marginBottom:16}}>
            <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:12,flexWrap:"wrap"}}>
              {COLS.map(col=>(
                <button key={col.id} onClick={()=>{setStatus(editModal.id,col.id);setEditModal({...editModal,status:col.id,done:col.id==="done"});}}
                  style={{
                    background: getStatus(editModal)===col.id ? col.color+"22" : "var(--bg-input)",
                    border:`1px solid ${getStatus(editModal)===col.id?col.color:"var(--border)"}`,
                    borderRadius:20, padding:"6px 14px", fontSize:12, fontWeight:700,
                    color: getStatus(editModal)===col.id ? col.color : "var(--text-3)",
                    cursor:"pointer",
                  }}>
                  {col.label}
                </button>
              ))}
            </div>
            <span style={{fontSize:11,color:prioColor[editModal.prio],fontWeight:700}}>{prioLabel[editModal.prio]}</span>
            <p style={{color:"var(--text-2)",lineHeight:1.7,fontSize:14,margin:"12px 0 16px"}}>{editModal.text}</p>
            <div style={{fontSize:10,color:"var(--text-3)",marginBottom:16}}>Criada em {new Date(editModal.date).toLocaleString("pt-BR")}</div>

            <div style={{borderTop:"1px solid var(--border)",paddingTop:16}}>
              <div style={{fontSize:10,color:"var(--accent)",letterSpacing:2,fontWeight:700,marginBottom:12}}>ATUALIZAÇÕES</div>
              {(editModal.updates||[]).map((u,i)=>(
                <div key={i} style={{background:"var(--bg-input)",borderRadius:10,padding:"10px 14px",marginBottom:10}}>
                  <div style={{color:"var(--text-2)",fontSize:13,lineHeight:1.6}}>{u.text}</div>
                  <div style={{fontSize:10,color:"var(--text-3)",marginTop:4}}>🕐 {u.date}</div>
                </div>
              ))}
              <div style={{display:"flex",gap:10,marginTop:12}}>
                <textarea style={{...inp,flex:1,resize:"none"}} rows={2} placeholder="Adicionar atualização..." value={addNote} onChange={e=>setAddNote(e.target.value)}/>
                <button onClick={()=>addTaskNote(editModal.id)} style={{...btn("var(--green)"),alignSelf:"flex-end",padding:"10px 16px"}}>+</button>
              </div>
            </div>
            <button onClick={()=>{del(editModal.id);setEditModal(null);}} style={{marginTop:16,background:"rgba(240,112,112,0.1)",border:"1px solid rgba(240,112,112,0.3)",borderRadius:10,padding:"8px 16px",color:"var(--red)",fontSize:13,cursor:"pointer"}}>Excluir tarefa</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── LISTS PAGE ───────────────────────────────────────────────────────────────
function ListsPage() {
  const [lists, setLists, listsSynced] = useKV("lists_v1", []);
  const [modal, setModal] = useState(false);
  const [detail, setDetail] = useState(null);
  const [form, setForm]   = useState({title:"",text:""});
  const [addText, setAddText] = useState("");

  const save = n=>{ setLists(n); };
  const add  = ()=>{
    if(!form.title.trim()) return;
    const l={id:Date.now(),...form,items:[],created:now()};
    save([l,...lists]); setModal(false); setForm({title:"",text:""});
  };
  const addItem = id=>{
    if(!addText.trim()) return;
    const item={id:Date.now(),text:addText,done:false,date:now()};
    const n=lists.map(l=>l.id===id?{...l,items:[...(l.items||[]),item]}:l);
    save(n); setDetail(n.find(l=>l.id===id)); setAddText("");
  };
  const tickItem = (lid,iid)=>{
    const n=lists.map(l=>l.id===lid?{...l,items:l.items.map(i=>i.id===iid?{...i,done:!i.done}:i)}:l);
    save(n); setDetail(n.find(l=>l.id===lid));
  };
  const delList = id=>{ save(lists.filter(l=>l.id!==id)); setDetail(null); };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:20}}>
        <button onClick={()=>setModal(true)} style={{...btn(),display:"flex",alignItems:"center",gap:6}}><Icon path={I.plus} size={14}/> Nova Lista</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:14}}>
        {lists.map(l=>(
          <div key={l.id} onClick={()=>setDetail(l)} style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:14,padding:16,cursor:"pointer"}}>
            <div style={{fontWeight:700,fontSize:15,marginBottom:6}}>📋 {l.title}</div>
            {l.text&&<p style={{fontSize:12,color:"var(--text-3)",marginBottom:8,lineHeight:1.5}}>{l.text.slice(0,80)}{l.text.length>80?"...":""}</p>}
            <div style={{fontSize:11,color:"var(--text-3)"}}>{l.items?.length||0} itens · {l.created}</div>
          </div>
        ))}
      </div>
      {lists.length===0&&<Empty text="Nenhuma lista ainda. Crie a primeira!"/>}

      {modal&&(
        <Modal title="Nova Lista" onClose={()=>setModal(false)}>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <input style={inp} placeholder="Título da lista" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/>
            <textarea style={{...inp,resize:"vertical"}} rows={4} placeholder="Descrição / conteúdo inicial..." value={form.text} onChange={e=>setForm({...form,text:e.target.value})}/>
            <button onClick={add} style={btn()}>Criar Lista</button>
          </div>
        </Modal>
      )}

      {detail&&(
        <Modal title={detail.title} onClose={()=>setDetail(null)} wide>
          {detail.text&&<p style={{color:"var(--text-2)",lineHeight:1.7,fontSize:14,marginBottom:16}}>{detail.text}</p>}
          <div style={{marginBottom:16}}>
            {(detail.items||[]).map(item=>(
              <div key={item.id} style={{display:"flex",gap:10,alignItems:"center",padding:"8px 0",borderBottom:"1px solid var(--border-2)"}}>
                <button onClick={()=>tickItem(detail.id,item.id)} style={{width:20,height:20,borderRadius:5,border:`2px solid ${item.done?"var(--green)":"var(--border)"}`,background:item.done?"var(--green)":"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  {item.done&&<Icon path={I.check} size={11} color="#fff"/>}
                </button>
                <span style={{flex:1,fontSize:14,color:"var(--text-1)",textDecoration:item.done?"line-through":"none",opacity:item.done?0.6:1}}>{item.text}</span>
                <span style={{fontSize:10,color:"var(--text-3)"}}>{item.date}</span>
              </div>
            ))}
          </div>
          <div style={{display:"flex",gap:10}}>
            <input style={{...inp,flex:1}} placeholder="Adicionar item..." value={addText} onChange={e=>setAddText(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")addItem(detail.id);}}/>
            <button onClick={()=>addItem(detail.id)} style={{...btn("var(--green)"),padding:"10px 16px"}}>+</button>
          </div>
          <button onClick={()=>delList(detail.id)} style={{marginTop:16,background:"rgba(240,112,112,0.08)",border:"1px solid rgba(240,112,112,0.25)",borderRadius:10,padding:"8px 16px",color:"var(--red)",fontSize:13,cursor:"pointer"}}>Excluir lista</button>
        </Modal>
      )}
    </div>
  );
}

// ─── WEATHER PAGE ─────────────────────────────────────────────────────────────
function WeatherPage() {
  const w = useWeather();
  if(!w) return <div style={{textAlign:"center",padding:"60px 0",color:"var(--text-3)",fontSize:14}}>📍 Obtendo localização...</div>;
  if(w.error) return <div style={{textAlign:"center",padding:"60px 0",color:"var(--text-3)",fontSize:14}}>⚠️ {w.error}</div>;
  return (
    <div style={{maxWidth:600,margin:"0 auto"}}>
      <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:20,padding:32,textAlign:"center",marginBottom:20}}>
        <div style={{fontSize:64,marginBottom:8}}>{w.desc?.split(" ")[0]||"🌡"}</div>
        <div style={{fontSize:72,fontWeight:800,color:"var(--accent)",fontFamily:"'DM Mono',monospace"}}>{w.temp}{w.unit}</div>
        <div style={{fontSize:18,color:"var(--text-2)",marginTop:8}}>{w.desc?.split(" ").slice(1).join(" ")}</div>
        <div style={{fontSize:14,color:"var(--text-3)",marginTop:6}}>📍 {w.city||"Carregando..."}</div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:14,padding:20,textAlign:"center"}}>
          <div style={{fontSize:11,color:"var(--text-3)",letterSpacing:1.5,fontWeight:700,marginBottom:8}}>UMIDADE</div>
          <div style={{fontSize:32,fontWeight:800,color:"var(--text-1)"}}>{w.humidity}%</div>
        </div>
        <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:14,padding:20,textAlign:"center"}}>
          <div style={{fontSize:11,color:"var(--text-3)",letterSpacing:1.5,fontWeight:700,marginBottom:8}}>VENTO</div>
          <div style={{fontSize:32,fontWeight:800,color:"var(--text-1)"}}>{w.wind} <span style={{fontSize:14}}>km/h</span></div>
        </div>
      </div>
    </div>
  );
}

// ─── DOCS PAGE ────────────────────────────────────────────────────────────────
function DocsPage() {
  const [docs, setDocs, synced] = useKV("docs_v1",[]);
  const [modal, setModal] = useState(false);
  const [form, setForm]   = useState({name:"",cat:"Pessoal",tags:"",notes:""});
  const [filter, setFilter] = useState("Todos");
  const [fileData, setFileData] = useState(null); // {name,size,type,data:base64}
  const [fileName, setFileName] = useState("");
  const fileRef = useRef(null);
  const [editingId, setEditingId] = useState(null);
  const [downloading, setDownloading] = useState(null); // id being downloaded
  const cats = ["Pessoal","Financeiro","Saúde","Legal","Trabalho","Outros"];
  const icons = {pdf:"📕",doc:"📘",docx:"📘",xls:"📗",xlsx:"📗",png:"🖼️",jpg:"🖼️",jpeg:"🖼️",default:"📄"};
  const getIcon = n=>{ const e=n.split(".").pop().toLowerCase(); return icons[e]||icons.default; };

  const handleFile = e=>{
    const file=e.target.files[0]; if(!file) return;
    setFileName(file.name);
    if(!form.name) setForm(f=>({...f,name:file.name.replace(/\.[^.]+$/,"")}));
    const reader=new FileReader();
    reader.onload=ev=>setFileData({name:file.name,size:file.size,type:file.type,data:ev.target.result});
    reader.readAsDataURL(file);
  };

  const add = async ()=>{
    if(!form.name.trim()) return;
    const tags = form.tags.split(",").map(t=>t.trim()).filter(Boolean);
    if(editingId) {
      // Se trocou o arquivo, salva novo na nuvem
      if(fileData && fileData.data) {
        await KV.set("doc_file_"+editingId, fileData.data);
      }
      const n=docs.map(d=>d.id===editingId?{...d,...form,tags,
        hasFile:!!(fileData||d.hasFile),
        fileName:fileData?.name||d.fileName,
        fileSize:fileData?.size||d.fileSize,
        fileType:fileData?.type||d.fileType,
      }:d);
      setDocs(n);
    } else {
      const id=Date.now();
      // Salva arquivo em chave separada para não sobrecarregar a lista
      if(fileData?.data) {
        await KV.set("doc_file_"+id, fileData.data);
      }
      const doc={id,date:now(),...form,tags,
        hasFile:!!fileData?.data,
        fileName:fileData?.name||"",
        fileSize:fileData?.size||0,
        fileType:fileData?.type||"",
      };
      setDocs([doc,...docs]);
    }
    setModal(false); setEditingId(null);
    setForm({name:"",cat:"Pessoal",tags:"",notes:""});
    setFileData(null); setFileName("");
  };

  const del = id=>{
    setDocs(p=>p.filter(d=>d.id!==id));
    KV.del("doc_file_"+id); // apaga arquivo da nuvem também
  };

  const edit = id=>{
    const d=docs.find(d=>d.id===id);
    if(!d) return;
    setForm({name:d.name,cat:d.cat,tags:Array.isArray(d.tags)?d.tags.join(", "):"",notes:d.notes||""});
    // Arquivo será re-carregado na hora do download, não precisa pré-carregar aqui
    setFileData(null); setFileName(d.fileName||"");
    setEditingId(id); setModal(true);
  };

  // Download: busca o base64 da chave separada na nuvem
  const download = async (doc)=>{
    if(!doc.hasFile) return;
    setDownloading(doc.id);
    try {
      // Tenta primeiro no cache local (se acabou de subir nesta sessão)
      let data = null;
      // Busca da nuvem
      data = await KV.get("doc_file_"+doc.id);
      if(!data) { alert("Arquivo não encontrado na nuvem."); setDownloading(null); return; }
      const a=document.createElement("a");
      a.href=data;
      a.download=doc.fileName||doc.name;
      a.click();
    } catch(e) {
      alert("Erro ao baixar arquivo.");
    }
    setDownloading(null);
  };

  const filtered = filter==="Todos"?docs:docs.filter(d=>d.cat===filter);

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:10}}>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {["Todos",...cats].map(c=>(
            <button key={c} onClick={()=>setFilter(c)} style={{background:filter===c?"var(--accent)":"var(--bg-card)",border:"none",borderRadius:20,padding:"6px 14px",color:filter===c?"#fff":"var(--text-2)",fontSize:12,cursor:"pointer",fontWeight:600}}>{c}</button>
          ))}
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <span style={{fontSize:10,color:synced?"var(--green)":"var(--text-3)"}}>{synced?"☁ sync":"syncing..."}</span>
          <button onClick={()=>setModal(true)} style={{...btn(),display:"flex",alignItems:"center",gap:6}}><Icon path={I.plus} size={14}/> Adicionar</button>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:12}}>
        {filtered.map(d=>(
          <div key={d.id} style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:14,padding:16,position:"relative"}}>
            <div style={{fontSize:28,marginBottom:10}}>{getIcon(d.fileName||d.name)}</div>
            <div style={{fontWeight:700,marginBottom:4,fontSize:14}}>{d.name}</div>
            <div style={{fontSize:11,color:"var(--accent)",marginBottom:6}}>{d.cat}</div>
            {d.notes&&<div style={{fontSize:11,color:"var(--text-3)",marginBottom:6,lineHeight:1.4}}>{d.notes}</div>}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:8}}>
              <span style={{fontSize:10,color:"var(--text-3)"}}>{d.date}</span>
              {d.hasFile&&<button onClick={()=>download(d)} disabled={downloading===d.id} style={{background:"var(--accent-dim)",border:"1px solid var(--accent-bdr)",borderRadius:6,padding:"3px 8px",color:"var(--accent)",fontSize:10,cursor:downloading===d.id?"wait":"pointer",fontWeight:600}}>{downloading===d.id?"⏳...":"⬇ Baixar"}</button>}
            </div>
            <div style={{position:"absolute",top:10,right:10,display:"flex",gap:4}}>
              <button onClick={()=>edit(d.id)} style={{background:"var(--accent-dim)",border:"1px solid var(--accent-bdr)",borderRadius:6,padding:"3px 8px",color:"var(--accent)",fontSize:10,cursor:"pointer"}}>✏️</button>
              <button onClick={()=>del(d.id)} style={{background:"none",border:"none",color:"var(--text-3)",cursor:"pointer"}}><Icon path={I.trash} size={13}/></button>
            </div>
          </div>
        ))}
      </div>
      {filtered.length===0&&<Empty text="Nenhum documento nesta categoria."/>}
      {modal&&(
        <Modal title="Adicionar Documento" onClose={()=>{setModal(false);setFileData(null);setFileName("");}}>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div onClick={()=>fileRef.current?.click()} style={{border:"2px dashed var(--border)",borderRadius:12,padding:"20px",textAlign:"center",cursor:"pointer",background:fileData?"var(--accent-dim)":"transparent"}}>
              <div style={{fontSize:24,marginBottom:8}}>{fileData?"✅":"📎"}</div>
              <div style={{fontSize:13,color:fileData?"var(--accent)":"var(--text-3)"}}>{fileName||"Clique para anexar um arquivo"}</div>
              {fileData&&<div style={{fontSize:10,color:"var(--text-3)",marginTop:4}}>{(fileData.size/1024).toFixed(0)} KB</div>}
              <input ref={fileRef} type="file" style={{display:"none"}} onChange={handleFile}/>
            </div>
            <input style={inp} placeholder="Nome do documento" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/>
            <select style={inp} value={form.cat} onChange={e=>setForm({...form,cat:e.target.value})}>{cats.map(c=><option key={c}>{c}</option>)}</select>
            <input style={inp} placeholder="Tags (separadas por vírgula)" value={form.tags} onChange={e=>setForm({...form,tags:e.target.value})}/>
            <textarea style={{...inp,resize:"vertical"}} rows={2} placeholder="Observações" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/>
            <button onClick={add} style={btn()}>Salvar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── BILLS PAGE ───────────────────────────────────────────────────────────────
function BillsPage() {
  const [bills, setBills, synced] = useKV("bills_v1",[]);
  const [modal, setModal] = useState(false);
  const [form, setForm]   = useState({name:"",value:"",dueDay:"",cat:"Fixo",recurrent:true});
  const cats = ["Fixo","Variável","Cartão","Imposto","Assinatura"];

  const add = ()=>{
    if(!form.name.trim()||!form.dueDay) return;
    const b={id:Date.now(),...form,value:parseFloat(form.value)||0,paid:false};
    const n=[...bills,b]; setBills(n); DB.insert("bills",{...b,due_day:b.dueDay});
    setModal(false); setForm({name:"",value:"",dueDay:"",cat:"Fixo",recurrent:true});
  };
  const toggle = id=>{
    const b=bills.find(b=>b.id===id);
    const n=bills.map(b=>b.id===id?{...b,paid:!b.paid}:b); setBills(n); DB.update("bills",{id,paid:!b.paid});
  };
  const del = id=>{ setBills(p=>p.filter(b=>b.id!==id)); };
  const day = new Date().getDate();
  const upcoming = bills.filter(b=>!b.paid&&+b.dueDay>=day&&+b.dueDay<=day+5);
  const total    = bills.filter(b=>!b.paid).reduce((s,b)=>s+b.value,0);

  return (
    <div>
      {upcoming.length>0&&(
        <div style={{background:"rgba(240,192,64,0.07)",border:"1px solid rgba(240,192,64,0.25)",borderRadius:14,padding:16,marginBottom:20}}>
          <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:10,color:"var(--yellow)",fontWeight:700,fontSize:13}}>
            <Icon path={I.bell} size={16} color="var(--yellow)"/> Vencem em breve ({upcoming.length})
          </div>
          {upcoming.map(b=><div key={b.id} style={{display:"flex",justifyContent:"space-between",fontSize:13,padding:"4px 0"}}><span>{b.name}</span><span style={{color:"var(--yellow)"}}>Dia {b.dueDay} · {fmtMoney(b.value)}</span></div>)}
        </div>
      )}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div style={{color:"var(--text-3)",fontSize:13}}>Total pendente: <span style={{color:"var(--red)",fontWeight:700}}>{fmtMoney(total)}</span></div>
        <button onClick={()=>setModal(true)} style={{...btn(),display:"flex",alignItems:"center",gap:6}}><Icon path={I.plus} size={14}/> Nova Conta</button>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {bills.map(b=>(
          <div key={b.id} style={{background:"var(--bg-card)",border:`1px solid ${b.paid?"var(--border-2)":"var(--border)"}`,borderRadius:12,padding:"14px 18px",display:"flex",alignItems:"center",gap:14,opacity:b.paid?0.5:1}}>
            <button onClick={()=>toggle(b.id)} style={{width:22,height:22,borderRadius:6,border:`2px solid ${b.paid?"var(--green)":"var(--border)"}`,background:b.paid?"var(--green)":"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              {b.paid&&<Icon path={I.check} size={12} color="#fff"/>}
            </button>
            <div style={{flex:1}}>
              <div style={{fontWeight:600,fontSize:14,textDecoration:b.paid?"line-through":"none"}}>{b.name}</div>
              <div style={{fontSize:11,color:"var(--text-3)"}}>{b.cat} · Vence dia {b.dueDay}{b.recurrent?" · Recorrente":""}</div>
            </div>
            <div style={{fontWeight:700,color:b.paid?"var(--green)":"var(--text-1)",fontSize:15,fontFamily:"'DM Mono',monospace"}}>{fmtMoney(b.value)}</div>
            <button onClick={()=>del(b.id)} style={{background:"none",border:"none",color:"var(--text-3)",cursor:"pointer"}}><Icon path={I.trash} size={14}/></button>
          </div>
        ))}
      </div>
      {bills.length===0&&<Empty text="Nenhuma conta cadastrada."/>}
      {modal&&(
        <Modal title="Nova Conta" onClose={()=>setModal(false)}>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <input style={inp} placeholder="Nome da conta" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/>
            <input style={inp} type="number" placeholder="Valor (R$)" value={form.value} onChange={e=>setForm({...form,value:e.target.value})}/>
            <input style={inp} type="number" min="1" max="31" placeholder="Dia do vencimento" value={form.dueDay} onChange={e=>setForm({...form,dueDay:e.target.value})}/>
            <select style={inp} value={form.cat} onChange={e=>setForm({...form,cat:e.target.value})}>{cats.map(c=><option key={c}>{c}</option>)}</select>
            <label style={{display:"flex",gap:10,alignItems:"center",color:"var(--text-2)",fontSize:14,cursor:"pointer"}}>
              <input type="checkbox" checked={form.recurrent} onChange={e=>setForm({...form,recurrent:e.target.checked})}/>
              Conta recorrente (mensal)
            </label>
            <button onClick={add} style={btn()}>Salvar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── EVENTS PAGE ──────────────────────────────────────────────────────────────
function EventsPage() {
  const [events, setEvents, synced] = useKV("events_v1",[]);
  const [modal, setModal] = useState(false);
  const [form, setForm]   = useState({title:"",date:"",time:"",local:"",cat:"Pessoal",notes:""});
  const cats = ["Pessoal","Médico","Reunião","Viagem","Aniversário","Outros"];
  const catColors = {Pessoal:"var(--accent)",Médico:"var(--red)",Reunião:"var(--purple)",Viagem:"var(--green)",Aniversário:"var(--yellow)",Outros:"var(--text-3)"};

  const add = ()=>{
    if(!form.title.trim()||!form.date) return;
    const e={id:Date.now(),...form};
    const n=[...events,e].sort((a,b)=>new Date(a.date+"T"+(a.time||"00:00"))-new Date(b.date+"T"+(b.time||"00:00")));
    setEvents(n); DB.insert("events",e);
    setModal(false); setForm({title:"",date:"",time:"",local:"",cat:"Pessoal",notes:""});
  };
  const del = id=>{ setEvents(p=>p.filter(e=>e.id!==id)); };
  const todayStr = new Date().toISOString().split("T")[0];

  const Card = ({e})=>(
    <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,padding:"14px 18px",display:"flex",gap:14,alignItems:"flex-start",marginBottom:10}}>
      <div style={{width:4,borderRadius:4,background:catColors[e.cat]||"var(--accent)",alignSelf:"stretch",flexShrink:0}}/>
      <div style={{flex:1}}>
        <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>{e.title}</div>
        <div style={{fontSize:12,color:"var(--text-3)"}}>📅 {new Date(e.date+"T12:00").toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"})}{e.time&&` · ⏰ ${e.time}`}{e.local&&` · 📍 ${e.local}`}</div>
        {e.notes&&<div style={{fontSize:12,color:"var(--text-2)",marginTop:6}}>{e.notes}</div>}
      </div>
      <button onClick={()=>del(e.id)} style={{background:"none",border:"none",color:"var(--text-3)",cursor:"pointer"}}><Icon path={I.trash} size={14}/></button>
    </div>
  );

  return (
    <div>
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:20}}>
        <button onClick={()=>setModal(true)} style={{...btn(),display:"flex",alignItems:"center",gap:6}}><Icon path={I.plus} size={14}/> Novo Compromisso</button>
      </div>
      {events.filter(e=>e.date>=todayStr).length>0&&<>
        <div style={{fontSize:11,color:"var(--accent)",letterSpacing:2,fontWeight:700,marginBottom:14,paddingBottom:8,borderBottom:"1px solid var(--border-2)"}}>PRÓXIMOS</div>
        {events.filter(e=>e.date>=todayStr).map(e=><Card key={e.id} e={e}/>)}
      </>}
      {events.filter(e=>e.date<todayStr).length>0&&<>
        <div style={{fontSize:11,color:"var(--text-3)",letterSpacing:2,fontWeight:700,margin:"20px 0 14px",paddingBottom:8,borderBottom:"1px solid var(--border-2)"}}>PASSADOS</div>
        {events.filter(e=>e.date<todayStr).map(e=><Card key={e.id} e={e}/>)}
      </>}
      {events.length===0&&<Empty text="Nenhum compromisso cadastrado."/>}
      {modal&&(
        <Modal title="Novo Compromisso" onClose={()=>setModal(false)}>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <input style={inp} placeholder="Título" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/>
            <input style={inp} type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/>
            <input style={inp} type="time" value={form.time} onChange={e=>setForm({...form,time:e.target.value})}/>
            <input style={inp} placeholder="Local (opcional)" value={form.local} onChange={e=>setForm({...form,local:e.target.value})}/>
            <select style={inp} value={form.cat} onChange={e=>setForm({...form,cat:e.target.value})}>{cats.map(c=><option key={c}>{c}</option>)}</select>
            <textarea style={{...inp,resize:"vertical"}} rows={3} placeholder="Observações" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/>
            <button onClick={add} style={btn()}>Salvar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── WHITEBOARD ───────────────────────────────────────────────────────────────
function WhiteboardCanvas({ boardId }) {
  const canvasRef = useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [color, setColor]     = useState("#3a8fd4");
  const [size, setSize]       = useState(3);
  const [tool, setTool]       = useState("pen");
  const last    = useRef(null);
  const history = useRef([]);
  const storKey = `whiteboard_${boardId}`;

  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    canvas.width=canvas.offsetWidth;
    canvas.height=Math.max(600, window.innerHeight-300);
    const ctx=canvas.getContext("2d");
    ctx.fillStyle="#091828"; ctx.fillRect(0,0,canvas.width,canvas.height);
    // Try cloud first, fall back to localStorage
    KV.get(storKey).then(cloud => {
      const src = cloud || localStorage.getItem(storKey);
      if(src){ const img=new Image(); img.onload=()=>ctx.drawImage(img,0,0); img.src=src; }
    });
  },[boardId]);

  const getPos=e=>{ const r=canvasRef.current.getBoundingClientRect(); const src=e.touches?e.touches[0]:e; return [src.clientX-r.left,src.clientY-r.top]; };

  const startDraw=e=>{
    // Save snapshot for undo
    history.current.push(canvasRef.current.toDataURL());
    if(history.current.length>20) history.current.shift();
    setDrawing(true); last.current=getPos(e);
  };
  const endDraw=()=>{
    setDrawing(false); last.current=null;
    const dataUrl = canvasRef.current.toDataURL();
    localStorage.setItem(storKey, dataUrl);
    KV.set(storKey, dataUrl);
  };
  const draw=e=>{
    if(!drawing||!last.current) return;
    e.preventDefault();
    const canvas=canvasRef.current, ctx=canvas.getContext("2d");
    const [x,y]=getPos(e);
    ctx.beginPath(); ctx.moveTo(last.current[0],last.current[1]); ctx.lineTo(x,y);
    ctx.strokeStyle=tool==="eraser"?"#091828":color;
    ctx.lineWidth=tool==="eraser"?size*8:size;
    ctx.lineCap="round"; ctx.stroke();
    last.current=[x,y];
  };
  const undo=()=>{
    if(!history.current.length) return;
    const prev=history.current.pop();
    const img=new Image(); img.onload=()=>{ const ctx=canvasRef.current.getContext("2d"); ctx.drawImage(img,0,0); }; img.src=prev;
    localStorage.setItem(storKey, prev);
    KV.set(storKey, prev);
  };
  const clear=()=>{
    history.current.push(canvasRef.current.toDataURL());
    const canvas=canvasRef.current, ctx=canvas.getContext("2d");
    ctx.fillStyle="#091828"; ctx.fillRect(0,0,canvas.width,canvas.height);
    localStorage.setItem(storKey, canvas.toDataURL());
  };
  const colors=["#3a8fd4","#f07070","#2ecc8a","#f0c040","#a070e0","#f09050","#ffffff","#7ab0d8"];

  return (
    <div>
      <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:12,flexWrap:"wrap",background:"var(--bg-card)",padding:"10px 16px",borderRadius:12,border:"1px solid var(--border)"}}>
        <div style={{display:"flex",gap:6}}>
          {[["pen","✏️"],["eraser","🧹"]].map(([t,l])=>(
            <button key={t} onClick={()=>setTool(t)} style={{background:tool===t?"var(--accent)":"var(--bg-input)",border:"none",borderRadius:8,padding:"6px 12px",color:tool===t?"#fff":"var(--text-2)",fontSize:12,cursor:"pointer",fontWeight:600}}>{l} {t==="pen"?"Caneta":"Borracha"}</button>
          ))}
        </div>
        <div style={{display:"flex",gap:4}}>
          {colors.map(c=><button key={c} onClick={()=>{setColor(c);setTool("pen");}} style={{width:22,height:22,borderRadius:"50%",background:c,border:`2px solid ${color===c?"white":"transparent"}`,cursor:"pointer"}}/>)}
        </div>
        <input type="range" min="1" max="20" value={size} onChange={e=>setSize(+e.target.value)} style={{width:70}}/>
        <span style={{fontSize:11,color:"var(--text-2)"}}>{size}px</span>
        <button onClick={undo} style={{background:"var(--bg-input)",border:"1px solid var(--border)",borderRadius:8,padding:"6px 12px",color:"var(--text-2)",fontSize:12,cursor:"pointer"}}>↩ Desfazer</button>
        <button onClick={clear} style={{background:"rgba(240,112,112,0.1)",border:"1px solid rgba(240,112,112,0.3)",borderRadius:8,padding:"6px 12px",color:"var(--red)",fontSize:12,cursor:"pointer",marginLeft:"auto"}}>🗑 Limpar</button>
      </div>
      <canvas ref={canvasRef} className="wb-canvas"
        style={{width:"100%",borderRadius:12,border:"1px solid var(--border)",touchAction:"none",display:"block"}}
        onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
        onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw}/>
    </div>
  );
}

function WhiteboardPage() {
  const [boards, setBoards, _wbSync] = useKV("wb_boards_v1", [{id:"wb_default",name:"Lousa 1"}]);
  const [active, setActive] = useState("wb_default");

  const newBoard=()=>{
    const id=`wb_${Date.now()}`;
    const name=`Lousa ${boards.length+1}`;
    const n=[...boards,{id,name}]; setBoards(n); setActive(id);
  };
  const delBoard=id=>{
    if(boards.length===1) return;
    localStorage.removeItem(`whiteboard_${id}`);
    KV.del(`whiteboard_${id}`);
    const n=boards.filter(b=>Number(b.id)!==Number(id)); setBoards(n);
    setActive(n[n.length-1].id);
  };

  return (
    <div>
      {/* Board tabs */}
      <div style={{display:"flex",gap:6,marginBottom:16,alignItems:"center",flexWrap:"wrap"}}>
        {boards.map(b=>(
          <div key={b.id} style={{display:"flex",alignItems:"center",gap:4,background:active===b.id?"var(--accent)":"var(--bg-card)",borderRadius:20,padding:"5px 12px",cursor:"pointer",border:`1px solid ${active===b.id?"var(--accent)":"var(--border)"}`}}
            onClick={()=>setActive(b.id)}>
            <span style={{fontSize:12,fontWeight:600,color:active===b.id?"#fff":"var(--text-2)"}}>{b.name}</span>
            {boards.length>1&&<button onClick={e=>{e.stopPropagation();delBoard(b.id);}} style={{background:"none",border:"none",color:active===b.id?"rgba(255,255,255,0.6)":"var(--text-3)",cursor:"pointer",fontSize:12,lineHeight:1}}>×</button>}
          </div>
        ))}
        <button onClick={newBoard} style={{background:"var(--bg-input)",border:"1px solid var(--border)",borderRadius:20,padding:"5px 14px",color:"var(--text-2)",fontSize:12,cursor:"pointer"}}>+ Nova Lousa</button>
      </div>
      <WhiteboardCanvas key={active} boardId={active}/>
    </div>
  );
}

// ─── TRADINGVIEW WIDGET ───────────────────────────────────────────────────────
function TVWidget({ type, config, height=400 }) {
  const ref = useRef(null);
  useEffect(()=>{
    if(!ref.current) return;
    ref.current.innerHTML="";
    const script=document.createElement("script");
    script.src=`https://s3.tradingview.com/external-embedding/embed-widget-${type}.js`;
    script.async=true;
    script.innerHTML=JSON.stringify({...config,width:"100%",height});
    ref.current.appendChild(script);
  },[type]);
  return <div ref={ref} style={{width:"100%",height,minHeight:height}}><div className="tradingview-widget-container__widget" style={{width:"100%",height:"100%"}}/></div>;
}

function TVCard({ title, children }) {
  return (
    <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:14,overflow:"hidden"}}>
      {title&&<div style={{padding:"10px 16px",background:"var(--bg-bar)",borderBottom:"1px solid var(--border)",fontSize:10,fontWeight:800,color:"var(--accent)",letterSpacing:2}}>{title}</div>}
      {children}
    </div>
  );
}

// ─── MARKET & INDICATORS PAGE ─────────────────────────────────────────────────
const NEWS_CATS=["GLOBAL/GEOPOLÍTICA","EUA","BRASIL","ECONOMIA","BOLSA","MOEDA","COMMODITIES","CRIPTO","GUERRAS","TECNOLOGIA","GERAL"];
const gNewsCache={};
async function fetchGNews(mode,q=""){
  const key=mode+q;
  if(gNewsCache[key]&&Date.now()-gNewsCache[key].ts<15*60*1000) return gNewsCache[key].data;
  try{
    const p=new URLSearchParams({mode}); if(q)p.set("q",q);
    const r=await fetch(`/api/gnews?${p}`); const d=await r.json();
    const items=d.items||[]; if(items.length)gNewsCache[key]={data:items,ts:Date.now()};
    return items;
  }catch{return[];}
}
function useGNews(mode,q){
  const [news,setNews]=useState([]); const [loading,setLoading]=useState(true);
  useEffect(()=>{ setLoading(true); setNews([]); fetchGNews(mode,q).then(i=>{setNews(i);setLoading(false);}); },[mode,q]);
  return {news,loading};
}
function fmtTime(d){
  if(!d) return ""; try{
    const diff=Math.floor((Date.now()-new Date(d))/60000);
    if(diff<60) return `há ${diff}min`; if(diff<1440) return `há ${Math.floor(diff/60)}h`;
    return new Date(d).toLocaleDateString("pt-BR");
  }catch{return "";}
}

function NewsBlock({mode,q,label}){
  const {news,loading}=useGNews(mode,q); const [active,setActive]=useState(null);
  return(
    <>
      <TVCard title={label}>
        <div style={{padding:"0 16px"}}>
          {loading?[1,2,3].map(i=><div key={i} style={{padding:"12px 0",borderBottom:"1px solid var(--border-2)"}}><div style={{height:12,background:"var(--border)",borderRadius:4,marginBottom:6,width:"85%"}}/><div style={{height:9,background:"var(--border-2)",borderRadius:4,width:"35%"}}/></div>):
           news.slice(0,5).map((n,i)=>(
            <div key={i} onClick={()=>setActive(n)} style={{padding:"10px 0",borderBottom:i<4?"1px solid var(--border-2)":"none",cursor:"pointer"}}>
              <div style={{fontSize:13,color:"var(--text-1)",lineHeight:1.5,marginBottom:3}}>{n.title}</div>
              <div style={{display:"flex",gap:8,fontSize:10,color:"var(--text-3)"}}><span>{n.src}</span><span>{fmtTime(n.date)}</span></div>
            </div>
           ))
          }
          {!loading&&news.length===0&&<div style={{padding:"16px 0",fontSize:12,color:"var(--text-3)",textAlign:"center"}}>Sem notícias no momento</div>}
        </div>
      </TVCard>
      {active&&<Modal title={active.title} onClose={()=>setActive(null)}>
        <div style={{fontSize:12,color:"var(--text-3)",marginBottom:16}}>{active.src} {active.date&&`· ${fmtTime(active.date)}`}</div>
        <a href={active.link} target="_blank" rel="noreferrer" style={{display:"inline-flex",alignItems:"center",gap:8,background:"var(--accent)",color:"#fff",padding:"10px 18px",borderRadius:10,fontSize:14,fontWeight:700,textDecoration:"none"}}>
          <Icon path={I.link} size={14} color="#fff"/> Ler matéria completa
        </a>
      </Modal>}
    </>
  );
}

function MarketPage() {
  const [tab, setTab] = useState("indicadores");
  const [mkt, setMkt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);

  const fetchMkt = async () => {
    try {
      const r = await fetch("/api/market2");
      const d = await r.json();
      if (!d.error) { setMkt(d); setLastUpdate(new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})); }
    } catch {}
    setLoading(false);
  };

  useEffect(() => { fetchMkt(); const id=setInterval(fetchMkt,60000); return()=>clearInterval(id); }, []);

  const tabs = [
    {id:"indicadores", l:"📊 Indicadores"},
    {id:"cambio",      l:"💱 Câmbio"},
    {id:"commodities", l:"🛢 Commodities"},
    {id:"cripto",      l:"₿ Cripto"},
    {id:"noticias",    l:"📰 Notícias"},
    {id:"calendario",  l:"📅 Calendário"},
    {id:"curiosidades",l:"⭐ Curiosidades"},
  ];

  const Row = ({item}) => (
    <tr style={{borderBottom:"1px solid var(--border)"}}>
      <td style={{padding:"7px 10px",fontSize:13,color:"var(--text-1)",whiteSpace:"nowrap"}}>
        <span style={{marginRight:6}}>{item.flag}</span>{item.name}
      </td>
      <td style={{padding:"7px 10px",fontSize:13,fontWeight:700,color:"var(--text-1)",textAlign:"right",whiteSpace:"nowrap"}}>{item.price}</td>
      <td style={{padding:"7px 10px",fontSize:12,fontWeight:700,textAlign:"right",whiteSpace:"nowrap",
        color:item.up===true?"#22c55e":item.up===false?"#ef4444":"var(--text-3)"}}>{item.chg}</td>
      <td style={{padding:"7px 10px",fontSize:12,fontWeight:700,textAlign:"right",whiteSpace:"nowrap"}}>
        <span style={{background:item.up===true?"#22c55e22":item.up===false?"#ef444422":"var(--bg-input)",
          color:item.up===true?"#22c55e":item.up===false?"#ef4444":"var(--text-3)",
          borderRadius:6,padding:"2px 7px",fontSize:11}}>{item.pct}</span>
      </td>
      <td style={{padding:"7px 10px",fontSize:10,color:"var(--text-3)",textAlign:"right"}}>{item.time}</td>
    </tr>
  );

  const Table = ({title, data}) => (
    <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden"}}>
      <div style={{padding:"10px 14px",borderBottom:"1px solid var(--border)"}}>
        <span style={{fontSize:13,fontWeight:800,color:"var(--text-1)"}}>{title}</span>
      </div>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead>
            <tr style={{background:"var(--bg-sub)"}}>
              {["NOME","ÚLTIMO","VAR.","VAR.%","HORA"].map((h,i)=>(
                <th key={h} style={{padding:"6px 10px",fontSize:10,color:"var(--text-3)",
                  textAlign:i===0?"left":"right",fontWeight:700,letterSpacing:1}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && !data ? [1,2,3,4].map(i=>(
              <tr key={i}><td colSpan={5} style={{padding:"10px 14px"}}>
                <div style={{height:12,background:"var(--bg-sub)",borderRadius:4}}/>
              </td></tr>
            )) : (data||[]).map((item,i)=><Row key={i} item={item}/>)}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div>
      <div style={{display:"flex",gap:6,marginBottom:18,flexWrap:"wrap",alignItems:"center"}}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{
            background:tab===t.id?"var(--accent)":"var(--bg-card)",
            border:`1px solid ${tab===t.id?"var(--accent)":"var(--border)"}`,
            borderRadius:20,padding:"7px 16px",
            color:tab===t.id?"#fff":"var(--text-2)",
            fontSize:12,fontWeight:700,cursor:"pointer",transition:"all .15s",
          }}>{t.l}</button>
        ))}
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8}}>
          {lastUpdate&&<span style={{fontSize:10,color:"var(--text-3)"}}>Atualizado {lastUpdate}</span>}
          <button onClick={fetchMkt} style={{...btn("var(--bg-card)"),border:"1px solid var(--border)",color:"var(--text-2)",padding:"6px 12px",fontSize:11,borderRadius:16}}>↻</button>
        </div>
      </div>

      {tab==="indicadores"&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(380px,1fr))",gap:14}}>
          <Table title="🌎 AMÉRICAS" data={mkt?.americas}/>
          <Table title="🇪🇺 EUROPA"  data={mkt?.europa}/>
          <Table title="🌏 ÁSIA & OCEANIA" data={mkt?.asia}/>
          <Table title="📋 FUTUROS" data={mkt?.futuros}/>
        </div>
      )}

      {tab==="cambio"&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(400px,1fr))",gap:14}}>
          <Table title="💱 CÂMBIO" data={mkt?.cambio}/>
          <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden"}}>
            <div style={{padding:"10px 14px",borderBottom:"1px solid var(--border)"}}>
              <span style={{fontSize:13,fontWeight:800,color:"var(--text-1)"}}>📊 Cross Rates — TradingView</span>
            </div>
            <TVWidget type="forex-cross-rates" height={400} config={{colorTheme:"light",isTransparent:true,locale:"pt_BR",currencies:["USD","BRL","EUR","GBP","JPY","CNY","CHF","AUD","CAD"]}}/>
          </div>
        </div>
      )}

      {tab==="commodities"&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(400px,1fr))",gap:14}}>
          <Table title="🛢 COMMODITIES" data={mkt?.commodities}/>
          <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden"}}>
            <div style={{padding:"10px 14px",borderBottom:"1px solid var(--border)"}}>
              <span style={{fontSize:13,fontWeight:800,color:"var(--text-1)"}}>📈 TradingView</span>
            </div>
            <TVWidget type="market-overview" height={480} config={{colorTheme:"light",locale:"pt_BR",isTransparent:true,tabs:[{title:"Commodities",symbols:[{s:"TVC:GOLD",d:"Ouro"},{s:"TVC:SILVER",d:"Prata"},{s:"TVC:USOIL",d:"Petróleo WTI"},{s:"TVC:UKOIL",d:"Brent"},{s:"CBOT:ZS1!",d:"Soja"},{s:"CBOT:ZC1!",d:"Milho"},{s:"CBOT:ZW1!",d:"Trigo"},{s:"NYMEX:KC1!",d:"Café"}],originalTitle:"Commodities"}]}}/>
          </div>
        </div>
      )}

      {tab==="cripto"&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(400px,1fr))",gap:14}}>
          <Table title="₿ CRIPTOMOEDAS" data={mkt?.cripto}/>
          <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden"}}>
            <div style={{padding:"10px 14px",borderBottom:"1px solid var(--border)"}}>
              <span style={{fontSize:13,fontWeight:800,color:"var(--text-1)"}}>📊 Cripto — TradingView</span>
            </div>
            <TVWidget type="market-overview" height={480} config={{colorTheme:"light",locale:"pt_BR",isTransparent:true,tabs:[{title:"Cripto",symbols:[{s:"BITSTAMP:BTCUSD",d:"Bitcoin"},{s:"BITSTAMP:ETHUSD",d:"Ethereum"},{s:"BINANCE:BNBUSD",d:"BNB"},{s:"BINANCE:SOLUSD",d:"Solana"},{s:"BINANCE:XRPUSD",d:"XRP"},{s:"BINANCE:ADAUSD",d:"Cardano"},{s:"BINANCE:DOGEUSD",d:"Dogecoin"},{s:"BINANCE:AVAXUSD",d:"Avalanche"}],originalTitle:"Cripto"}]}}/>
          </div>
        </div>
      )}

      {tab==="noticias"&&(
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
          <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden"}}>
            <div style={{padding:"10px 14px",borderBottom:"1px solid var(--border)"}}>
              <span style={{fontSize:13,fontWeight:800,color:"var(--text-1)"}}>🌍 Notícias Globais — TradingView</span>
            </div>
            <div className="tradingview-widget-container" style={{height:580}}>
              <div className="tradingview-widget-container__widget" style={{height:"100%"}}/>
              <script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-timeline.js" async>{JSON.stringify({feedMode:"all_symbols",colorTheme:"light",isTransparent:true,displayMode:"regular",width:"100%",height:580,locale:"pt_BR"})}</script>
            </div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden",flex:1}}>
              <div style={{padding:"10px 14px",borderBottom:"1px solid var(--border)"}}>
                <span style={{fontSize:13,fontWeight:800,color:"var(--text-1)"}}>📈 Ibovespa</span>
              </div>
              <div className="tradingview-widget-container" style={{height:270}}>
                <div className="tradingview-widget-container__widget" style={{height:"100%"}}/>
                <script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-timeline.js" async>{JSON.stringify({feedMode:"symbol",symbol:"BMFBOVESPA:IBOV",colorTheme:"light",isTransparent:true,displayMode:"compact",width:"100%",height:270,locale:"pt_BR"})}</script>
              </div>
            </div>
            <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden",flex:1}}>
              <div style={{padding:"10px 14px",borderBottom:"1px solid var(--border)"}}>
                <span style={{fontSize:13,fontWeight:800,color:"var(--text-1)"}}>₿ Bitcoin</span>
              </div>
              <div className="tradingview-widget-container" style={{height:270}}>
                <div className="tradingview-widget-container__widget" style={{height:"100%"}}/>
                <script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-timeline.js" async>{JSON.stringify({feedMode:"symbol",symbol:"BITSTAMP:BTCUSD",colorTheme:"light",isTransparent:true,displayMode:"compact",width:"100%",height:270,locale:"pt_BR"})}</script>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab==="calendario"&&(
        <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden"}}>
          <div style={{padding:"12px 16px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
            <span style={{fontSize:14,fontWeight:800,color:"var(--text-1)"}}>📅 Agenda Econômica — TradingView</span>
            <div style={{display:"flex",gap:8}}>
              <a href="https://br.investing.com/economic-calendar" target="_blank" rel="noreferrer"
                style={{fontSize:11,color:"var(--accent)",textDecoration:"none"}}>Investing.com ↗</a>
              <a href="https://br.tradingview.com/economic-calendar/" target="_blank" rel="noreferrer"
                style={{fontSize:11,color:"var(--accent)",textDecoration:"none"}}>TradingView ↗</a>
            </div>
          </div>
          <div className="tradingview-widget-container" style={{height:600}}>
            <div className="tradingview-widget-container__widget" style={{height:"100%"}}/>
            <script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-events.js" async>{JSON.stringify({
              colorTheme:"light",
              isTransparent:true,
              width:"100%",
              height:600,
              locale:"pt_BR",
              importanceFilter:"0,1",
              countryFilter:"us,eu,gb,br,cn,jp,de,fr,it,ca,au,nz,ch,es"
            })}</script>
          </div>
        </div>
      )}

      {tab==="curiosidades"&&<CuriositiesPage/>}
    </div>
  );
}

// ─── CURIOSITIES PAGE ─────────────────────────────────────────────────────────
function CuriositiesPage() {
  const [cards,setCards,_curSync]=useKV("curiosities_v1",[]);
  const [modal,setModal]=useState(false);
  const [detail,setDetail]=useState(null);
  const [form,setForm]=useState({title:"",content:"",link:"",imageUrl:"",tag:""});
  const [updTxt,setUpdTxt]=useState("");

  const add=()=>{ if(!form.title.trim()) return; const n=[...cards,{id:Date.now(),...form,updates:[],created:now()}]; setCards(n); setModal(false); setForm({title:"",content:"",link:"",imageUrl:"",tag:""}); };
  const addUpdate=id=>{ if(!updTxt.trim()) return; const n=cards.map(c=>c.id===id?{...c,updates:[...c.updates,{text:updTxt,date:now()}]}:c); setCards(n); setDetail(n.find(c=>c.id===id)); setUpdTxt(""); };
  const del=id=>{ setCards(cards.filter(c=>Number(c.id)!==Number(id))); setDetail(null); };

  return(
    <div>
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:20}}>
        <button onClick={()=>setModal(true)} style={{...btn(),display:"flex",alignItems:"center",gap:6}}><Icon path={I.plus} size={14}/> Nova Curiosidade</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:14}}>
        {cards.map(c=>(
          <div key={c.id} onClick={()=>setDetail(c)} style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:16,overflow:"hidden",cursor:"pointer"}}>
            {c.imageUrl&&<div style={{height:120,background:`url(${c.imageUrl}) center/cover`,borderBottom:"1px solid var(--border)"}}/>}
            <div style={{padding:16}}>
              {c.tag&&<span style={{background:"var(--bg-input)",borderRadius:4,padding:"2px 8px",fontSize:10,color:"var(--accent)",fontWeight:700,display:"inline-block",marginBottom:8,letterSpacing:1}}>{c.tag.toUpperCase()}</span>}
              <div style={{fontWeight:700,marginBottom:6,fontSize:14}}>{c.title}</div>
              <div style={{fontSize:12,color:"var(--text-3)",lineHeight:1.5,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{c.content}</div>
              {c.updates.length>0&&<div style={{fontSize:10,color:"var(--accent)",marginTop:8}}>{c.updates.length} atualização(ões)</div>}
            </div>
          </div>
        ))}
      </div>
      {cards.length===0&&<Empty text="Nenhuma curiosidade ainda."/>}
      {modal&&<Modal title="Nova Curiosidade" onClose={()=>setModal(false)} wide>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <input style={inp} placeholder="Título" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/>
          <input style={inp} placeholder="Tag / Categoria" value={form.tag} onChange={e=>setForm({...form,tag:e.target.value})}/>
          <textarea style={{...inp,resize:"vertical"}} rows={5} placeholder="Conteúdo" value={form.content} onChange={e=>setForm({...form,content:e.target.value})}/>
          <input style={inp} placeholder="URL de imagem (opcional)" value={form.imageUrl} onChange={e=>setForm({...form,imageUrl:e.target.value})}/>
          <input style={inp} placeholder="Link de referência (opcional)" value={form.link} onChange={e=>setForm({...form,link:e.target.value})}/>
          <button onClick={add} style={btn()}>Salvar Card</button>
        </div>
      </Modal>}
      {detail&&<Modal title={detail.title} onClose={()=>setDetail(null)} wide>
        {detail.imageUrl&&<img src={detail.imageUrl} alt="" style={{width:"100%",borderRadius:10,marginBottom:16,maxHeight:240,objectFit:"cover"}}/>}
        {detail.tag&&<span style={{background:"var(--bg-input)",borderRadius:4,padding:"2px 8px",fontSize:10,color:"var(--accent)",fontWeight:700,display:"inline-block",marginBottom:12,letterSpacing:1}}>{detail.tag.toUpperCase()}</span>}
        <p style={{color:"var(--text-2)",lineHeight:1.7,fontSize:14,marginBottom:16}}>{detail.content}</p>
        {detail.link&&<a href={detail.link} target="_blank" rel="noreferrer" style={{color:"var(--accent)",fontSize:12,display:"flex",gap:6,alignItems:"center",marginBottom:16}}><Icon path={I.link} size={14}/>{detail.link}</a>}
        <div style={{borderTop:"1px solid var(--border)",paddingTop:16}}>
          <div style={{fontSize:10,color:"var(--text-3)",letterSpacing:2,fontWeight:700,marginBottom:12}}>ATUALIZAÇÕES</div>
          {detail.updates.map((u,i)=><div key={i} style={{background:"var(--bg-input)",borderRadius:10,padding:"10px 14px",marginBottom:10}}><div style={{color:"var(--text-2)",fontSize:13}}>{u.text}</div><div style={{fontSize:10,color:"var(--text-3)",marginTop:4}}>🕐 {u.date}</div></div>)}
          <div style={{display:"flex",gap:10,marginTop:12}}>
            <textarea style={{...inp,flex:1,resize:"none"}} rows={2} placeholder="Adicionar atualização..." value={updTxt} onChange={e=>setUpdTxt(e.target.value)}/>
            <button onClick={()=>addUpdate(detail.id)} style={{...btn("var(--green)"),alignSelf:"flex-end",padding:"10px 16px"}}>+</button>
          </div>
        </div>
        <button onClick={()=>del(detail.id)} style={{marginTop:16,background:"rgba(240,112,112,0.08)",border:"1px solid rgba(240,112,112,0.25)",borderRadius:10,padding:"8px 16px",color:"var(--red)",fontSize:13,cursor:"pointer"}}>Excluir card</button>
      </Modal>}
    </div>
  );
}


// ─── MACRO CARDS PAGE ─────────────────────────────────────────────────────────
function MacroPage() {
  const [cards, setCards, _macSync] = useKV("macro_cards_v1", []);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ title:"", content:"", link:"", tag:"", color:"#1a3d5c" });

  const COLORS = ["#1a3d5c","#2d1a5c","#1a4a2e","#5c2d1a","#1a4a4a","#3d1a1a"];

  const save = n => { setCards(n); };
  const add = () => {
    if(!form.title.trim()) return;
    const c = { id:Date.now(), ...form, created:now(), updates:[] };
    save([c, ...cards]);
    setModal(false); setForm({ title:"", content:"", link:"", tag:"", color:"#1a3d5c" });
  };
  const del = id => save(cards.filter(c => c.id !== id));
  const openEdit = c => { setEditing({...c}); };
  const saveEdit = () => {
    save(cards.map(c => c.id === editing.id ? { ...editing, lastEdit: now() } : c));
    setEditing(null);
  };
  const addUpdate = (id, text) => {
    if(!text.trim()) return;
    const upd = { text, date: now() };
    save(cards.map(c => c.id === id ? { ...c, updates: [...(c.updates||[]), upd] } : c));
  };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div style={{fontSize:12,color:"var(--text-3)"}}>Cards estratégicos, projetos e contexto macro</div>
        <button onClick={()=>setModal(true)} style={{...btn(),display:"flex",alignItems:"center",gap:6}}>
          <Icon path={I.plus} size={14}/> Novo Card
        </button>
      </div>

      <div style={{columns:"320px",columnGap:14}}>
        {cards.map(c => (
          <div key={c.id} style={{breakInside:"avoid",background:c.color||"var(--bg-card)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:14,padding:18,marginBottom:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
              <div style={{flex:1}}>
                {c.tag && <span style={{background:"rgba(255,255,255,0.15)",borderRadius:20,padding:"2px 10px",fontSize:10,color:"rgba(255,255,255,0.8)",fontWeight:700,letterSpacing:1,display:"inline-block",marginBottom:6}}>{c.tag.toUpperCase()}</span>}
                <div style={{fontWeight:700,fontSize:15,color:"#fff"}}>{c.title}</div>
              </div>
              <div style={{display:"flex",gap:6,marginLeft:10}}>
                <button onClick={()=>openEdit(c)} style={{background:"rgba(255,255,255,0.1)",border:"none",borderRadius:8,padding:"5px 8px",color:"rgba(255,255,255,0.7)",fontSize:11,cursor:"pointer"}}>✏️</button>
                <button onClick={()=>del(c.id)} style={{background:"none",border:"none",color:"rgba(255,255,255,0.4)",cursor:"pointer"}}><Icon path={I.trash} size={13}/></button>
              </div>
            </div>
            {c.content && <p style={{fontSize:13,color:"rgba(255,255,255,0.8)",lineHeight:1.7,marginBottom:10,whiteSpace:"pre-wrap"}}>{c.content}</p>}
            {c.link && <a href={c.link} target="_blank" rel="noreferrer" style={{fontSize:11,color:"rgba(255,255,255,0.6)",display:"flex",alignItems:"center",gap:4,marginBottom:8,textDecoration:"none"}}>🔗 {c.link.replace(/https?:\/\//,"").slice(0,40)}</a>}
            {c.updates?.length > 0 && (
              <div style={{borderTop:"1px solid rgba(255,255,255,0.1)",paddingTop:8,marginTop:8}}>
                {c.updates.slice(-2).map((u,i) => (
                  <div key={i} style={{fontSize:11,color:"rgba(255,255,255,0.6)",marginBottom:4}}>
                    <span style={{color:"rgba(255,255,255,0.4)",marginRight:6}}>↳ {u.date}</span>{u.text}
                  </div>
                ))}
              </div>
            )}
            <div style={{fontSize:10,color:"rgba(255,255,255,0.35)",marginTop:8}}>{c.lastEdit||c.created}</div>
          </div>
        ))}
      </div>
      {cards.length===0&&<Empty text="Nenhum card ainda. Crie o primeiro!"/>}

      {modal && <Modal title="Novo Card Macro" onClose={()=>setModal(false)} wide>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <input style={inp} placeholder="Título" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/>
          <input style={inp} placeholder="Tag (ex: Estratégia, Mercado, Projeto)" value={form.tag} onChange={e=>setForm({...form,tag:e.target.value})}/>
          <textarea style={{...inp,resize:"vertical"}} rows={5} placeholder="Conteúdo, contexto, análise..." value={form.content} onChange={e=>setForm({...form,content:e.target.value})}/>
          <input style={inp} placeholder="Link (opcional)" value={form.link} onChange={e=>setForm({...form,link:e.target.value})}/>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <span style={{fontSize:12,color:"var(--text-3)"}}>Cor:</span>
            {COLORS.map(c=><button key={c} onClick={()=>setForm({...form,color:c})} style={{width:24,height:24,borderRadius:6,background:c,border:`2px solid ${form.color===c?"white":"transparent"}`,cursor:"pointer"}}/>)}
          </div>
          <button onClick={add} style={btn()}>Criar Card</button>
        </div>
      </Modal>}

      {editing && <Modal title="Editar Card" onClose={()=>setEditing(null)} wide>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <input style={inp} value={editing.title} onChange={e=>setEditing({...editing,title:e.target.value})}/>
          <input style={inp} value={editing.tag||""} onChange={e=>setEditing({...editing,tag:e.target.value})}/>
          <textarea style={{...inp,resize:"vertical"}} rows={6} value={editing.content||""} onChange={e=>setEditing({...editing,content:e.target.value})}/>
          <input style={inp} placeholder="Link" value={editing.link||""} onChange={e=>setEditing({...editing,link:e.target.value})}/>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <span style={{fontSize:12,color:"var(--text-3)"}}>Cor:</span>
            {COLORS.map(c=><button key={c} onClick={()=>setEditing({...editing,color:c})} style={{width:24,height:24,borderRadius:6,background:c,border:`2px solid ${editing.color===c?"white":"transparent"}`,cursor:"pointer"}}/>)}
          </div>
          <div style={{borderTop:"1px solid var(--border)",paddingTop:14}}>
            <div style={{fontSize:10,color:"var(--text-3)",letterSpacing:2,marginBottom:10,fontWeight:700}}>ADICIONAR ATUALIZAÇÃO</div>
            <UpdateInput onSave={text=>addUpdate(editing.id,text)}/>
          </div>
          <button onClick={saveEdit} style={btn()}>Salvar</button>
        </div>
      </Modal>}
    </div>
  );
}

function UpdateInput({ onSave }) {
  const [text, setText] = useState("");
  return (
    <div style={{display:"flex",gap:10}}>
      <input style={{...inp,flex:1}} placeholder="Adicionar atualização..." value={text} onChange={e=>setText(e.target.value)}
        onKeyDown={e=>{ if(e.key==="Enter"&&text.trim()){ onSave(text); setText(""); } }}/>
      <button onClick={()=>{ if(text.trim()){ onSave(text); setText(""); } }} style={{...btn("var(--green)"),padding:"10px 16px"}}>+</button>
    </div>
  );
}

// ─── FERRAMENTAS / SIMULADORES ────────────────────────────────────────────────
function PortfolioSimulator() {
  const [assets, setAssets, _s1] = useKV("sim_assets_v1", []);
  const [form, setForm] = useState({ name:"", ticker:"", qty:"", price:"", type:"Ação" });
  const types = ["Ação","FII","Cripto","Renda Fixa","ETF","Outro"];

  const save = n => { setAssets(n); };
  const add = () => {
    if(!form.name||!form.qty||!form.price) return;
    save([...assets, { id:Date.now(), ...form, qty:+form.qty, price:+form.price }]);
    setForm({ name:"", ticker:"", qty:"", price:"", type:"Ação" });
  };
  const del = id => save(assets.filter(a => a.id !== id));

  const total = assets.reduce((s,a) => s + a.qty*a.price, 0);
  const byType = types.map(t => ({ type:t, value:assets.filter(a=>a.type===t).reduce((s,a)=>s+a.qty*a.price,0) })).filter(t=>t.value>0);

  return (
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
      {/* Input */}
      <div>
        <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:14,padding:18,marginBottom:16}}>
          <div style={{fontSize:11,color:"var(--accent)",letterSpacing:2,fontWeight:800,marginBottom:14}}>📊 ADICIONAR ATIVO</div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <input style={inp} placeholder="Nome (ex: Petrobras)" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/>
            <input style={inp} placeholder="Ticker (ex: PETR4)" value={form.ticker} onChange={e=>setForm({...form,ticker:e.target.value})}/>
            <div style={{display:"flex",gap:10}}>
              <input style={{...inp,flex:1}} placeholder="Qtd" type="number" value={form.qty} onChange={e=>setForm({...form,qty:e.target.value})}/>
              <input style={{...inp,flex:1}} placeholder="Preço R$" type="number" value={form.price} onChange={e=>setForm({...form,price:e.target.value})}/>
            </div>
            <select style={inp} value={form.type} onChange={e=>setForm({...form,type:e.target.value})}>{types.map(t=><option key={t}>{t}</option>)}</select>
            <button onClick={add} style={btn()}>+ Adicionar</button>
          </div>
        </div>
        {/* Summary */}
        <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:14,padding:18}}>
          <div style={{fontSize:11,color:"var(--accent)",letterSpacing:2,fontWeight:800,marginBottom:14}}>DISTRIBUIÇÃO</div>
          {byType.map(t => (
            <div key={t.type} style={{marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:4}}>
                <span style={{color:"var(--text-2)"}}>{t.type}</span>
                <span style={{fontWeight:700}}>{total>0?((t.value/total)*100).toFixed(1):0}%</span>
              </div>
              <div style={{height:6,background:"var(--bg-input)",borderRadius:3,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${total>0?(t.value/total)*100:0}%`,background:"var(--accent)",borderRadius:3,transition:"width .3s"}}/>
              </div>
            </div>
          ))}
          <div style={{marginTop:14,paddingTop:14,borderTop:"1px solid var(--border)",display:"flex",justifyContent:"space-between"}}>
            <span style={{color:"var(--text-3)",fontSize:13}}>Total carteira</span>
            <span style={{fontWeight:800,fontSize:16,color:"var(--green)",fontFamily:"'DM Mono',monospace"}}>{fmtMoney(total)}</span>
          </div>
        </div>
      </div>
      {/* Asset list */}
      <div>
        <div style={{fontSize:11,color:"var(--text-3)",letterSpacing:2,fontWeight:700,marginBottom:12}}>ATIVOS</div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {assets.map(a => (
            <div key={a.id} style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,padding:"12px 16px",display:"flex",alignItems:"center",gap:12}}>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,fontSize:14}}>{a.ticker||a.name}</div>
                <div style={{fontSize:11,color:"var(--text-3)"}}>{a.type} · {a.qty} cotas · {fmtMoney(a.price)} cada</div>
              </div>
              <div style={{fontWeight:700,color:"var(--green)",fontFamily:"'DM Mono',monospace",fontSize:14}}>{fmtMoney(a.qty*a.price)}</div>
              <button onClick={()=>del(a.id)} style={{background:"none",border:"none",color:"var(--text-3)",cursor:"pointer"}}><Icon path={I.trash} size={14}/></button>
            </div>
          ))}
          {assets.length===0&&<Empty text="Adicione ativos para simular"/>}
        </div>
      </div>
    </div>
  );
}

function CashFlowSimulator() {
  const [items, setItems, _s2] = useKV("sim_cashflow_v1", []);
  const [form, setForm] = useState({ desc:"", value:"", type:"entrada", month:"", recurrent:false });

  const save = n => { setItems(n); };
  const add = () => {
    if(!form.desc||!form.value) return;
    save([...items, { id:Date.now(), ...form, value:+form.value }]);
    setForm({ desc:"", value:"", type:"entrada", month:"", recurrent:false });
  };
  const del = id => save(items.filter(i => i.id !== id));

  const entradas = items.filter(i=>i.type==="entrada").reduce((s,i)=>s+i.value,0);
  const saidas   = items.filter(i=>i.type==="saida").reduce((s,i)=>s+i.value,0);
  const saldo    = entradas - saidas;

  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:20}}>
        {[["Entradas",entradas,"var(--green)","📈"],["Saídas",saidas,"var(--red)","📉"],["Saldo",saldo,saldo>=0?"var(--green)":"var(--red)","💰"]].map(([l,v,c,e])=>(
          <div key={l} style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,padding:"14px 18px",textAlign:"center"}}>
            <div style={{fontSize:20,marginBottom:4}}>{e}</div>
            <div style={{fontSize:11,color:"var(--text-3)",letterSpacing:1,marginBottom:4}}>{l.toUpperCase()}</div>
            <div style={{fontSize:20,fontWeight:800,color:c,fontFamily:"'DM Mono',monospace"}}>{fmtMoney(Math.abs(v))}</div>
          </div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        <div>
          <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:14,padding:18,marginBottom:16}}>
            <div style={{fontSize:11,color:"var(--accent)",letterSpacing:2,fontWeight:800,marginBottom:14}}>ADICIONAR ITEM</div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              <input style={inp} placeholder="Descrição" value={form.desc} onChange={e=>setForm({...form,desc:e.target.value})}/>
              <input style={inp} type="number" placeholder="Valor R$" value={form.value} onChange={e=>setForm({...form,value:e.target.value})}/>
              <select style={inp} value={form.type} onChange={e=>setForm({...form,type:e.target.value})}>
                <option value="entrada">📈 Entrada</option>
                <option value="saida">📉 Saída</option>
              </select>
              <input style={inp} placeholder="Mês (ex: Jan 2026)" value={form.month} onChange={e=>setForm({...form,month:e.target.value})}/>
              <button onClick={add} style={btn()}>+ Adicionar</button>
            </div>
          </div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {items.map(i=>(
            <div key={i.id} style={{background:"var(--bg-card)",border:`1px solid ${i.type==="entrada"?"rgba(46,204,138,0.3)":"rgba(240,112,112,0.3)"}`,borderRadius:12,padding:"12px 16px",display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:18}}>{i.type==="entrada"?"📈":"📉"}</span>
              <div style={{flex:1}}>
                <div style={{fontWeight:600,fontSize:13}}>{i.desc}</div>
                {i.month&&<div style={{fontSize:10,color:"var(--text-3)"}}>{i.month}</div>}
              </div>
              <span style={{fontWeight:700,color:i.type==="entrada"?"var(--green)":"var(--red)",fontFamily:"'DM Mono',monospace",fontSize:14}}>{i.type==="saida"?"-":""}{fmtMoney(i.value)}</span>
              <button onClick={()=>del(i.id)} style={{background:"none",border:"none",color:"var(--text-3)",cursor:"pointer"}}><Icon path={I.trash} size={13}/></button>
            </div>
          ))}
          {items.length===0&&<Empty text="Nenhum item ainda"/>}
        </div>
      </div>
    </div>
  );
}

function ProfessionalPortfolioSim() {
  const [projects, setProjects, _s3] = useKV("sim_portfolio_v1", []);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ name:"", desc:"", status:"Em andamento", client:"", value:"", tags:"" });
  const statuses = ["Em andamento","Concluído","Pausado","Proposta"];
  const statusColor = {"Em andamento":"var(--accent)","Concluído":"var(--green)","Pausado":"var(--yellow)","Proposta":"var(--purple)"};

  const save = n => { setProjects(n); };
  const add = () => {
    if(!form.name) return;
    save([{ id:Date.now(), ...form, value:+form.value||0, tags:form.tags.split(",").map(t=>t.trim()).filter(Boolean), date:now() }, ...projects]);
    setModal(false); setForm({ name:"", desc:"", status:"Em andamento", client:"", value:"", tags:"" });
  };
  const del = id => save(projects.filter(p => p.id !== id));

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div style={{display:"flex",gap:8}}>
          {statuses.map(s => <span key={s} style={{fontSize:11,color:statusColor[s],fontWeight:700}}>{projects.filter(p=>p.status===s).length} {s}</span>)}
        </div>
        <button onClick={()=>setModal(true)} style={{...btn(),display:"flex",alignItems:"center",gap:6}}><Icon path={I.plus} size={14}/> Novo Projeto</button>
      </div>
      <div style={{columns:"300px",columnGap:14}}>
        {projects.map(p => (
          <div key={p.id} style={{breakInside:"avoid",background:"var(--bg-card)",border:`1px solid ${statusColor[p.status]}44`,borderRadius:14,padding:16,marginBottom:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
              <div style={{flex:1}}>
                <span style={{fontSize:10,color:statusColor[p.status],fontWeight:700,letterSpacing:1}}>{p.status.toUpperCase()}</span>
                <div style={{fontWeight:700,fontSize:15,marginTop:2}}>{p.name}</div>
                {p.client&&<div style={{fontSize:11,color:"var(--text-3)"}}>👤 {p.client}</div>}
              </div>
              <button onClick={()=>del(p.id)} style={{background:"none",border:"none",color:"var(--text-3)",cursor:"pointer"}}><Icon path={I.trash} size={13}/></button>
            </div>
            {p.desc&&<p style={{fontSize:13,color:"var(--text-2)",lineHeight:1.6,marginBottom:8}}>{p.desc}</p>}
            {p.value>0&&<div style={{fontSize:13,fontWeight:700,color:"var(--green)",fontFamily:"'DM Mono',monospace",marginBottom:6}}>{fmtMoney(p.value)}</div>}
            {p.tags?.length>0&&<div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
              {p.tags.map(t=><span key={t} style={{background:"var(--bg-input)",borderRadius:4,padding:"2px 8px",fontSize:10,color:"var(--text-3)"}}>{t}</span>)}
            </div>}
          </div>
        ))}
      </div>
      {projects.length===0&&<Empty text="Nenhum projeto no portfólio ainda."/>}
      {modal&&<Modal title="Novo Projeto" onClose={()=>setModal(false)}>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <input style={inp} placeholder="Nome do projeto" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/>
          <input style={inp} placeholder="Cliente" value={form.client} onChange={e=>setForm({...form,client:e.target.value})}/>
          <textarea style={{...inp,resize:"vertical"}} rows={3} placeholder="Descrição" value={form.desc} onChange={e=>setForm({...form,desc:e.target.value})}/>
          <select style={inp} value={form.status} onChange={e=>setForm({...form,status:e.target.value})}>{statuses.map(s=><option key={s}>{s}</option>)}</select>
          <input style={inp} type="number" placeholder="Valor R$" value={form.value} onChange={e=>setForm({...form,value:e.target.value})}/>
          <input style={inp} placeholder="Tags (separadas por vírgula)" value={form.tags} onChange={e=>setForm({...form,tags:e.target.value})}/>
          <button onClick={add} style={btn()}>Adicionar</button>
        </div>
      </Modal>}
    </div>
  );
}

function ToolsPage() {
  const [sim, setSim] = useState("portfolio");
  const sims = [
    { id:"portfolio", label:"📊 Carteira de Investimentos" },
    { id:"cashflow",  label:"💰 Fluxo de Caixa"           },
    { id:"projetos",  label:"🗂 Portfólio Profissional"    },
  ];
  return (
    <div>
      <div style={{display:"flex",gap:6,marginBottom:24,flexWrap:"wrap"}}>
        {sims.map(s=>(
          <button key={s.id} onClick={()=>setSim(s.id)} style={{background:sim===s.id?"var(--accent)":"var(--bg-card)",border:`1px solid ${sim===s.id?"var(--accent)":"var(--border)"}`,borderRadius:24,padding:"9px 20px",color:sim===s.id?"#fff":"var(--text-2)",fontSize:13,fontWeight:700,cursor:"pointer"}}>
            {s.label}
          </button>
        ))}
      </div>
      {sim==="portfolio" && <PortfolioSimulator/>}
      {sim==="cashflow"  && <CashFlowSimulator/>}
      {sim==="projetos"  && <ProfessionalPortfolioSim/>}
    </div>
  );
}

// ─── BEDROCK PAGE ─────────────────────────────────────────────────────────────
function BedrockPage() {
  const [info, setInfo, _brSync] = useKV("bedrock_info_v1", { name:"BEDROCK", desc:"", mission:"", vision:"", site:"", status:"Ativo" });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [notes, setNotes] = useState(() => S.get("bedrock_notes", []));
  const [noteText, setNoteText] = useState("");

  const saveInfo = () => { S.set("bedrock_info", draft); setInfo(draft); setEditing(false); };
  const addNote  = () => {
    if(!noteText.trim()) return;
    const n = [...notes, { id:Date.now(), text:noteText, date:now() }];
    setNotes(n); S.set("bedrock_notes", n); setNoteText("");
  };
  const delNote = id => { const n=notes.filter(n=>n.id!==id); setNotes(n); S.set("bedrock_notes",n); };

  return (
    <div style={{maxWidth:900,margin:"0 auto"}}>
      {/* Header */}
      <div style={{background:"linear-gradient(135deg,#0a1628,#1a3d5c)",border:"1px solid var(--border)",borderRadius:20,padding:28,marginBottom:20,position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:-20,right:-20,fontSize:120,opacity:0.05}}>🪨</div>
        <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:16}}>
          <div style={{width:56,height:56,borderRadius:14,background:"linear-gradient(135deg,#1a78c2,#0a4a8c)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,boxShadow:"0 4px 20px rgba(26,120,194,0.4)"}}>🪨</div>
          <div>
            <div style={{fontSize:26,fontWeight:900,letterSpacing:2,color:"#fff"}}>{info.name||"BEDROCK"}</div>
            <div style={{fontSize:12,color:"rgba(255,255,255,0.5)",letterSpacing:3}}>PROJETO · {info.status||"ATIVO"}</div>
          </div>
          <button onClick={()=>{ setDraft({...info}); setEditing(true); }} style={{marginLeft:"auto",background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:10,padding:"8px 16px",color:"rgba(255,255,255,0.8)",fontSize:12,cursor:"pointer"}}>✏️ Editar</button>
        </div>
        {info.desc&&<p style={{color:"rgba(255,255,255,0.7)",lineHeight:1.7,fontSize:14,marginBottom:12}}>{info.desc}</p>}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          {info.mission&&<div><div style={{fontSize:10,color:"rgba(255,255,255,0.4)",letterSpacing:2,marginBottom:4}}>MISSÃO</div><p style={{color:"rgba(255,255,255,0.8)",fontSize:13,lineHeight:1.6}}>{info.mission}</p></div>}
          {info.vision&&<div><div style={{fontSize:10,color:"rgba(255,255,255,0.4)",letterSpacing:2,marginBottom:4}}>VISÃO</div><p style={{color:"rgba(255,255,255,0.8)",fontSize:13,lineHeight:1.6}}>{info.vision}</p></div>}
        </div>
        {info.site&&<a href={info.site} target="_blank" rel="noreferrer" style={{display:"inline-flex",alignItems:"center",gap:6,marginTop:12,color:"rgba(100,180,255,0.8)",fontSize:12,textDecoration:"none"}}>🔗 {info.site}</a>}
      </div>

      {/* Notes */}
      <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:14,padding:20}}>
        <div style={{fontSize:11,color:"var(--accent)",letterSpacing:2,fontWeight:800,marginBottom:16}}>📋 NOTAS DO PROJETO</div>
        <div style={{display:"flex",gap:10,marginBottom:16}}>
          <textarea style={{...inp,flex:1,resize:"none"}} rows={2} placeholder="Adicionar nota, ideia ou atualização..." value={noteText} onChange={e=>setNoteText(e.target.value)}/>
          <button onClick={addNote} style={{...btn("var(--green)"),alignSelf:"flex-end",padding:"10px 16px"}}>+</button>
        </div>
        <div style={{columns:"280px",columnGap:12}}>
          {notes.map(n=>(
            <div key={n.id} style={{breakInside:"avoid",background:"var(--bg-input)",borderRadius:10,padding:"10px 14px",marginBottom:10}}>
              <p style={{margin:0,color:"var(--text-1)",fontSize:13,lineHeight:1.6,whiteSpace:"pre-wrap"}}>{n.text}</p>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:6}}>
                <span style={{fontSize:10,color:"var(--text-3)"}}>{n.date}</span>
                <button onClick={()=>delNote(n.id)} style={{background:"none",border:"none",color:"var(--text-3)",cursor:"pointer"}}><Icon path={I.trash} size={12}/></button>
              </div>
            </div>
          ))}
          {notes.length===0&&<div style={{color:"var(--text-3)",fontSize:13,textAlign:"center",padding:"20px 0"}}>Nenhuma nota ainda</div>}
        </div>
      </div>

      {editing&&<Modal title="Editar BEDROCK" onClose={()=>setEditing(false)} wide>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <input style={inp} placeholder="Nome" value={draft.name||""} onChange={e=>setDraft({...draft,name:e.target.value})}/>
          <select style={inp} value={draft.status||"Ativo"} onChange={e=>setDraft({...draft,status:e.target.value})}>
            {["Ativo","Em desenvolvimento","Pausado","Lançado"].map(s=><option key={s}>{s}</option>)}
          </select>
          <textarea style={{...inp,resize:"vertical"}} rows={3} placeholder="Descrição do projeto" value={draft.desc||""} onChange={e=>setDraft({...draft,desc:e.target.value})}/>
          <textarea style={{...inp,resize:"vertical"}} rows={2} placeholder="Missão" value={draft.mission||""} onChange={e=>setDraft({...draft,mission:e.target.value})}/>
          <textarea style={{...inp,resize:"vertical"}} rows={2} placeholder="Visão" value={draft.vision||""} onChange={e=>setDraft({...draft,vision:e.target.value})}/>
          <input style={inp} placeholder="Site / URL" value={draft.site||""} onChange={e=>setDraft({...draft,site:e.target.value})}/>
          <button onClick={saveInfo} style={btn()}>Salvar</button>
        </div>
      </Modal>}
    </div>
  );
}

// ─── PROFESSIONAL PAGE ────────────────────────────────────────────────────────
function MenuTile({ color, emoji, label, sub, wide, tall, onClick }) {
  return (
    <div className={`tile${wide?" wide":""}${tall?" tall":""}`}
      style={{background:color}} onClick={onClick}>
      <span className="tile-icon">{emoji}</span>
      <div>
        <div className="tile-label">{label}</div>
        {sub&&<div className="tile-sub">{sub}</div>}
      </div>
    </div>
  );
}

function WeatherTile({ onClick }) {
  const w = useWeather();
  return (
    <div className="tile" style={{background:"var(--tile-weather)"}} onClick={onClick}>
      <span className="tile-live">CLIMA</span>
      <span className="tile-icon">{w?.desc?.split(" ")[0]||"🌡"}</span>
      <div>
        {w&&!w.error
          ? <><div className="tile-label" style={{fontSize:28,fontFamily:"'DM Mono',monospace"}}>{w.temp}{w.unit}</div><div className="tile-sub">{w.city||"..."}</div></>
          : <div className="tile-label">Clima</div>}
      </div>
    </div>
  );
}

function HomePage({ onNavigate }) {
  return (
    <div className="tiles-grid">
      <MenuTile color="var(--tile-diary)"  emoji="📓" label="Diário"       sub="Registros, ideias, lembretes" wide onClick={()=>onNavigate("diary")}/>
      <MenuTile color="var(--tile-tasks)"  emoji="✅" label="Tarefas"      sub="Cards editáveis"              onClick={()=>onNavigate("tasks")}/>
      <MenuTile color="var(--tile-docs)"   emoji="📁" label="Documentos"   sub="Arquivos e anexos"            onClick={()=>onNavigate("docs")}/>
      <MenuTile color="var(--tile-bills)"  emoji="💳" label="Contas"       sub="Vencimentos e pagamentos"     onClick={()=>onNavigate("bills")}/>
      <MenuTile color="var(--tile-events)" emoji="📅" label="Compromissos" sub="Agenda e eventos"             onClick={()=>onNavigate("events")}/>
      <MenuTile color="var(--tile-lists)"  emoji="📋" label="Listas"       sub="Checklists e anotações"       onClick={()=>onNavigate("lists")}/>
      <WeatherTile onClick={()=>onNavigate("weather")}/>
      <MenuTile color="var(--tile-market)" emoji="📈" label="Mercado & Indicadores" sub="Bolsas, câmbio, cripto, notícias" wide onClick={()=>onNavigate("market")}/>
      <MenuTile color="var(--tile-white)"  emoji="🖊️" label="Whiteboard"   sub="Lousa digital"               onClick={()=>onNavigate("whiteboard")}/>
      <MenuTile color="#1a3a2a"             emoji="💻" label=".BAT / Scripts" sub="Automações e comandos"       onClick={()=>onNavigate("bat")}/>
      <MenuTile color="#1a0a2a"             emoji="📺" label="Letreiro"     sub="Mensagem em tela cheia" onClick={()=>onNavigate("letreiro")}/>
    </div>
  );
}


// ─── LETREIRO PAGE ────────────────────────────────────────────────────────────
function LetreirPage() {
  const PRESETS = [
    { label:'Branco',   value:'#ffffff' },
    { label:'Amarelo',  value:'#ffe030' },
    { label:'Ciano',    value:'#00e5ff' },
    { label:'Verde',    value:'#00ff88' },
    { label:'Rosa',     value:'#ff2d78' },
    { label:'Laranja',  value:'#ff8c00' },
    { label:'Roxo',     value:'#c084fc' },
    { label:'Vermelho', value:'#ff4444' },
  ];
  const BG_PRESETS = [
    { label:'Preto',    value:'#000000' },
    { label:'Azul esc', value:'#0d1b2e' },
    { label:'Roxo esc', value:'#1a0a2e' },
    { label:'Verde esc',value:'#0a1e0f' },
    { label:'Vermelho', value:'#1e0505' },
    { label:'Cinza',    value:'#1a1a1a' },
  ];

  const [kvConfig, setKvConfig, kvSynced] = useKV('letreiro_v1', {});

  const [text,     setText]     = useState(kvConfig.text     || 'Bem-vindo ao Painel!');
  const [color,    setColor]    = useState(kvConfig.color    || '#ffe030');
  const [bgColor,  setBgColor]  = useState(kvConfig.bgColor  || '#000000');
  const [fontSize, setFontSize] = useState(kvConfig.fontSize || 96);
  const [speed,    setSpeed]    = useState(kvConfig.speed    || 60);
  const [bold,     setBold]     = useState(kvConfig.bold     ?? true);
  const [italic,   setItalic]   = useState(kvConfig.italic   || false);

  // When cloud config arrives, sync local state
  useEffect(() => {
    if (!kvSynced || !kvConfig || Object.keys(kvConfig).length === 0) return;
    if (kvConfig.text     !== undefined) setText(kvConfig.text);
    if (kvConfig.color    !== undefined) setColor(kvConfig.color);
    if (kvConfig.bgColor  !== undefined) setBgColor(kvConfig.bgColor);
    if (kvConfig.fontSize !== undefined) setFontSize(kvConfig.fontSize);
    if (kvConfig.speed    !== undefined) setSpeed(kvConfig.speed);
    if (kvConfig.bold     !== undefined) setBold(kvConfig.bold);
    if (kvConfig.italic   !== undefined) setItalic(kvConfig.italic);
  }, [kvSynced]);
  const [running,  setRunning]  = useState(false);
  const [draft,    setDraft]    = useState(kvConfig.text  || 'Bem-vindo ao Painel!');

  // fullscreen marquee state
  const [fullscreen, setFullscreen] = useState(false);
  const posRef      = useRef(null);   // pixel position (starts offscreen right)
  const animRef     = useRef(null);
  const spanRef     = useRef(null);
  const lastTimeRef = useRef(null);
  const [pos, setPos] = useState(0);  // left px

  const save = (patch) => {
    const next = { text, color, bgColor, fontSize, speed, bold, italic, ...patch };
    setKvConfig(next);  // syncs to cloud + localStorage via useKV
  };

  const startMarquee = () => {
    save({ text: draft });
    setText(draft);
    setRunning(true);
    setFullscreen(true);
  };

  const stopMarquee = () => {
    setRunning(false);
    setFullscreen(false);
    cancelAnimationFrame(animRef.current);
    lastTimeRef.current = null;
  };

  // Animation loop — runs whenever fullscreen + running
  useEffect(() => {
    if (!fullscreen || !running) return;

    // Init position: start from the right edge of screen
    const screenW = window.innerWidth;
    posRef.current = screenW;
    setPos(screenW);
    lastTimeRef.current = null;

    const tick = (ts) => {
      if (lastTimeRef.current === null) lastTimeRef.current = ts;
      const dt = (ts - lastTimeRef.current) / 1000; // seconds
      lastTimeRef.current = ts;

      const spanW = spanRef.current ? spanRef.current.offsetWidth : 800;
      posRef.current -= speed * dt;

      // Reset when fully off left edge
      if (posRef.current < -spanW - 40) {
        posRef.current = window.innerWidth + 40;
      }

      setPos(posRef.current);
      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [fullscreen, running, speed]);

  // ESC to exit fullscreen
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') stopMarquee(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── FULLSCREEN OVERLAY ──
  if (fullscreen) {
    return (
      <div
        onClick={stopMarquee}
        style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: bgColor,
          display: 'flex', alignItems: 'center',
          overflow: 'hidden', cursor: 'pointer',
          userSelect: 'none',
        }}
        title="Clique ou ESC para fechar"
      >
        <span
          ref={spanRef}
          style={{
            position: 'absolute',
            left: pos,
            whiteSpace: 'nowrap',
            fontSize: fontSize,
            fontWeight: bold ? 800 : 400,
            fontStyle: italic ? 'italic' : 'normal',
            color: color,
            fontFamily: "'DM Sans', sans-serif",
            textShadow: `0 0 40px ${color}88, 0 0 80px ${color}44`,
            lineHeight: 1.1,
            letterSpacing: '0.02em',
          }}
        >
          {text}
        </span>
        {/* Close hint */}
        <div style={{
          position: 'absolute', top: 16, right: 20,
          color: 'rgba(255,255,255,0.25)', fontSize: 11,
          fontFamily: 'monospace', letterSpacing: 2,
          pointerEvents: 'none',
        }}>
          ESC ou clique para sair
        </div>
      </div>
    );
  }

  // ── CONFIGURAÇÃO ──
  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      {/* Preview mini */}
      <div style={{
        background: bgColor,
        borderRadius: 14, marginBottom: 24, overflow: 'hidden',
        height: 120, display: 'flex', alignItems: 'center',
        border: '1px solid var(--border)',
        position: 'relative',
      }}>
        <div style={{
          animation: 'marqueePreview 8s linear infinite',
          whiteSpace: 'nowrap',
          fontSize: Math.min(fontSize, 52),
          fontWeight: bold ? 800 : 400,
          fontStyle: italic ? 'italic' : 'normal',
          color: color,
          fontFamily: "'DM Sans', sans-serif",
          textShadow: `0 0 20px ${color}66`,
          paddingLeft: '100%',
        }}>
          {draft || 'Digite seu texto…'}
        </div>
        <style>{`
          @keyframes marqueePreview {
            0%   { transform: translateX(0); }
            100% { transform: translateX(-100%); }
          }
        `}</style>
      </div>

      {/* Text input */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: 20, marginBottom: 16 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: 2, display: 'block', marginBottom: 8 }}>TEXTO DO LETREIRO</label>
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          rows={2}
          placeholder="Digite a mensagem aqui..."
          style={{ ...inp, resize: 'vertical', fontSize: 16, fontWeight: 700 }}
        />
      </div>

      {/* Controls grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>

        {/* Cor do texto */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: 2, display: 'block', marginBottom: 10 }}>COR DO TEXTO</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            {PRESETS.map(p => (
              <div key={p.value}
                onClick={() => { setColor(p.value); save({ color: p.value }); }}
                style={{
                  width: 28, height: 28, borderRadius: '50%', background: p.value,
                  border: color === p.value ? '3px solid var(--accent)' : '2px solid var(--border)',
                  cursor: 'pointer', transition: 'transform .12s',
                  transform: color === p.value ? 'scale(1.2)' : 'scale(1)',
                }}
                title={p.label}
              />
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="color" value={color} onChange={e => { setColor(e.target.value); save({ color: e.target.value }); }}
              style={{ width: 36, height: 36, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}/>
            <span style={{ fontSize: 12, color: 'var(--text-2)', fontFamily: 'monospace' }}>{color}</span>
          </div>
        </div>

        {/* Cor de fundo */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: 2, display: 'block', marginBottom: 10 }}>COR DE FUNDO</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            {BG_PRESETS.map(p => (
              <div key={p.value}
                onClick={() => { setBgColor(p.value); save({ bgColor: p.value }); }}
                style={{
                  width: 28, height: 28, borderRadius: '50%', background: p.value,
                  border: bgColor === p.value ? '3px solid var(--accent)' : '2px solid var(--border)',
                  cursor: 'pointer', transition: 'transform .12s',
                  transform: bgColor === p.value ? 'scale(1.2)' : 'scale(1)',
                }}
                title={p.label}
              />
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="color" value={bgColor} onChange={e => { setBgColor(e.target.value); save({ bgColor: e.target.value }); }}
              style={{ width: 36, height: 36, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}/>
            <span style={{ fontSize: 12, color: 'var(--text-2)', fontFamily: 'monospace' }}>{bgColor}</span>
          </div>
        </div>

        {/* Tamanho da fonte */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: 2, display: 'block', marginBottom: 10 }}>TAMANHO — {fontSize}px</label>
          <input type="range" min={32} max={240} value={fontSize}
            onChange={e => { setFontSize(Number(e.target.value)); save({ fontSize: Number(e.target.value) }); }}
            style={{ width: '100%', accentColor: 'var(--accent)' }}/>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            {[32, 72, 120, 180, 240].map(s => (
              <button key={s} onClick={() => { setFontSize(s); save({ fontSize: s }); }}
                style={{ ...btn(fontSize===s?'var(--accent)':'var(--bg-input)'), padding: '4px 8px', fontSize: 11, borderRadius: 8, color: fontSize===s?'#fff':'var(--text-2)', border: `1px solid ${fontSize===s?'var(--accent)':'var(--border)'}` }}>
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Velocidade */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: 2, display: 'block', marginBottom: 10 }}>VELOCIDADE — {speed}px/s</label>
          <input type="range" min={10} max={400} value={speed}
            onChange={e => { setSpeed(Number(e.target.value)); save({ speed: Number(e.target.value) }); }}
            style={{ width: '100%', accentColor: 'var(--accent)' }}/>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            {[{ l:'Lenta', v:30 },{ l:'Normal', v:80 },{ l:'Rápida', v:160 },{ l:'Turbo', v:320 }].map(o => (
              <button key={o.v} onClick={() => { setSpeed(o.v); save({ speed: o.v }); }}
                style={{ ...btn(speed===o.v?'var(--accent)':'var(--bg-input)'), padding: '4px 8px', fontSize: 11, borderRadius: 8, color: speed===o.v?'#fff':'var(--text-2)', border: `1px solid ${speed===o.v?'var(--accent)':'var(--border)'}` }}>
                {o.l}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Style toggles */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, marginBottom: 20, display: 'flex', gap: 12 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: 2, alignSelf: 'center', marginRight: 4 }}>ESTILO</label>
        {[
          { lbl: 'Negrito', val: bold, set: v => { setBold(v); save({ bold: v }); }, icon: 'B' },
          { lbl: 'Itálico', val: italic, set: v => { setItalic(v); save({ italic: v }); }, icon: 'I' },
        ].map(o => (
          <button key={o.lbl} onClick={() => o.set(!o.val)}
            style={{
              background: o.val ? 'var(--accent)' : 'var(--bg-input)',
              border: `1px solid ${o.val ? 'var(--accent)' : 'var(--border)'}`,
              color: o.val ? '#fff' : 'var(--text-2)',
              borderRadius: 10, padding: '8px 18px', fontSize: 14,
              fontWeight: o.lbl==='Negrito' ? 800 : 400,
              fontStyle: o.lbl==='Itálico' ? 'italic' : 'normal',
              cursor: 'pointer', transition: 'all .15s',
            }}>
            {o.icon} {o.lbl}
          </button>
        ))}
      </div>

      {/* Launch button */}
      <button onClick={startMarquee} style={{
        ...btn('var(--accent)'),
        width: '100%', fontSize: 16, fontWeight: 800,
        padding: '16px', borderRadius: 14, letterSpacing: 2,
        boxShadow: '0 4px 24px rgba(40,120,200,0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
      }}>
        <span style={{ fontSize: 22 }}>📺</span> EXIBIR LETREIRO EM TELA CHEIA
      </button>
      <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-3)', marginTop: 10 }}>
        Clique na tela ou pressione ESC para fechar
      </div>
    </div>
  );
}

// ─── PAGE TITLES ─────────────────────────────────────────────────────────────
const PAGE_META = {
  home:       {label:"Menu",                emoji:"🏠"},
  diary:      {label:"Diário",              emoji:"📓"},
  tasks:      {label:"Tarefas",             emoji:"✅"},
  docs:       {label:"Documentos",          emoji:"📁"},
  bills:      {label:"Contas",              emoji:"💳"},
  events:     {label:"Compromissos",        emoji:"📅"},
  lists:      {label:"Listas",              emoji:"📋"},
  weather:    {label:"Clima",               emoji:"🌤"},
  market:     {label:"Mercado & Indicadores",emoji:"📈"},
  whiteboard: {label:"Whiteboard",          emoji:"🖊️"},
  bat:          {label:".BAT / Scripts",     emoji:"💻"},
  letreiro:     {label:"Letreiro",             emoji:"📺"},
};

// ─── BAT PAGE ─────────────────────────────────────────────────────────────────
function BatPage() {
  const [scripts, setScripts] = useState(()=>S.get("bat_scripts",[
    {id:1, name:"Olá Mundo", code:"@echo off\necho Olá Mundo!\npause", desc:"Script de exemplo"},
    {id:2, name:"Info do Sistema", code:"@echo off\nsysteminfo\npause", desc:"Exibe informações do sistema"},
  ]));
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({name:"",code:"",desc:""});
  const [modal, setModal] = useState(false);

  const save = n=>{ setScripts(n); S.set("bat_scripts",n); };
  const add  = ()=>{
    if(!form.name.trim()) return;
    const s={id:Date.now(),...form};
    save([...scripts,s]); setModal(false); setForm({name:"",code:"",desc:""});
  };
  const del  = id=>save(scripts.filter(s=>Number(s.id)!==Number(id)));
  const download = s=>{
    const blob=new Blob([s.code.replace(/\\n/g,"\n")],{type:"text/plain"});
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=s.name+".bat"; a.click();
  };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div style={{fontSize:13,color:"var(--text-3)"}}>Scripts .BAT para Windows — edite, salve e baixe</div>
        <button onClick={()=>setModal(true)} style={{...btn(),display:"flex",alignItems:"center",gap:6}}><Icon path={I.plus} size={14}/> Novo Script</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:14}}>
        {scripts.map(s=>(
          <div key={s.id} style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:14,overflow:"hidden"}}>
            <div style={{padding:"12px 16px",borderBottom:"1px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontWeight:700,fontSize:14}}>💻 {s.name}</div>
                {s.desc&&<div style={{fontSize:11,color:"var(--text-3)",marginTop:2}}>{s.desc}</div>}
              </div>
              <div style={{display:"flex",gap:6}}>
                <button onClick={()=>setEditing(s)} style={{background:"var(--accent-dim)",border:"1px solid var(--accent-bdr)",borderRadius:8,padding:"5px 10px",color:"var(--accent)",fontSize:11,cursor:"pointer"}}>✏️ Editar</button>
                <button onClick={()=>download(s)} style={{background:"rgba(46,204,138,0.1)",border:"1px solid rgba(46,204,138,0.3)",borderRadius:8,padding:"5px 10px",color:"var(--green)",fontSize:11,cursor:"pointer"}}>⬇ .bat</button>
                <button onClick={()=>del(s.id)} style={{background:"none",border:"none",color:"var(--text-3)",cursor:"pointer"}}><Icon path={I.trash} size={14}/></button>
              </div>
            </div>
            <pre style={{padding:"12px 16px",fontSize:12,color:"var(--text-2)",overflowX:"auto",fontFamily:"'DM Mono',monospace",lineHeight:1.6,maxHeight:160,overflowY:"auto",background:"var(--bg-input)",margin:0}}>{s.code}</pre>
          </div>
        ))}
      </div>

      {modal&&<Modal title="Novo Script .BAT" onClose={()=>setModal(false)} wide>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <input style={inp} placeholder="Nome do script" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/>
          <input style={inp} placeholder="Descrição (opcional)" value={form.desc} onChange={e=>setForm({...form,desc:e.target.value})}/>
          <textarea style={{...inp,fontFamily:"'DM Mono',monospace",fontSize:13,resize:"vertical"}} rows={10} placeholder={"@echo off\necho Seu script aqui\npause"} value={form.code} onChange={e=>setForm({...form,code:e.target.value})}/>
          <button onClick={add} style={btn()}>Salvar Script</button>
        </div>
      </Modal>}

      {editing&&<Modal title={`Editar: ${editing.name}`} onClose={()=>setEditing(null)} wide>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <input style={inp} value={editing.name} onChange={e=>setEditing({...editing,name:e.target.value})}/>
          <input style={inp} value={editing.desc} onChange={e=>setEditing({...editing,desc:e.target.value})}/>
          <textarea style={{...inp,fontFamily:"'DM Mono',monospace",fontSize:13,resize:"vertical"}} rows={12} value={editing.code} onChange={e=>setEditing({...editing,code:e.target.value})}/>
          <button onClick={()=>{ save(scripts.map(s=>s.id===editing.id?editing:s)); setEditing(null); }} style={btn()}>Salvar alterações</button>
        </div>
      </Modal>}
    </div>
  );
}


// ─── DJ STUDIO PAGE ──────────────────────────────────────────────────────────
import { useState, useEffect, useRef, useCallback } from "react";

// ─── ICONS ───────────────────────────────────────────────────────────────────
const Icon = ({ path, size = 18, color = "currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={path} />
  </svg>
);
const I = {
  x:       "M18 6 6 18 M6 6l12 12",
  trash:   "M3 6h18 M19 6l-1 14H6L5 6 M8 6V4h8v2",
  check:   "M20 6 9 17l-5-5",
  plus:    "M12 5v14 M5 12h14",
  edit:    "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z",
  bell:    "M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 0 1-3.46 0",
  back:    "M19 12H5 M12 19l-7-7 7-7",
  refresh: "M23 4v6h-6 M1 20v-6h6 M3.51 9a9 9 0 0 1 14.85-3.36L23 10 M1 14l4.64 4.36A9 9 0 0 0 20.49 15",
  monitor: "M8 21h8 M12 17v4 M2 3h20v14H2z",
  link:    "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  folder:  "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z",
  down:    "M6 9l6 6 6-6",
  up:      "M18 15l-6-6-6 6",
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const now     = () => new Date().toLocaleString("pt-BR");
const nowISO  = () => new Date().toISOString();
const fmtMoney= (v) => Number(v).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const fmtNum  = (v, dec=2) => Number(v).toLocaleString("pt-BR",{minimumFractionDigits:dec,maximumFractionDigits:dec});
const fmtPct  = (v) => v!=null&&!isNaN(v) ? `${Number(v)>=0?"+":""}${Number(v).toFixed(2)}%` : "--";
const fmt$    = (v,pre="",dec=2) => v!=null&&!isNaN(v) ? `${pre}${fmtNum(v,dec)}` : "--";

// ─── STORAGE ─────────────────────────────────────────────────────────────────
const S = {
  get:(k,d)=>{ try{ const v=localStorage.getItem(k); return v?JSON.parse(v):d; }catch{return d;} },
  set:(k,v)=>{ try{ localStorage.setItem(k,JSON.stringify(v)); }catch{} },
};

// ─── DB SYNC ─────────────────────────────────────────────────────────────────
const DB = {
  list:  async (t)=>{ try{ const r=await fetch(`/api/db?table=${t}`); return await r.json(); }catch{return null;} },
  insert:async (t,row)=>{ try{ await fetch(`/api/db?table=${t}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(row)}); }catch{} },
  update:async (t,row)=>{ try{ await fetch(`/api/db?table=${t}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(row)}); }catch{} },
  delete:async (t,id)=>{
    const r=await fetch(`/api/db?table=${t}&id=${id}`,{method:"DELETE"});
    if(!r.ok) throw new Error(`Delete failed ${r.status}`);
  },
};

// ── Generic key/value cloud sync (whiteboard, dayboard, letreiro, dj banks) ──
const KV = {
  get: async (key) => {
    try {
      const r = await fetch(`/api/db?table=sync_kv&key=${encodeURIComponent(key)}`);
      const v = await r.json();
      return v ? JSON.parse(v) : null;
    } catch { return null; }
  },
  set: async (key, value) => {
    try {
      await fetch(`/api/db?table=sync_kv`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: JSON.stringify(value) }),
      });
    } catch {}
  },
  del: async (key) => {
    try { await fetch(`/api/db?table=sync_kv&key=${encodeURIComponent(key)}`, { method: "DELETE" }); } catch {}
  },
};

// useKV — like useState but synced to cloud + localStorage, with polling
function useKV(key, def) {
  const [data, setData] = useState(() => {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch { return def; }
  });
  const [synced, setSynced] = useState(false);
  const dataRef = useRef(data);
  dataRef.current = data;
  const savingRef = useRef(false); // true briefly after a local save, to avoid self-clobber

  const pull = () => {
    KV.get(key).then(cloud => {
      if (cloud !== null && !savingRef.current) {
        // Only update if actually different (avoid needless re-renders)
        const cloudStr = JSON.stringify(cloud);
        const localStr = JSON.stringify(dataRef.current);
        if (cloudStr !== localStr) {
          setData(cloud);
          try { localStorage.setItem(key, cloudStr); } catch {}
        }
      }
      setSynced(true);
    });
  };

  // On mount: pull from cloud
  useEffect(() => { pull(); }, [key]);

  // Poll every 5s so other devices' changes appear without reload
  useEffect(() => {
    const id = setInterval(pull, 5000);
    return () => clearInterval(id);
  }, [key]);

  // Also re-sync when tab/app regains focus (covers app switching on mobile)
  useEffect(() => {
    const onFocus = () => pull();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', () => { if(!document.hidden) pull(); });
    return () => window.removeEventListener('focus', onFocus);
  }, [key]);

  const save = (next) => {
    const value = typeof next === 'function' ? next(dataRef.current) : next;
    setData(value);
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
    savingRef.current = true;
    KV.set(key, value).finally(() => {
      setTimeout(() => { savingRef.current = false; }, 1000);
    });
    return value;
  };

  return [data, save, synced];
}

function useDB(table, localKey, def=[]) {
  // localStorage é apenas cache de exibição rápida — banco é a única fonte da verdade
  const [data, setData] = useState(()=>{ try{ const v=localStorage.getItem(localKey); return v?JSON.parse(v):def; }catch{return def;} });
  const [synced, setSynced] = useState(false);
  const dataRef    = useRef(data);
  dataRef.current  = data;
  const writingRef = useRef(false); // bloqueia poll enquanto operação local está em andamento
  const timerRef   = useRef(null);

  const lock = () => {
    writingRef.current = true;
    clearTimeout(timerRef.current);
    // desbloqueia após tempo suficiente para o banco confirmar (6s é seguro)
    timerRef.current = setTimeout(() => { writingRef.current = false; }, 6000);
  };

  const applyRows = (rows) => {
    // Normaliza id para Number — banco pode retornar string, local usa Number
    const normalized = rows.map(r => ({...r, id: Number(r.id)}));
    const sorted = [...normalized].sort((a,b)=>b.id-a.id);
    setData(sorted);
    try { localStorage.setItem(localKey, JSON.stringify(sorted)); } catch {}
    setSynced(true);
  };

  const pull = async () => {
    if (writingRef.current) return; // operação local em andamento — não sobrescrever
    const rows = await DB.list(table);
    if (writingRef.current) return; // re-checagem pós-await
    if (!rows || !Array.isArray(rows)) return;
    applyRows(rows);
  };

  // Mount: carrega do banco (sem re-inserir nada do localStorage)
  useEffect(() => {
    DB.list(table).then(rows => {
      if (rows && Array.isArray(rows)) applyRows(rows);
      else setSynced(true);
    });
  }, [table]);

  // Pull ref garante que o setInterval sempre chama a versão atual de pull
  const pullRef = useRef(pull);
  pullRef.current = pull;

  // Poll a cada 5s
  useEffect(() => {
    const id = setInterval(() => pullRef.current(), 5000);
    return () => clearInterval(id);
  }, [table]);

  // Re-sync ao focar/retornar ao app
  useEffect(() => {
    const onVisible = () => { if (!document.hidden && !writingRef.current) pull(); };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.removeEventListener('focus', onVisible); document.removeEventListener('visibilitychange', onVisible); };
  }, [table]);

  // setData que bloqueia o poll temporariamente — usado por toda operação de escrita/delete
  const setDataSafe = (next) => {
    lock();
    const value = typeof next === 'function' ? next(dataRef.current) : next;
    setData(value);
    try { localStorage.setItem(localKey, JSON.stringify(value)); } catch {}
  };

  return [data, setDataSafe, synced];
}

// ─── SHARED UI ───────────────────────────────────────────────────────────────
const inp = { width:"100%",background:"var(--bg-input)",border:"1px solid var(--border)",borderRadius:10,padding:"10px 14px",color:"var(--text-1)",fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"inherit" };
const btn = (c="var(--accent)") => ({ background:c,border:"none",borderRadius:10,padding:"10px 20px",color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer",fontFamily:"inherit" });

function Modal({ title, onClose, children, wide }) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",backdropFilter:"blur(8px)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:20,width:"100%",maxWidth:wide?760:520,maxHeight:"85vh",overflow:"auto",animation:"fadeIn .2s ease"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"20px 24px",borderBottom:"1px solid var(--border)"}}>
          <span style={{fontWeight:700,fontSize:16}}>{title}</span>
          <button onClick={onClose} style={{background:"none",border:"none",color:"var(--text-3)",cursor:"pointer"}}><Icon path={I.x} size={20}/></button>
        </div>
        <div style={{padding:24}}>{children}</div>
      </div>
    </div>
  );
}

const Empty = ({text})=><div style={{textAlign:"center",color:"var(--text-3)",padding:"40px 0",fontSize:14}}>{text}</div>;
const LiveBadge = ({label="LIVE"})=>(
  <div style={{display:"flex",gap:6,alignItems:"center",color:"var(--green)",fontSize:12,fontWeight:600}}>
    <span style={{width:6,height:6,borderRadius:"50%",background:"var(--green)",display:"inline-block",animation:"pulse 2s infinite"}}/>
    {label}
  </div>
);

// ─── MARKET DATA ─────────────────────────────────────────────────────────────
function useMarketData() {
  const [data, setData] = useState({
    dolar:{val:"--",chg:"--"}, ibov:{val:"--",chg:"--"},
    sp500:{val:"--",chg:"--"}, ouro:{val:"--",chg:"--"},
    btc:  {val:"--",chg:"--"}, euro:{val:"--",chg:"--"},
  });
  const [loading, setLoading] = useState(true);

  const fetch_ = async () => {
    try {
      const r = await fetch("/api/market");
      const d = await r.json();
      setData({
        dolar:{val:fmt$(d.dolar?.price,"R$ "),  chg:fmtPct(d.dolar?.chg)},
        ibov: {val:fmt$(d.ibov?.price,"",0),    chg:fmtPct(d.ibov?.chg)},
        sp500:{val:fmt$(d.sp500?.price,"",0),   chg:fmtPct(d.sp500?.chg)},
        ouro: {val:fmt$(d.ouro?.price,"R$ ",0), chg:fmtPct(d.ouro?.chg)},
        btc:  {val:fmt$(d.btc?.price,"$ ",0),   chg:fmtPct(d.btc?.chg)},
        euro: {val:fmt$(d.euro?.price,"R$ "),   chg:fmtPct(d.euro?.chg)},
      });
      setLoading(false);
    } catch {}
  };

  useEffect(()=>{ fetch_(); const id=setInterval(fetch_,90000); return()=>clearInterval(id); },[]);
  return {data,loading,refresh:fetch_};
}

// ─── WEATHER ─────────────────────────────────────────────────────────────────
function useWeather() {
  const [weather, setWeather] = useState(null);
  useEffect(()=>{
    if(!navigator.geolocation){ setWeather({error:"GPS indisponível"}); return; }
    navigator.geolocation.getCurrentPosition(async pos=>{
      try {
        const {latitude:lat,longitude:lon} = pos.coords;
        const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto`);
        const d = await r.json();
        const c = d.current;
        const codes = {0:"☀️ Céu limpo",1:"🌤 Quase limpo",2:"⛅ Parcialmente nublado",3:"☁️ Nublado",45:"🌫 Névoa",48:"🌫 Névoa com gelo",51:"🌦 Chuvisco leve",61:"🌧 Chuva leve",63:"🌧 Chuva moderada",65:"🌧 Chuva forte",71:"❄️ Neve leve",80:"🌦 Aguaceiros",95:"⛈ Tempestade"};
        setWeather({ temp:c.temperature_2m, humidity:c.relative_humidity_2m, wind:c.wind_speed_10m, desc:codes[c.weather_code]||"🌡 Variável", unit:d.current_units?.temperature_2m||"°C" });
        // Reverse geocode
        const geo = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`);
        const gd  = await geo.json();
        setWeather(prev=>({...prev, city: gd.address?.city||gd.address?.town||gd.address?.county||"Sua localização"}));
      } catch { setWeather({error:"Erro ao buscar clima"}); }
    }, ()=>setWeather({error:"Permissão negada"}));
  },[]);
  return weather;
}

// ─── TICKER STRIP ────────────────────────────────────────────────────────────
function TickerStrip({ market }) {
  const { data, loading } = market;
  const items = [
    {l:"DÓLAR",   v:data.dolar.val, c:data.dolar.chg, color:"var(--green)" },
    {l:"IBOV",    v:data.ibov.val,  c:data.ibov.chg,  color:"var(--accent)"},
    {l:"S&P 500", v:data.sp500.val, c:data.sp500.chg, color:"var(--purple)"},
    {l:"OURO",    v:data.ouro.val,  c:data.ouro.chg,  color:"var(--yellow)"},
    {l:"BITCOIN", v:data.btc.val,   c:data.btc.chg,   color:"var(--orange)"},
    {l:"EURO",    v:data.euro.val,  c:data.euro.chg,  color:"var(--text-2)"},
  ];
  const isUp = c => c && !c.startsWith("-") && c!=="--";
  return (
    <div style={{display:"flex",gap:28,alignItems:"center",overflowX:"auto",paddingBottom:2}}>
      {items.map(i=>(
        <div key={i.l} style={{display:"flex",flexDirection:"column",flexShrink:0}}>
          <span style={{fontSize:9,color:"var(--text-3)",letterSpacing:1,fontWeight:700}}>{i.l}</span>
          <span style={{fontSize:13,fontWeight:700,color:loading?"var(--text-3)":i.color,fontFamily:"'DM Mono',monospace"}}>{loading?"···":i.v}</span>
          <span style={{fontSize:10,color:isUp(i.c)?"var(--green)":i.c==="--"?"var(--text-3)":"var(--red)"}}>
            {!loading&&i.c!=="--"?(isUp(i.c)?"▲":"▼")+" "+i.c:""}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── DIARY CARDS ─────────────────────────────────────────────────────────────
function NoteColumn({ storageKey, title, placeholder, accent, emoji, hasCheck }) {
  const [entries, setEntries, synced] = useKV(storageKey+"_v1",[]);
  const [text, setText] = useState("");
  const [mood, setMood] = useState("🙂");
  const moods = ["😄","🙂","😐","😔","😤","🤔","🎉"];
  const showMoods = storageKey === "diary";

  const add = () => {
    if(!text.trim()) return;
    const e = {id:Date.now(), text, mood, done:false, date:nowISO()};
    const n = [e, ...entries];
    setEntries(n); setText("");
  };
  const del  = id => { setEntries(p=>p.filter(e=>e.id!==id)); };
  const tick = id => {
    const cur = entries.find(e=>e.id===id);
    const n = entries.map(e=>e.id===id?{...e,done:!e.done}:e);
    setEntries(n);
  };

  // Group by day
  const grouped = entries.reduce((acc, e) => {
    const d = new Date(e.date).toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
    (acc[d] = acc[d] || []).push(e); return acc;
  }, {});

  return (
    <div>
      {/* Input box */}
      <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:14,padding:16,marginBottom:24}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          {showMoods && (
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {moods.map(m=><button key={m} onClick={()=>setMood(m)} style={{fontSize:20,background:mood===m?"var(--bg-input)":"none",border:mood===m?`1px solid ${accent}`:"1px solid transparent",borderRadius:8,padding:"3px 7px",cursor:"pointer"}}>{m}</button>)}
            </div>
          )}
          <span style={{fontSize:9,color:synced?"var(--green)":"var(--text-3)",marginLeft:"auto"}}>
            {synced?"☁ sync":"syncing..."}
          </span>
        </div>
        <textarea value={text} onChange={e=>setText(e.target.value)} placeholder={placeholder} rows={3}
          style={{...inp,resize:"vertical",marginBottom:10,fontSize:13}}
          onKeyDown={e=>{if(e.ctrlKey&&e.key==="Enter")add();}}/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:10,color:"var(--text-3)"}}>{entries.length} registro{entries.length!==1?"s":""}</span>
          <button onClick={add} style={{...btn(accent),padding:"8px 20px"}}>+ Salvar</button>
        </div>
      </div>

      {/* Cards grouped by day */}
      {Object.entries(grouped).map(([date, es]) => (
        <div key={date} style={{marginBottom:28}}>
          {/* Day header */}
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
            <div style={{height:1,flex:1,background:"var(--border-2)"}}/>
            <span style={{fontSize:10,color:accent,letterSpacing:2,fontWeight:800,whiteSpace:"nowrap"}}>{date.toUpperCase()}</span>
            <div style={{height:1,flex:1,background:"var(--border-2)"}}/>
          </div>
          {/* Cards row — masonry-like, no stretching */}
          <div style={{columns:"300px",columnGap:12}}>
            {es.map(e=>(
              <div key={e.id} style={{
                breakInside:"avoid",
                background:"var(--bg-card)",
                border:"1px solid var(--border)",
                borderRadius:12,
                padding:"12px 14px",
                marginBottom:12,
                display:"flex",
                gap:10,
                alignItems:"flex-start",
                opacity: e.done ? 0.55 : 1,
              }}>
                {hasCheck && (
                  <button onClick={()=>tick(e.id)} style={{width:20,height:20,borderRadius:5,border:`2px solid ${e.done?"var(--green)":"var(--border)"}`,background:e.done?"var(--green)":"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:2}}>
                    {e.done&&<Icon path={I.check} size={11} color="#fff"/>}
                  </button>
                )}
                {showMoods && <span style={{fontSize:20,flexShrink:0,lineHeight:1.4}}>{e.mood}</span>}
                <div style={{flex:1,minWidth:0}}>
                  <p style={{margin:0,color:"var(--text-1)",lineHeight:1.65,fontSize:13,whiteSpace:"pre-wrap",wordBreak:"break-word",textDecoration:e.done?"line-through":"none"}}>{e.text}</p>
                  <span style={{fontSize:10,color:"var(--text-3)",marginTop:5,display:"block"}}>
                    🕐 {new Date(e.date).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}
                  </span>
                </div>
                <button onClick={()=>del(e.id)} style={{background:"none",border:"none",color:"var(--text-3)",cursor:"pointer",flexShrink:0,marginTop:2}}>
                  <Icon path={I.trash} size={12}/>
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
      {entries.length===0&&<Empty text="Nenhum registro ainda"/>}
    </div>
  );
}


// ─── DAY BOARD (whiteboard de post-its por dia) ───────────────────────────────
const DB_BOARD_KEY = 'dayboard_v1';

// Cores dos post-its
const POST_COLORS = [
  '#FFE066','#FFB347','#FF6B6B','#C3E88D','#89DDFF','#C792EA','#F78C6C','#80CBC4',
];

// loadBoards / saveBoards — localStorage only (fast local access)
// Cloud sync is handled by useKV inside DayBoardPage
function loadBoards() {
  try { const r = localStorage.getItem(DB_BOARD_KEY); return r ? JSON.parse(r) : {}; } catch { return {}; }
}
function saveBoards(boards) {
  try { localStorage.setItem(DB_BOARD_KEY, JSON.stringify(boards)); } catch {}
}

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function fmtBoardDate(key) {
  const [y,m,d] = key.split('-');
  const dt = new Date(Number(y), Number(m)-1, Number(d));
  return dt.toLocaleDateString('pt-BR', {weekday:'long', day:'numeric', month:'long', year:'numeric'});
}

function DayBoardCanvas({ dayKey, readOnly, onAddNode }) {
  const [nodes,      setNodes]      = useState([]);
  const [edges,      setEdges]      = useState([]);
  const [selected,   setSelected]   = useState(null);
  const [editing,    setEditing]    = useState(null);
  const [connecting, setConnecting] = useState(null);
  const [pan,        setPan]        = useState({ x:40, y:40 });
  const [scale,      setScale]      = useState(1);

  const ref = useRef({});
  ref.current = { nodes, edges, pan, scale, selected, editing, connecting, readOnly };

  const containerRef = useRef(null);
  const mouseDrag    = useRef(null);
  const savingRef    = useRef(false); // true briefly after local save — avoid self-clobber from poll
  const loadedOnceRef = useRef(false);

  // Initial load: localStorage first (instant), then cloud (authoritative)
  useEffect(() => {
    loadedOnceRef.current = false;
    const b = loadBoards()[dayKey] || { nodes:[], edges:[] };
    setNodes(b.nodes||[]); setEdges(b.edges||[]);
    setSelected(null); setEditing(null); setConnecting(null);
    setPan({x:40,y:40}); setScale(1);

    KV.get(DB_BOARD_KEY).then(cloud => {
      if (cloud && cloud[dayKey]) {
        const cb = cloud[dayKey];
        setNodes(cb.nodes||[]);
        setEdges(cb.edges||[]);
        const all = loadBoards(); all[dayKey] = cb;
        try { localStorage.setItem(DB_BOARD_KEY, JSON.stringify(all)); } catch {}
      }
      loadedOnceRef.current = true;
    });
  }, [dayKey]);

  // Save to localStorage + cloud whenever nodes/edges change (debounced via savingRef)
  useEffect(() => {
    if (!loadedOnceRef.current) return; // don't save before initial cloud pull completes
    const boards = loadBoards();
    boards[dayKey] = { nodes, edges };
    try { localStorage.setItem(DB_BOARD_KEY, JSON.stringify(boards)); } catch {}
    savingRef.current = true;
    KV.set(DB_BOARD_KEY, boards).finally(() => {
      setTimeout(() => { savingRef.current = false; }, 1200);
    });
  }, [nodes, edges, dayKey]);

  // Poll cloud every 5s for this specific day — pick up changes from other devices
  useEffect(() => {
    const id = setInterval(() => {
      if (savingRef.current) return; // don't clobber an in-flight local save
      // Don't interrupt active editing
      if (ref.current.editing) return;
      KV.get(DB_BOARD_KEY).then(cloud => {
        if (!cloud || !cloud[dayKey]) return;
        const cb = cloud[dayKey];
        const newStr = JSON.stringify({nodes:cb.nodes||[], edges:cb.edges||[]});
        const curStr = JSON.stringify({nodes:ref.current.nodes, edges:ref.current.edges});
        if (newStr !== curStr) {
          setNodes(cb.nodes||[]);
          setEdges(cb.edges||[]);
          const all = loadBoards(); all[dayKey] = cb;
          try { localStorage.setItem(DB_BOARD_KEY, JSON.stringify(all)); } catch {}
        }
      });
    }, 5000);
    return () => clearInterval(id);
  }, [dayKey]);

  // Re-sync on focus/visibility change
  useEffect(() => {
    const onFocus = () => {
      if (ref.current.editing) return;
      KV.get(DB_BOARD_KEY).then(cloud => {
        if (!cloud || !cloud[dayKey]) return;
        const cb = cloud[dayKey];
        setNodes(cb.nodes||[]);
        setEdges(cb.edges||[]);
      });
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', () => { if(!document.hidden) onFocus(); });
    return () => window.removeEventListener('focus', onFocus);
  }, [dayKey]);

  const nextColor = n => POST_COLORS[n % POST_COLORS.length];
  const makeNode  = (x, y, color, text) => ({
    id: Date.now()+Math.random(), x, y, w:160, h:110,
    color: color||nextColor(0), text:text||'',
  });
  const toWorld = (cx, cy) => ({
    x:(cx-ref.current.pan.x)/ref.current.scale,
    y:(cy-ref.current.pan.y)/ref.current.scale,
  });

  // Expose addNode to parent button
  useEffect(() => {
    if (!onAddNode) return;
    onAddNode(() => {
      const { pan, scale, nodes } = ref.current;
      const col = nodes.length % 4;
      const row = Math.floor(nodes.length / 4);
      const node = makeNode(
        (-pan.x/scale)+40+col*200,
        (-pan.y/scale)+40+row*140,
        nextColor(nodes.length)
      );
      setNodes(n => [...n, node]);
      setSelected(node.id); setEditing(node.id);
    });
  }, [onAddNode]);

  // Mouse wheel zoom
  useEffect(() => {
    const el = containerRef.current; if(!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 0.9;
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setScale(prev => {
        const next = Math.min(3, Math.max(0.25, prev * factor));
        const ratio = next / prev;
        setPan(p => ({ x: cx-(cx-p.x)*ratio, y: cy-(cy-p.y)*ratio }));
        return next;
      });
    };
    el.addEventListener('wheel', onWheel, { passive:false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Global mouse move/up
  useEffect(() => {
    const onMove = (e) => {
      const d = mouseDrag.current; if(!d) return;
      const dx = e.clientX-d.sx, dy = e.clientY-d.sy;
      if (d.kind==='pan') setPan({ x:d.ox+dx, y:d.oy+dy });
      else if (d.kind==='node') {
        const s = ref.current.scale;
        setNodes(ns => ns.map(n => n.id===d.id ? {...n,x:d.ox+dx/s,y:d.oy+dy/s} : n));
      }
    };
    const onUp = () => { mouseDrag.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    return () => { window.removeEventListener('mousemove',onMove); window.removeEventListener('mouseup',onUp); };
  }, []);

  // Touch events — completely separate from mouse/pointer
  useEffect(() => {
    const el = containerRef.current; if(!el) return;
    const dist  = (a,b) => Math.hypot(a.clientX-b.clientX, a.clientY-b.clientY);
    const midXY = (a,b,r) => ({ x:(a.clientX+b.clientX)/2-r.left, y:(a.clientY+b.clientY)/2-r.top });

    const ts = {
      fingers:0, panOx:0, panOy:0, t0x:0, t0y:0,
      lastDist:0, lastMidX:0, lastMidY:0,
      nodeDrag:null, isPanning:false, moved:false,
    };

    const onTouchStart = (e) => {
      ts.fingers = e.touches.length;
      ts.moved   = false;
      if (e.touches.length === 2) {
        e.preventDefault();
        ts.nodeDrag = null; ts.isPanning = false;
        const [a,b] = [e.touches[0],e.touches[1]];
        const r = el.getBoundingClientRect();
        ts.lastDist = dist(a,b);
        const m = midXY(a,b,r); ts.lastMidX=m.x; ts.lastMidY=m.y;
        ts.panOx = ref.current.pan.x; ts.panOy = ref.current.pan.y;
      } else if (e.touches.length === 1) {
        const t = e.touches[0];
        ts.t0x=t.clientX; ts.t0y=t.clientY;
        ts.panOx=ref.current.pan.x; ts.panOy=ref.current.pan.y;
        const nodeEl = t.target.closest('[data-nid]');
        if (nodeEl && !ref.current.readOnly && !ref.current.editing) {
          const nid  = nodeEl.getAttribute('data-nid');
          const node = ref.current.nodes.find(n => String(n.id)===nid);
          if (node) { ts.nodeDrag={id:node.id,ox:node.x,oy:node.y}; ts.isPanning=false; return; }
        }
        ts.nodeDrag = null; ts.isPanning = !ref.current.editing;
      }
    };

    const onTouchMove = (e) => {
      e.preventDefault();
      ts.fingers = e.touches.length;
      if (e.touches.length === 2) {
        const [a,b] = [e.touches[0],e.touches[1]];
        const r = el.getBoundingClientRect();
        const newDist = dist(a,b);
        const m = midXY(a,b,r);
        if (ts.lastDist > 0) {
          const f = newDist/ts.lastDist;
          const pdx=m.x-ts.lastMidX, pdy=m.y-ts.lastMidY;
          setScale(prev => {
            const next = Math.min(3, Math.max(0.25, prev*f));
            const ratio = next/prev;
            setPan(p => ({
              x: m.x-(ts.lastMidX-p.x)*ratio+pdx,
              y: m.y-(ts.lastMidY-p.y)*ratio+pdy,
            }));
            return next;
          });
        }
        ts.lastDist=newDist; ts.lastMidX=m.x; ts.lastMidY=m.y;
      } else if (e.touches.length === 1) {
        const t = e.touches[0];
        const dx = t.clientX-ts.t0x, dy = t.clientY-ts.t0y;
        if (!ts.moved && Math.hypot(dx,dy)>8) ts.moved=true;
        if (!ts.moved) return;
        if (ts.nodeDrag) {
          const s=ref.current.scale;
          setNodes(ns=>ns.map(n=>n.id===ts.nodeDrag.id?{...n,x:ts.nodeDrag.ox+dx/s,y:ts.nodeDrag.oy+dy/s}:n));
        } else if (ts.isPanning && !ref.current.editing) {
          setPan({ x:ts.panOx+dx, y:ts.panOy+dy });
        }
      }
    };

    const onTouchEnd = (e) => {
      ts.fingers = e.touches.length;
      if (e.touches.length < 2) ts.lastDist=0;
      // Tap detection
      if (!ts.moved && e.changedTouches.length===1) {
        const t = e.changedTouches[0];
        const nodeEl = t.target.closest('[data-nid]');
        if (nodeEl) {
          const nid = nodeEl.getAttribute('data-nid');
          if (ref.current.connecting) connectNodes(nid);
          else setSelected(prev => String(prev)===nid ? null : nid);
        } else {
          setSelected(null);
          if (ref.current.connecting) setConnecting(null);
        }
      }
      if (e.touches.length===0) { ts.nodeDrag=null; ts.isPanning=false; ts.moved=false; }
      if (e.touches.length===1) { const t=e.touches[0]; ts.t0x=t.clientX; ts.t0y=t.clientY; ts.panOx=ref.current.pan.x; ts.panOy=ref.current.pan.y; ts.nodeDrag=null; ts.isPanning=!ref.current.editing; }
    };

    el.addEventListener('touchstart', onTouchStart, {passive:false});
    el.addEventListener('touchmove',  onTouchMove,  {passive:false});
    el.addEventListener('touchend',   onTouchEnd,   {passive:true});
    el.addEventListener('touchcancel',onTouchEnd,   {passive:true});
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove',  onTouchMove);
      el.removeEventListener('touchend',   onTouchEnd);
      el.removeEventListener('touchcancel',onTouchEnd);
    };
  }, []);

  const onBgMouseDown = (e) => {
    if (e.button!==0||e.target!==e.currentTarget) return;
    if (ref.current.connecting) { setConnecting(null); return; }
    setSelected(null);
    mouseDrag.current = { kind:'pan', ox:ref.current.pan.x, oy:ref.current.pan.y, sx:e.clientX, sy:e.clientY };
  };

  const onBgDblClick = (e) => {
    if (e.target!==e.currentTarget||readOnly) return;
    const r=containerRef.current.getBoundingClientRect();
    const {x,y}=toWorld(e.clientX-r.left, e.clientY-r.top);
    const node=makeNode(x-80,y-55,nextColor(ref.current.nodes.length));
    setNodes(n=>[...n,node]); setSelected(node.id); setEditing(node.id);
  };

  const onNodeMouseDown = (e, node) => {
    if (e.button!==0) return;
    const {editing,connecting,readOnly}=ref.current;
    if (readOnly) return;
    if (editing===node.id) return;
    if (connecting) { connectNodes(String(node.id)); return; }
    e.stopPropagation();
    mouseDrag.current = { kind:'node', id:node.id, ox:node.x, oy:node.y, sx:e.clientX, sy:e.clientY };
  };

  const deleteNode = (id) => {
    setNodes(n=>n.filter(x=>x.id!==id));
    setEdges(e=>e.filter(x=>x.from!==id&&x.to!==id));
    setSelected(s=>s===id?null:s);
    setEditing(v=>v===id?null:v);
  };

  const addConnectedNode = (src) => {
    if (readOnly) return;
    const child=makeNode(src.x+src.w+50,src.y,src.color);
    setNodes(n=>[...n,child]);
    setEdges(e=>[...e,{id:Date.now()+Math.random(),from:src.id,to:child.id}]);
    setSelected(child.id); setEditing(child.id);
  };

  const connectNodes = (toId) => {
    const fromId = ref.current.connecting;
    if (!fromId) return;
    setConnecting(null);
    if (String(fromId)===String(toId)) return;
    setEdges(prev => {
      const dup=prev.find(e=>(String(e.from)===String(fromId)&&String(e.to)===String(toId))||(String(e.from)===String(toId)&&String(e.to)===String(fromId)));
      return dup ? prev : [...prev,{id:Date.now()+Math.random(),from:fromId,to:toId}];
    });
  };

  const changeColor = (id,c) => setNodes(n=>n.map(x=>x.id===id?{...x,color:c}:x));
  const updateText  = (id,t) => setNodes(n=>n.map(x=>x.id===id?{...x,text:t}:x));
  const getCenter   = n => ({cx:n.x+n.w/2,cy:n.y+n.h/2});

  return (
    <div ref={containerRef} style={{
        position:'relative',width:'100%',height:'100%',overflow:'hidden',
        background:'#eef3f8',
        backgroundImage:'radial-gradient(circle,#b8cedd 1px,transparent 1px)',
        backgroundSize:'28px 28px',
        touchAction:'none', userSelect:'none', cursor:'default',
      }}
      onMouseDown={onBgMouseDown}
      onDoubleClick={onBgDblClick}
    >
      {connecting && (
        <div style={{position:'absolute',top:10,left:'50%',transform:'translateX(-50%)',zIndex:40,
            background:'#7c3aed',color:'#fff',borderRadius:20,padding:'7px 18px',
            fontSize:13,fontWeight:600,pointerEvents:'none',boxShadow:'0 4px 20px #7c3aed55'}}>
          Toque no post-it destino para conectar 🔗
        </div>
      )}
      <div style={{position:'absolute',bottom:8,right:8,zIndex:20,display:'flex',gap:6,alignItems:'center'}}>
        <button onClick={()=>{setPan({x:40,y:40});setScale(1);}}
          style={{background:'rgba(255,255,255,0.9)',border:'1px solid #dde',borderRadius:8,
            color:'#64748b',fontSize:11,padding:'3px 9px',cursor:'pointer'}}>↺</button>
        <div style={{background:'rgba(255,255,255,0.85)',border:'1px solid #e2e8f0',borderRadius:8,
            padding:'3px 8px',fontSize:10,color:'#94a3b8',pointerEvents:'none'}}>
          {Math.round(scale*100)}% · {nodes.length} post-it{nodes.length!==1?'s':''}
        </div>
      </div>
      <svg style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none',zIndex:1,overflow:'visible'}}>
        <defs>
          <marker id="dbArr" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L7,3 z" fill="#94a3b8"/>
          </marker>
        </defs>
        <g transform={"translate("+pan.x+","+pan.y+") scale("+scale+")"}>
          {edges.map(e=>{
            const f=nodes.find(n=>n.id===e.from),t=nodes.find(n=>n.id===e.to);
            if(!f||!t) return null;
            const fc=getCenter(f),tc=getCenter(t),mx=(fc.cx+tc.cx)/2;
            return <path key={e.id} d={"M"+fc.cx+" "+fc.cy+" C"+mx+" "+fc.cy+","+mx+" "+tc.cy+","+tc.cx+" "+tc.cy}
              stroke="#94a3b8" strokeWidth={1.5/scale} fill="none"
              strokeDasharray={(5/scale)+","+(3/scale)} markerEnd="url(#dbArr)" opacity={0.75}/>;
          })}
        </g>
      </svg>
      {nodes.map(node=>{
        const isSel  = String(selected)===String(node.id);
        const isEdit = String(editing)===String(node.id);
        const isConn = String(connecting)===String(node.id);
        const tx=pan.x+node.x*scale, ty=pan.y+node.y*scale;
        const nw=node.w*scale, nh=node.h*scale;
        const fz=Math.max(11*scale,10);
        const br=Math.max(9*scale,8);
        return (
          <div key={node.id} data-nid={String(node.id)} style={{
              position:'absolute',left:tx,top:ty,width:nw,height:nh,
              background:node.color, borderRadius:br,
              boxShadow:isSel?'0 0 0 3px #3a8fd4,0 6px 24px #0003':isConn?'0 0 0 3px #7c3aed,0 6px 24px #0003':'0 2px 10px #0002',
              display:'flex',flexDirection:'column',zIndex:isSel?20:3,transition:'box-shadow .1s',
            }}
            onMouseDown={e=>onNodeMouseDown(e,node)}
            onClick={e=>{e.stopPropagation();if(ref.current.connecting)connectNodes(String(node.id));else setSelected(s=>String(s)===String(node.id)?null:node.id);}}
            onDoubleClick={e=>{e.stopPropagation();if(!readOnly)setEditing(node.id);}}
          >
            <div style={{height:Math.max(20*scale,20),flexShrink:0,background:'rgba(0,0,0,0.10)',
                borderRadius:br+"px "+br+"px 0 0",display:'flex',alignItems:'center',
                justifyContent:isSel&&!readOnly?'space-between':'flex-start',
                padding:"0 "+Math.max(6*scale,6)+"px",gap:4}}>
              <span style={{fontSize:Math.max(9*scale,9),opacity:.35}}>⠿</span>
              {isSel&&!readOnly&&(
                <div style={{display:'flex',gap:Math.max(3*scale,3),flexWrap:'wrap',justifyContent:'flex-end'}}>
                  {POST_COLORS.map(c=>(
                    <div key={c}
                      onMouseDown={e=>{e.stopPropagation();changeColor(node.id,c);}}
                      onTouchEnd={e=>{e.stopPropagation();e.preventDefault();changeColor(node.id,c);}}
                      style={{width:Math.max(10*scale,10),height:Math.max(10*scale,10),borderRadius:'50%',background:c,cursor:'pointer',flexShrink:0,
                        border:node.color===c?Math.max(1.5*scale,1.5)+"px solid rgba(0,0,0,0.55)":"1px solid rgba(0,0,0,0.15)"}}/>
                  ))}
                </div>
              )}
            </div>
            <div style={{flex:1,padding:Math.max(5*scale,5)+"px "+Math.max(8*scale,7)+"px",overflow:'hidden'}}>
              {isEdit&&!readOnly?(
                <textarea autoFocus value={node.text}
                  onChange={e=>updateText(node.id,e.target.value)}
                  onBlur={()=>setEditing(null)}
                  onKeyDown={e=>{if(e.key==='Escape')setEditing(null);e.stopPropagation();}}
                  onMouseDown={e=>e.stopPropagation()}
                  onTouchStart={e=>e.stopPropagation()}
                  style={{width:'100%',height:'100%',background:'transparent',border:'none',outline:'none',
                    resize:'none',fontSize:fz,fontFamily:'inherit',color:'rgba(0,0,0,0.78)',lineHeight:1.45,padding:0}}/>
              ):(
                <div style={{fontSize:fz,color:'rgba(0,0,0,0.75)',lineHeight:1.45,wordBreak:'break-word',whiteSpace:'pre-wrap',height:'100%',overflow:'hidden'}}>
                  {node.text||<span style={{opacity:.3,fontStyle:'italic'}}>toque 2× para editar</span>}
                </div>
              )}
            </div>
            {!readOnly&&!isEdit&&(
              <div style={{display:'flex',gap:Math.max(3*scale,3),
                  padding:Math.max(3*scale,4)+"px "+Math.max(5*scale,5)+"px "+Math.max(4*scale,5)+"px",
                  flexShrink:0,borderTop:"1px solid rgba(0,0,0,0.08)",background:'rgba(0,0,0,0.05)',
                  borderRadius:"0 0 "+br+"px "+br+"px"}}
                onMouseDown={e=>e.stopPropagation()}
                onTouchStart={e=>e.stopPropagation()}>
                <button
                  onTouchEnd={e=>{e.stopPropagation();e.preventDefault();addConnectedNode(node);}}
                  onClick={e=>{e.stopPropagation();addConnectedNode(node);}}
                  style={{flex:1,background:'rgba(58,143,212,0.85)',border:'none',borderRadius:Math.max(5*scale,5),
                    color:'#fff',fontSize:Math.max(9*scale,10),fontWeight:700,
                    padding:Math.max(2*scale,4)+"px "+Math.max(4*scale,4)+"px",cursor:'pointer',whiteSpace:'nowrap'}}>
                  + Fio
                </button>
                <button
                  onTouchEnd={e=>{e.stopPropagation();e.preventDefault();setConnecting(node.id);}}
                  onClick={e=>{e.stopPropagation();setConnecting(node.id);}}
                  style={{background:'rgba(124,58,237,0.8)',border:'none',borderRadius:Math.max(5*scale,5),
                    color:'#fff',fontSize:Math.max(9*scale,10),
                    padding:Math.max(2*scale,4)+"px "+Math.max(5*scale,6)+"px",cursor:'pointer'}}>
                  🔗
                </button>
                <button
                  onTouchEnd={e=>{e.stopPropagation();e.preventDefault();deleteNode(node.id);}}
                  onClick={e=>{e.stopPropagation();deleteNode(node.id);}}
                  style={{background:'rgba(220,38,38,0.7)',border:'none',borderRadius:Math.max(5*scale,5),
                    color:'#fff',fontSize:Math.max(9*scale,10),
                    padding:Math.max(2*scale,4)+"px "+Math.max(5*scale,6)+"px",cursor:'pointer'}}>
                  ✕
                </button>
              </div>
            )}
          </div>
        );
      })}
      {nodes.length===0&&!readOnly&&(
        <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',
            alignItems:'center',justifyContent:'center',pointerEvents:'none',gap:8}}>
          <div style={{fontSize:44,opacity:.1}}>📌</div>
          <div style={{fontSize:13,color:'#94a3b8',textAlign:'center',lineHeight:1.8}}>
            Toque em <b>+ Post-it</b> para começar<br/>
            <span style={{fontSize:11,opacity:.7}}>Desktop: duplo clique no fundo</span>
          </div>
        </div>
      )}
      {nodes.length===0&&readOnly&&(
        <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',pointerEvents:'none'}}>
          <span style={{fontSize:12,color:'#94a3b8'}}>Board vazio neste dia</span>
        </div>
      )}
    </div>
  );
}

function DayBoardPage() {
  const [allBoards, setAllBoards] = useState(loadBoards);
  const today  = todayKey();
  const [viewKey, setViewKey] = useState(today);
  const [showHistory, setShowHistory] = useState(false);
  const [kvSynced, setKvSynced] = useState(false);

  // On mount: pull boards from cloud, merge with local
  useEffect(() => {
    KV.get(DB_BOARD_KEY).then(cloud => {
      if (cloud && typeof cloud === 'object') {
        const local = loadBoards();
        // Merge: cloud wins for same day, local adds days cloud doesn't have
        const merged = { ...local, ...cloud };
        saveBoards(merged);
        setAllBoards(merged);
      }
      setKvSynced(true);
    });
  }, []);

  const refreshBoards = () => setAllBoards(loadBoards());

  // All days that have data, sorted desc
  const historyKeys = Object.keys(allBoards)
    .filter(k => (allBoards[k]?.nodes||[]).length > 0)
    .sort((a,b) => b.localeCompare(a));

  const isToday = viewKey === today;

  const addNodeFnRef = useRef(null);
  const handleAddNode = () => { if(addNodeFnRef.current) addNodeFnRef.current(); };

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'calc(100vh - 196px)', minHeight:400 }}>
      {/* Header bar */}
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8, flexWrap:'wrap' }}>
        {/* Today / History toggle */}
        <button onClick={()=>{setViewKey(today);setShowHistory(false);}} style={{...btn(isToday&&!showHistory?'var(--accent)':'var(--bg-card)'),border:`1px solid ${isToday&&!showHistory?'var(--accent)':'var(--border)'}`,color:isToday&&!showHistory?'#fff':'var(--text-2)',padding:'7px 16px',fontSize:13,borderRadius:20}}>
          📌 Hoje
        </button>
        <button onClick={()=>setShowHistory(h=>!h)} style={{...btn(showHistory?'var(--purple)':'var(--bg-card)'),border:`1px solid ${showHistory?'var(--purple)':'var(--border)'}`,color:showHistory?'#fff':'var(--text-2)',padding:'7px 16px',fontSize:13,borderRadius:20}}>
          🗂 {historyKeys.length>0?`(${historyKeys.length})`:''}
        </button>
        {/* External Add button — only on today's board */}
        {isToday && !showHistory && (
          <button onClick={handleAddNode}
            style={{background:'#3a8fd4',border:'none',borderRadius:20,color:'#fff',
              fontSize:13,fontWeight:700,padding:'7px 18px',cursor:'pointer',
              boxShadow:'0 2px 10px #3a8fd433',display:'flex',alignItems:'center',gap:6}}>
            📌 + Post-it
          </button>
        )}
        {/* Reset view */}
        {isToday && !showHistory && (
          <button onClick={()=>{ if(addNodeFnRef.current) { /* trigger reset via canvas */ } }}
            style={{background:'transparent',border:'1px solid var(--border)',borderRadius:20,
              color:'var(--text-3)',fontSize:12,padding:'6px 12px',cursor:'pointer'}}
            title="Centralizar vista"
            id="wb-reset-btn">
            ↺
          </button>
        )}
        {/* Date label */}
        <span style={{fontSize:12,color:'var(--text-3)',marginLeft:2}}>
          {isToday&&!showHistory?new Date().toLocaleDateString('pt-BR',{weekday:'short',day:'numeric',month:'short'}):showHistory?'Selecione um dia':fmtBoardDate(viewKey)}
        </span>

        {/* Nav arrows when viewing history */}
        {!showHistory && viewKey !== today && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {(() => {
              const idx = historyKeys.indexOf(viewKey);
              return (<>
                {idx > 0 && <button onClick={()=>setViewKey(historyKeys[idx-1])} style={{ ...btn('var(--bg-card)'), border:'1px solid var(--border)', color:'var(--text-2)', padding:'6px 14px', borderRadius:12, fontSize:12 }}>← Mais recente</button>}
                {idx < historyKeys.length-1 && <button onClick={()=>setViewKey(historyKeys[idx+1])} style={{ ...btn('var(--bg-card)'), border:'1px solid var(--border)', color:'var(--text-2)', padding:'6px 14px', borderRadius:12, fontSize:12 }}>Mais antigo →</button>}
                <button onClick={()=>{setViewKey(today);setShowHistory(false);}} style={{ ...btn('var(--accent)'), padding:'6px 14px', borderRadius:12, fontSize:12 }}>Ir para Hoje</button>
              </>);
            })()}
          </div>
        )}
      </div>

      {/* History grid */}
      {showHistory && (
        <div style={{ marginBottom: 14 }}>
          {historyKeys.length === 0 && <Empty text="Nenhum dia registrado ainda"/>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {historyKeys.map(k => {
              const board = allBoards[k] || {};
              const count = (board.nodes||[]).length;
              const isActive = k === viewKey && !showHistory;
              return (
                <button key={k} onClick={() => { setViewKey(k); setShowHistory(false); }}
                  style={{ background: 'var(--bg-card)', border: `1px solid ${isActive?'var(--accent)':'var(--border)'}`, borderRadius: 12, padding: '10px 16px', cursor: 'pointer', textAlign: 'left', minWidth: 160 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)', marginBottom: 3 }}>{fmtBoardDate(k)}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>📌 {count} post-it{count!==1?'s':''}</div>
                  {/* Mini preview: colored dots */}
                  <div style={{ display:'flex', gap:3, marginTop:6, flexWrap:'wrap' }}>
                    {(board.nodes||[]).slice(0,8).map(n=>(
                      <div key={n.id} style={{ width:10,height:10,borderRadius:3,background:n.color,flexShrink:0 }} title={n.text?.slice(0,30)}/>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Canvas */}
      {!showHistory && (
        <div style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', position: 'relative' }}
          onMouseUp={refreshBoards}>
          <DayBoardCanvas key={viewKey} dayKey={viewKey} readOnly={!isToday}
          onAddNode={fn=>{addNodeFnRef.current=fn;}}/>
          {!isToday && (
            <div style={{ position:'absolute', top:10, right:14, background:'var(--purple)', color:'#fff', fontSize:11, fontWeight:700, padding:'4px 12px', borderRadius:20, letterSpacing:1, pointerEvents:'none', zIndex:30 }}>
              📖 LEITURA — {fmtBoardDate(viewKey)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── IDEIAS — CARDS ──────────────────────────────────────────────────────────
function IdeasCards() {
  const [entries, setEntries, synced] = useKV("ideas_v1",[]);
  const [text, setText]   = useState("");
  const [tag, setTag]     = useState("");
  const [editing, setEditing] = useState(null);
  const [editText, setEditText] = useState("");
  const [editTag, setEditTag]   = useState("");

  const add = () => {
    if(!text.trim()) return;
    const e={id:Date.now(),text,tag,mood:"💡",date:nowISO()};
    const n=[e,...entries]; setEntries(n); setText(""); setTag("");
  };
  const del = id=>{ setEntries(p=>p.filter(e=>e.id!==id)); };
  const openEdit = e=>{ setEditing(e); setEditText(e.text); setEditTag(e.tag||""); };
  const saveEdit = ()=>{
    const n=entries.map(e=>e.id===editing.id?{...e,text:editText,tag:editTag}:e);
    setEntries(n); setEditing(null);
  };

  return (
    <div>
      <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:14,padding:18,marginBottom:20}}>
        <textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Anote uma ideia..." rows={3}
          style={{...inp,resize:"none",marginBottom:10}} onKeyDown={e=>{if(e.ctrlKey&&e.key==="Enter")add();}}/>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <input style={{...inp,flex:1}} placeholder="Tag (opcional)" value={tag} onChange={e=>setTag(e.target.value)}/>
          <button onClick={add} style={{...btn("var(--purple)"),padding:"10px 20px",whiteSpace:"nowrap"}}>+ Salvar</button>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:14}}>
        {entries.map(e=>(
          <div key={e.id} style={{background:"var(--bg-card)",border:"1px solid rgba(160,112,224,0.3)",borderRadius:14,padding:16,display:"flex",flexDirection:"column",gap:10}}>
            {e.tag&&<span style={{background:"rgba(160,112,224,0.15)",border:"1px solid rgba(160,112,224,0.3)",borderRadius:20,padding:"2px 10px",fontSize:10,color:"var(--purple)",fontWeight:700,letterSpacing:1,alignSelf:"flex-start"}}>{e.tag.toUpperCase()}</span>}
            <p style={{margin:0,color:"var(--text-1)",lineHeight:1.7,fontSize:14,whiteSpace:"pre-wrap",flex:1}}>{e.text}</p>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:10,color:"var(--text-3)"}}>{new Date(e.date).toLocaleDateString("pt-BR")} {new Date(e.date).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</span>
              <div style={{display:"flex",gap:6}}>
                <button onClick={()=>openEdit(e)} style={{background:"var(--accent-dim)",border:"1px solid var(--accent-bdr)",borderRadius:8,padding:"4px 10px",color:"var(--accent)",fontSize:11,cursor:"pointer"}}>✏️ Editar</button>
                <button onClick={()=>del(e.id)} style={{background:"none",border:"none",color:"var(--text-3)",cursor:"pointer"}}><Icon path={I.trash} size={14}/></button>
              </div>
            </div>
          </div>
        ))}
        {entries.length===0&&<div style={{gridColumn:"1/-1",textAlign:"center",color:"var(--text-3)",padding:"40px 0",fontSize:14}}>Nenhuma ideia ainda. Anote a primeira! 💡</div>}
      </div>
      {editing&&<Modal title="Editar Ideia" onClose={()=>setEditing(null)}>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <textarea style={{...inp,resize:"vertical"}} rows={6} value={editText} onChange={e=>setEditText(e.target.value)}/>
          <input style={inp} placeholder="Tag" value={editTag} onChange={e=>setEditTag(e.target.value)}/>
          <button onClick={saveEdit} style={btn()}>Salvar</button>
        </div>
      </Modal>}
    </div>
  );
}

// ─── LEMBRETES — CARDS ───────────────────────────────────────────────────────
function RemindersCards() {
  const [entries, setEntries, synced] = useKV("reminders_v1",[]);
  const [text, setText]   = useState("");
  const [editing, setEditing] = useState(null);
  const [editText, setEditText] = useState("");
  const [filter, setFilter]   = useState("all");

  const add = () => {
    if(!text.trim()) return;
    const e={id:Date.now(),text,mood:"🔔",done:false,date:nowISO()};
    const n=[e,...entries]; setEntries(n); setText("");
  };
  const tick = id=>{
    const cur=entries.find(e=>e.id===id);
    const n=entries.map(e=>e.id===id?{...e,done:!e.done}:e);
    setEntries(n);
  };
  const del = id=>{ setEntries(p=>p.filter(e=>e.id!==id)); };
  const openEdit = e=>{ setEditing(e); setEditText(e.text); };
  const saveEdit = ()=>{
    const n=entries.map(e=>e.id===editing.id?{...e,text:editText}:e);
    setEntries(n); setEditing(null);
  };
  const filtered = filter==="all"?entries: filter==="done"?entries.filter(e=>e.done): entries.filter(e=>!e.done);

  return (
    <div>
      <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:14,padding:18,marginBottom:16}}>
        <textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Adicione um lembrete..." rows={2}
          style={{...inp,resize:"none",marginBottom:10}} onKeyDown={e=>{if(e.ctrlKey&&e.key==="Enter")add();}}/>
        <div style={{display:"flex",justifyContent:"flex-end"}}>
          <button onClick={add} style={{...btn("var(--yellow)"),padding:"10px 20px",color:"#000"}}>+ Salvar</button>
        </div>
      </div>
      <div style={{display:"flex",gap:6,marginBottom:16}}>
        {[["all","Todos"],["todo","Pendentes"],["done","Feitos"]].map(([id,l])=>(
          <button key={id} onClick={()=>setFilter(id)} style={{background:filter===id?"var(--yellow)":"var(--bg-card)",border:"none",borderRadius:20,padding:"5px 14px",color:filter===id?"#000":"var(--text-2)",fontSize:12,fontWeight:600,cursor:"pointer"}}>{l}</button>
        ))}
        <span style={{marginLeft:"auto",fontSize:11,color:"var(--text-3)",alignSelf:"center"}}>{entries.filter(e=>!e.done).length} pendentes</span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:14}}>
        {filtered.map(e=>(
          <div key={e.id} style={{background:"var(--bg-card)",border:`1px solid ${e.done?"var(--border-2)":"rgba(240,192,64,0.3)"}`,borderRadius:14,padding:16,opacity:e.done?0.6:1,transition:"opacity .2s"}}>
            <div style={{display:"flex",gap:10,alignItems:"flex-start",marginBottom:10}}>
              <button onClick={()=>tick(e.id)} style={{width:24,height:24,borderRadius:6,border:`2px solid ${e.done?"var(--green)":"var(--yellow)"}`,background:e.done?"var(--green)":"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1}}>
                {e.done&&<Icon path={I.check} size={13} color="#fff"/>}
              </button>
              <p style={{margin:0,color:"var(--text-1)",lineHeight:1.7,fontSize:14,flex:1,textDecoration:e.done?"line-through":"none",whiteSpace:"pre-wrap"}}>{e.text}</p>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:10,color:"var(--text-3)"}}>{new Date(e.date).toLocaleDateString("pt-BR")} {new Date(e.date).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</span>
              <div style={{display:"flex",gap:6}}>
                <button onClick={()=>openEdit(e)} style={{background:"var(--accent-dim)",border:"1px solid var(--accent-bdr)",borderRadius:8,padding:"4px 10px",color:"var(--accent)",fontSize:11,cursor:"pointer"}}>✏️</button>
                <button onClick={()=>del(e.id)} style={{background:"none",border:"none",color:"var(--text-3)",cursor:"pointer"}}><Icon path={I.trash} size={14}/></button>
              </div>
            </div>
          </div>
        ))}
        {filtered.length===0&&<div style={{gridColumn:"1/-1",textAlign:"center",color:"var(--text-3)",padding:"40px 0",fontSize:14}}>Nenhum lembrete aqui.</div>}
      </div>
      {editing&&<Modal title="Editar Lembrete" onClose={()=>setEditing(null)}>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <textarea style={{...inp,resize:"vertical"}} rows={4} value={editText} onChange={e=>setEditText(e.target.value)}/>
          <button onClick={saveEdit} style={btn()}>Salvar</button>
        </div>
      </Modal>}
    </div>
  );
}

// ─── DIARY PAGE ───────────────────────────────────────────────────────────────
// ─── TEMAS PAGE ───────────────────────────────────────────────────────────────
function TemasPage() {
  const todayKey = () => new Date().toISOString().slice(0,10);
  const fmtDt    = (iso) => new Date(iso).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",year:"2-digit",hour:"2-digit",minute:"2-digit"});
  const fmtDay   = (key) => {
    const [y,m,d] = key.split("-");
    return new Date(Number(y),Number(m)-1,Number(d))
      .toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
  };

  // ── Mode: "fixed" (pinned boards) | "daily" (today's boards + history) ──
  const [mode, setMode] = useState("fixed");

  // ── Persistent state via useKV ──
  const [fixedBoards, setFixedBoards, fSynced] = useKV("temas_fixed_v1", []);
  const [dailyData,   setDailyData,   dSynced] = useKV("temas_daily_v1", {}); // { "YYYY-MM-DD": [board,...] }

  // ── UI state ──
  const [addOpen,      setAddOpen]      = useState(false);
  const [editCard,     setEditCard]     = useState(null); // { board, mode, day? }
  const [historyDay,   setHistoryDay]   = useState(null); // viewing a past day
  const [form,         setForm]         = useState({ title:"", text:"" });
  const [updateText,   setUpdateText]   = useState("");
  const [viewCard,     setViewCard]     = useState(null); // modal to view/edit

  const today = todayKey();
  const todayBoards = dailyData[today] || [];

  // ── Helpers ──
  const makeBoard = (title, text, mode) => ({
    id:    Date.now() + Math.random(),
    title: title.trim(),
    text:  text.trim(),
    mode,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updates:   [],
  });

  // ── Fixed boards CRUD ──
  const addFixed = () => {
    if (!form.title.trim()) return;
    const b = makeBoard(form.title, form.text, "fixed");
    setFixedBoards([b, ...fixedBoards]);
    setForm({ title:"", text:"" }); setAddOpen(false);
  };

  const updateFixed = (id, patch) => {
    const entry = { text: patch.text, date: new Date().toISOString() };
    const next = fixedBoards.map(b => b.id===id
      ? { ...b, ...patch, updatedAt: new Date().toISOString(), updates: [...(b.updates||[]), entry] }
      : b
    );
    setFixedBoards(next);
  };

  const deleteFixed = (id) => {
    setFixedBoards(fixedBoards.filter(b => b.id !== id));
    setViewCard(null);
  };

  // ── Daily boards CRUD ──
  const addDaily = () => {
    if (!form.title.trim()) return;
    const b = makeBoard(form.title, form.text, "daily");
    const next = { ...dailyData, [today]: [b, ...(dailyData[today]||[])] };
    setDailyData(next);
    setForm({ title:"", text:"" }); setAddOpen(false);
  };

  const updateDaily = (id, patch) => {
    const entry = { text: patch.text, date: new Date().toISOString() };
    const dayKey = historyDay || today;
    const next = {
      ...dailyData,
      [dayKey]: (dailyData[dayKey]||[]).map(b => b.id===id
        ? { ...b, ...patch, updatedAt: new Date().toISOString(), updates: [...(b.updates||[]), entry] }
        : b
      )
    };
    setDailyData(next);
  };

  const deleteDaily = (id) => {
    const dayKey = historyDay || today;
    const next = { ...dailyData, [dayKey]: (dailyData[dayKey]||[]).filter(b=>b.id!==id) };
    setDailyData(next);
    setViewCard(null);
  };

  const handleAdd  = () => mode==="fixed" ? addFixed()  : addDaily();
  const handleEdit = (board) => { mode==="fixed" ? updateFixed(board.id,  {text:updateText}) : updateDaily(board.id, {text:updateText}); setUpdateText(""); setViewCard(null); };
  const handleDel  = (id)    => mode==="fixed" ? deleteFixed(id)  : deleteDaily(id);

  // ── History keys (daily mode only) ──
  const histKeys = Object.keys(dailyData)
    .filter(k => k!==today && (dailyData[k]||[]).length>0)
    .sort((a,b)=>b.localeCompare(a));

  const displayBoards = mode==="fixed"
    ? fixedBoards
    : historyDay ? (dailyData[historyDay]||[]) : todayBoards;

  const isReadOnly = mode==="daily" && historyDay !== null;

  // ── Board card colors (cycle) ──
  const CARD_COLORS = [
    "#2563eb","#7c3aed","#059669","#d97706",
    "#dc2626","#0891b2","#be185d","#065f46",
  ];

  // ── RENDER ──
  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>

      {/* Mode selector + Add button */}
      <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
        <div style={{display:"flex",gap:6,background:"var(--bg-sub)",borderRadius:30,padding:4,border:"1px solid var(--border)"}}>
          {[
            {k:"fixed", icon:"📌", label:"Fixos"},
            {k:"daily", icon:"🗓", label:"Por dia"},
          ].map(o=>(
            <button key={o.k} onClick={()=>{setMode(o.k);setHistoryDay(null);}}
              style={{background:mode===o.k?"var(--accent)":"transparent",
                border:"none",borderRadius:26,padding:"7px 18px",
                color:mode===o.k?"#fff":"var(--text-2)",
                fontSize:13,fontWeight:700,cursor:"pointer",transition:"all .15s",
                display:"flex",alignItems:"center",gap:6}}>
              {o.icon} {o.label}
            </button>
          ))}
        </div>

        {!isReadOnly && (
          <button onClick={()=>{setAddOpen(true);setForm({title:"",text:""}); }}
            style={{...btn(),display:"flex",alignItems:"center",gap:8,padding:"10px 20px",borderRadius:30}}>
            <Icon path={I.plus} size={14}/> Novo quadro
          </button>
        )}

        {/* Daily: today/history toggle */}
        {mode==="daily" && (
          <div style={{display:"flex",gap:6,marginLeft:"auto",flexWrap:"wrap"}}>
            <button onClick={()=>setHistoryDay(null)}
              style={{...btn(historyDay===null?"var(--accent)":"var(--bg-card)"),
                border:`1px solid ${historyDay===null?"var(--accent)":"var(--border)"}`,
                color:historyDay===null?"#fff":"var(--text-2)",
                padding:"7px 16px",borderRadius:20,fontSize:12}}>
              📌 Hoje
            </button>
            {histKeys.length>0 && (
              <select value={historyDay||""} onChange={e=>setHistoryDay(e.target.value||null)}
                style={{...inp,padding:"7px 12px",borderRadius:20,fontSize:12,width:"auto",cursor:"pointer"}}>
                <option value="">🗂 Histórico ({histKeys.length} dias)</option>
                {histKeys.map(k=>(
                  <option key={k} value={k}>{fmtDay(k)}</option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      {/* Day label */}
      {mode==="daily" && (
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{fontSize:13,color:"var(--text-3)",fontWeight:600}}>
            {historyDay
              ? <>📖 {fmtDay(historyDay)} <span style={{background:"var(--purple)",color:"#fff",borderRadius:10,padding:"2px 10px",fontSize:10,marginLeft:6}}>Leitura</span></>
              : <>📅 {new Date().toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"})}</>
            }
          </div>
          {historyDay && (
            <button onClick={()=>setHistoryDay(null)}
              style={{...btn("transparent"),border:"1px solid var(--border)",color:"var(--accent)",padding:"4px 12px",borderRadius:12,fontSize:11}}>
              ← Voltar para hoje
            </button>
          )}
        </div>
      )}

      {/* Boards grid */}
      {displayBoards.length===0 ? (
        <div style={{textAlign:"center",padding:"60px 0",color:"var(--text-3)"}}>
          <div style={{fontSize:48,opacity:.15,marginBottom:12}}>📋</div>
          <div style={{fontSize:14}}>
            {isReadOnly ? "Nenhum quadro criado neste dia." : "Nenhum quadro ainda. Clique em + Novo quadro."}
          </div>
        </div>
      ) : (
        <div style={{
          display:"grid",
          gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",
          gap:14,
        }}>
          {displayBoards.map((board, idx) => (
            <div key={board.id}
              onClick={()=>{ setViewCard({board, mode, dayKey: historyDay||today}); setUpdateText(""); }}
              style={{
                background:"var(--bg-card)",
                border:"1px solid var(--border)",
                borderTop:`4px solid ${CARD_COLORS[idx%CARD_COLORS.length]}`,
                borderRadius:14, padding:20, cursor:"pointer",
                transition:"transform .15s, box-shadow .15s",
                display:"flex", flexDirection:"column", gap:10,
                boxShadow:"0 2px 8px #0001",
              }}
              onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 8px 24px #0002";}}
              onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="0 2px 8px #0001";}}>

              {/* Header */}
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:8}}>
                <h3 style={{margin:0,fontSize:15,fontWeight:800,color:"var(--text-1)",lineHeight:1.3}}>
                  {board.title}
                </h3>
                <div style={{width:10,height:10,borderRadius:"50%",background:CARD_COLORS[idx%CARD_COLORS.length],flexShrink:0,marginTop:4}}/>
              </div>

              {/* Text preview */}
              <p style={{margin:0,fontSize:13,color:"var(--text-2)",lineHeight:1.6,
                display:"-webkit-box",WebkitLineClamp:3,WebkitBoxOrient:"vertical",overflow:"hidden"}}>
                {board.text || <span style={{opacity:.4,fontStyle:"italic"}}>Sem conteúdo</span>}
              </p>

              {/* Footer */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:"auto",paddingTop:10,borderTop:"1px solid var(--border)"}}>
                <span style={{fontSize:10,color:"var(--text-3)"}}>
                  {board.updates?.length>0
                    ? `Atualizado ${fmtDt(board.updatedAt)}`
                    : `Criado ${fmtDt(board.createdAt)}`}
                </span>
                {board.updates?.length>0 && (
                  <span style={{fontSize:10,color:"var(--accent)",background:"var(--accent-dim)",borderRadius:8,padding:"2px 8px"}}>
                    {board.updates.length} atualiz.
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── ADD MODAL ── */}
      {addOpen && (
        <Modal title={`Novo quadro — ${mode==="fixed"?"Fixo":"Dia de hoje"}`} onClose={()=>setAddOpen(false)}>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div>
              <label style={{fontSize:11,color:"var(--text-3)",letterSpacing:2,fontWeight:700,display:"block",marginBottom:6}}>TÍTULO</label>
              <input autoFocus style={inp} placeholder="Ex: Projeto X, Reflexão, Ideia..." value={form.title}
                onChange={e=>setForm({...form,title:e.target.value})}
                onKeyDown={e=>{if(e.key==="Enter")document.getElementById("temas-text-area")?.focus();}}/>
            </div>
            <div>
              <label style={{fontSize:11,color:"var(--text-3)",letterSpacing:2,fontWeight:700,display:"block",marginBottom:6}}>CONTEÚDO</label>
              <textarea id="temas-text-area" style={{...inp,resize:"vertical",minHeight:120}} placeholder="Descreva, anote, reflita..."
                value={form.text} onChange={e=>setForm({...form,text:e.target.value})}/>
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <button onClick={()=>setAddOpen(false)} style={{...btn("var(--bg-input)"),color:"var(--text-2)"}}>Cancelar</button>
              <button onClick={handleAdd} style={{...btn(),padding:"10px 24px",fontWeight:700}}
                disabled={!form.title.trim()}>
                Criar quadro
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── VIEW / EDIT MODAL ── */}
      {viewCard && (
        <Modal title={viewCard.board.title} onClose={()=>{setViewCard(null);setUpdateText("");}}>
          <div style={{display:"flex",flexDirection:"column",gap:16}}>

            {/* Meta */}
            <div style={{display:"flex",gap:12,fontSize:10,color:"var(--text-3)",flexWrap:"wrap"}}>
              <span>📅 Criado: {fmtDt(viewCard.board.createdAt)}</span>
              {viewCard.board.updates?.length>0 && <span>✏️ Atualizado: {fmtDt(viewCard.board.updatedAt)}</span>}
              <span style={{background:"var(--bg-sub)",borderRadius:8,padding:"2px 8px",color:"var(--text-2)"}}>
                {viewCard.mode==="fixed"?"📌 Fixo":"🗓 Dia"}
              </span>
            </div>

            {/* Main text */}
            <div style={{background:"var(--bg-sub)",borderRadius:12,padding:16,fontSize:14,color:"var(--text-1)",lineHeight:1.8,whiteSpace:"pre-wrap",minHeight:80}}>
              {viewCard.board.text || <span style={{opacity:.4,fontStyle:"italic"}}>Sem conteúdo</span>}
            </div>

            {/* Update history */}
            {viewCard.board.updates?.length>0 && (
              <div>
                <div style={{fontSize:10,color:"var(--accent)",letterSpacing:2,fontWeight:700,marginBottom:10}}>
                  HISTÓRICO DE ATUALIZAÇÕES
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:200,overflowY:"auto"}}>
                  {[...viewCard.board.updates].reverse().map((u,i)=>(
                    <div key={i} style={{background:"var(--bg-input)",borderRadius:10,padding:"10px 14px"}}>
                      <div style={{fontSize:13,color:"var(--text-2)",lineHeight:1.6,whiteSpace:"pre-wrap"}}>{u.text}</div>
                      <div style={{fontSize:10,color:"var(--text-3)",marginTop:4}}>🕐 {fmtDt(u.date)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Add update (only if not read-only history) */}
            {!isReadOnly && (
              <div style={{borderTop:"1px solid var(--border)",paddingTop:16}}>
                <div style={{fontSize:11,color:"var(--text-3)",letterSpacing:2,fontWeight:700,marginBottom:10}}>
                  ADICIONAR ATUALIZAÇÃO
                </div>
                <textarea
                  style={{...inp,resize:"vertical",minHeight:80,marginBottom:10}}
                  placeholder="O que mudou? Adicione uma nota com data e hora automáticas..."
                  value={updateText}
                  onChange={e=>setUpdateText(e.target.value)}
                />
                <button onClick={()=>handleEdit(viewCard.board)}
                  disabled={!updateText.trim()}
                  style={{...btn("var(--green)"),width:"100%",padding:"10px",fontWeight:700}}>
                  Salvar atualização
                </button>
              </div>
            )}

            {/* Delete */}
            {!isReadOnly && (
              <button onClick={()=>handleDel(viewCard.board.id)}
                style={{background:"rgba(220,38,38,0.08)",border:"1px solid rgba(220,38,38,0.25)",
                  borderRadius:10,padding:"8px 16px",color:"var(--red)",fontSize:13,cursor:"pointer"}}>
                🗑 Excluir quadro
              </button>
            )}
          </div>
        </Modal>
      )}

    </div>
  );
}

function DiaryPage() {
  const [active, setActive] = useState("diary");
  const tabs = [
    {id:"dia",       label:"📌 Dia",       color:"#e67e22"},
    {id:"diary",     label:"📓 Diário",    color:"var(--accent)"},
    {id:"temas",     label:"📋 Temas",     color:"#0891b2"},
    {id:"ideas",     label:"💡 Ideias",    color:"var(--purple)"},
    {id:"reminders", label:"🔔 Lembretes", color:"var(--yellow)"},
  ];
  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap"}}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setActive(t.id)}
            style={{background:active===t.id?t.color:"var(--bg-card)",border:`1px solid ${active===t.id?t.color:"var(--border)"}`,borderRadius:24,padding:"10px 24px",color:active===t.id?t.id==="reminders"?"#000":"#fff":"var(--text-2)",fontSize:14,fontWeight:700,cursor:"pointer",transition:"all .2s"}}>
            {t.label}
          </button>
        ))}
      </div>
      <div style={{flex:1,animation:"fadeIn .2s ease",overflow:"hidden"}}>
        {active==="dia"       && <DayBoardPage/>}
        {active==="diary"     && <NoteColumn storageKey="diary" title="Diário" placeholder="O que está em sua mente hoje?" accent="var(--accent)" emoji="📓"/>}
        {active==="temas"     && <TemasPage/>}
        {active==="ideas"     && <IdeasCards/>}
        {active==="reminders" && <RemindersCards/>}
      </div>
    </div>
  );
}

// ─── TASKS PAGE ───────────────────────────────────────────────────────────────
function TasksPage() {
  const [tasks, setTasks, synced] = useKV("tasks_v1",[]);
  const [text, setText]   = useState("");
  const [prio, setPrio]   = useState("normal");
  const [editModal, setEditModal] = useState(null);
  const [addNote, setAddNote] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  const prioColor = {alta:"var(--red)",normal:"var(--accent)",baixa:"var(--text-3)"};
  const prioLabel = {alta:"🔴 Alta",normal:"🔵 Normal",baixa:"⚪ Baixa"};

  const COLS = [
    { id:"todo",    label:"📋 A Fazer",     color:"var(--text-3)" },
    { id:"doing",   label:"⚡ Em Andamento", color:"var(--yellow)" },
    { id:"standby", label:"⏸ Stand By",     color:"var(--purple)" },
    { id:"done",    label:"✅ Concluído",    color:"var(--green)"  },
  ];

  const getStatus = (t) => t.status || (t.done ? "done" : "todo");
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  const save = n => { setTasks(n); };

  const add = () => {
    if (!text.trim()) return;
    const t = { id:Date.now(), text, prio, status:"todo", done:false, date:nowISO(), notes:[], updates:[] };
    const n = [t, ...tasks];
    save(n);
    setText(""); setAddOpen(false);
  };

  const setStatus = (id, status) => {
    const n = tasksRef.current.map(t => t.id===id ? { ...t, status, done: status==="done" } : t);
    save(n);
  };

  const del = (id) => { setTasks(p=>p.filter(t=>t.id!==id)); };

  const addTaskNote = (id) => {
    if (!addNote.trim()) return;
    const note = { text:addNote, date:now() };
    const n = tasksRef.current.map(t => t.id===id ? { ...t, updates:[...(t.updates||[]), note] } : t);
    save(n);
    const updated = n.find(t=>t.id===id);
    DB.update("tasks", { id, updates:updated.updates });
    setEditModal(updated);
    setAddNote("");
  };

  // ════════════════════════════════════════════════════════════════
  // DRAG AND DROP — simplified, reliable: separate "tap" vs "drag"
  // using a ref that is read synchronously (no stale-closure / event-
  // ordering issues). Click handler is NOT used at all — open/drag
  // decision happens entirely inside pointerup.
  // ════════════════════════════════════════════════════════════════
  const [dragId, setDragId]   = useState(null);
  const [overCol, setOverCol] = useState(null);
  const drag = useRef(null); // { id, startX, startY, moved, task }
  const colRefs = useRef({});

  const findColAt = (x, y) => {
    for (const col of COLS) {
      const el = colRefs.current[col.id];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return col.id;
    }
    return null;
  };

  const onCardPointerDown = (e, task) => {
    if (e.button !== undefined && e.button !== 0) return;
    const point = e.touches ? e.touches[0] : e;
    drag.current = { id: task.id, task, startX: point.clientX, startY: point.clientY, moved: false };
  };

  useEffect(() => {
    const onMove = (e) => {
      const d = drag.current; if (!d) return;
      const point = e.touches ? e.touches[0] : e;
      const dx = point.clientX - d.startX, dy = point.clientY - d.startY;
      if (!d.moved && Math.hypot(dx, dy) > 8) {
        d.moved = true;
        setDragId(d.id); // only now show drag visuals — avoids flicker on simple taps
      }
      if (!d.moved) return;
      if (e.cancelable) e.preventDefault();
      const col = findColAt(point.clientX, point.clientY);
      setOverCol(col);
    };

    const onUp = (e) => {
      const d = drag.current;
      if (!d) return;
      if (d.moved) {
        // It was a drag — drop into the column under the pointer
        if (overCol && getStatus(d.task) !== overCol) {
          setStatus(d.id, overCol);
        }
      } else {
        // It was a tap/click — open the modal
        const fresh = tasksRef.current.find(t => t.id === d.id) || d.task;
        setEditModal(fresh);
      }
      drag.current = null;
      setDragId(null);
      setOverCol(null);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    window.addEventListener('touchcancel', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
      window.removeEventListener('touchcancel', onUp);
    };
  }, [overCol]);

  const grouped = { todo:[], doing:[], standby:[], done:[] };
  tasks.forEach(t => { const s = getStatus(t); (grouped[s] || grouped.todo).push(t); });

  const TaskCard = ({ t }) => {
    const isDragging = dragId === t.id;
    return (
      <div
        onMouseDown={e => onCardPointerDown(e, t)}
        onTouchStart={e => onCardPointerDown(e, t)}
        style={{
          background:"var(--bg-card)",
          border:`1px solid ${prioColor[t.prio]}33`,
          borderLeft:`3px solid ${prioColor[t.prio]}`,
          borderRadius:10, padding:"12px 14px", marginBottom:10,
          cursor: isDragging ? "grabbing" : "pointer",
          opacity: isDragging ? 0.4 : 1,
          touchAction:"none", userSelect:"none",
          transition: isDragging ? "none" : "opacity .15s",
          boxShadow: isDragging ? "0 8px 24px #0003" : "0 1px 4px #0001",
        }}
      >
        <p style={{margin:0,fontSize:13,color:"var(--text-1)",lineHeight:1.5,marginBottom:8,pointerEvents:"none"}}>{t.text}</p>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:10,color:"var(--text-3)",pointerEvents:"none"}}>
          <span style={{color:prioColor[t.prio],fontWeight:700}}>{prioLabel[t.prio]}</span>
          <span>{new Date(t.date).toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})}</span>
        </div>
        {t.updates?.length>0 && <div style={{fontSize:10,color:"var(--accent)",marginTop:6,pointerEvents:"none"}}>💬 {t.updates.length}</div>}
      </div>
    );
  };

  return (
    <div>
      {/* Add task bar */}
      <div style={{ background:"var(--bg-card)", border:"1px solid var(--border)", borderRadius:14, padding:16, marginBottom:18 }}>
        {!addOpen ? (
          <button onClick={()=>setAddOpen(true)} style={{...btn(),display:"flex",alignItems:"center",gap:8,width:"100%",justifyContent:"center"}}>
            <Icon path={I.plus} size={14}/> Nova Tarefa
          </button>
        ) : (
          <div>
            <textarea autoFocus value={text} onChange={e=>setText(e.target.value)} placeholder="Descreva a tarefa..." rows={2}
              style={{...inp,resize:"none",marginBottom:12}} onKeyDown={e=>{if(e.ctrlKey&&e.key==="Enter")add();}}/>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
              <div style={{display:"flex",gap:8}}>
                {["alta","normal","baixa"].map(p=>(
                  <button key={p} onClick={()=>setPrio(p)} style={{background:prio===p?prioColor[p]+"22":"var(--bg-input)",border:`1px solid ${prio===p?prioColor[p]:"var(--border)"}`,borderRadius:20,padding:"5px 12px",color:prio===p?prioColor[p]:"var(--text-3)",fontSize:11,fontWeight:700,cursor:"pointer"}}>{prioLabel[p]}</button>
                ))}
              </div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>setAddOpen(false)} style={{...btn("var(--bg-input)"),color:"var(--text-2)",padding:"8px 16px"}}>Cancelar</button>
                <button onClick={add} style={{...btn(),padding:"8px 20px"}}>+ Adicionar</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Kanban board */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:14 }} className="kanban-grid">
        {COLS.map(col => (
          <div key={col.id} ref={el => colRefs.current[col.id]=el}
            style={{
              background: overCol===col.id ? "var(--accent-dim)" : "var(--bg-sub)",
              border: `2px ${overCol===col.id ? "dashed var(--accent)" : "solid var(--border)"}`,
              borderRadius:14, padding:14, minHeight:300,
              transition:"background .15s, border-color .15s",
              display:"flex", flexDirection:"column",
            }}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,paddingBottom:10,borderBottom:"1px solid var(--border)"}}>
              <span style={{fontSize:13,fontWeight:800,color:col.color}}>{col.label}</span>
              <span style={{fontSize:11,color:"var(--text-3)",background:"var(--bg-input)",borderRadius:10,padding:"2px 8px"}}>{grouped[col.id].length}</span>
            </div>
            <div style={{flex:1}}>
              {grouped[col.id].map(t => <TaskCard key={t.id} t={t}/>)}
              {grouped[col.id].length===0 && (
                <div style={{textAlign:"center",color:"var(--text-3)",fontSize:12,padding:"30px 0",opacity:.6}}>
                  {overCol===col.id ? "Solte aqui" : "Vazio"}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      <style>{`
        @media (max-width: 760px) {
          .kanban-grid { grid-template-columns: 1fr !important; }
          @media (min-width:761px) and (max-width:1100px) {
            .kanban-grid { grid-template-columns: repeat(2,1fr) !important; }
          }
        }
      `}</style>

      {editModal && (
        <Modal title={editModal.text.slice(0,40)+(editModal.text.length>40?"...":"")} onClose={()=>{setEditModal(null);setAddNote("");}}>
          <div style={{marginBottom:16}}>
            <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:12,flexWrap:"wrap"}}>
              {COLS.map(col=>(
                <button key={col.id} onClick={()=>{setStatus(editModal.id,col.id);setEditModal({...editModal,status:col.id,done:col.id==="done"});}}
                  style={{
                    background: getStatus(editModal)===col.id ? col.color+"22" : "var(--bg-input)",
                    border:`1px solid ${getStatus(editModal)===col.id?col.color:"var(--border)"}`,
                    borderRadius:20, padding:"6px 14px", fontSize:12, fontWeight:700,
                    color: getStatus(editModal)===col.id ? col.color : "var(--text-3)",
                    cursor:"pointer",
                  }}>
                  {col.label}
                </button>
              ))}
            </div>
            <span style={{fontSize:11,color:prioColor[editModal.prio],fontWeight:700}}>{prioLabel[editModal.prio]}</span>
            <p style={{color:"var(--text-2)",lineHeight:1.7,fontSize:14,margin:"12px 0 16px"}}>{editModal.text}</p>
            <div style={{fontSize:10,color:"var(--text-3)",marginBottom:16}}>Criada em {new Date(editModal.date).toLocaleString("pt-BR")}</div>

            <div style={{borderTop:"1px solid var(--border)",paddingTop:16}}>
              <div style={{fontSize:10,color:"var(--accent)",letterSpacing:2,fontWeight:700,marginBottom:12}}>ATUALIZAÇÕES</div>
              {(editModal.updates||[]).map((u,i)=>(
                <div key={i} style={{background:"var(--bg-input)",borderRadius:10,padding:"10px 14px",marginBottom:10}}>
                  <div style={{color:"var(--text-2)",fontSize:13,lineHeight:1.6}}>{u.text}</div>
                  <div style={{fontSize:10,color:"var(--text-3)",marginTop:4}}>🕐 {u.date}</div>
                </div>
              ))}
              <div style={{display:"flex",gap:10,marginTop:12}}>
                <textarea style={{...inp,flex:1,resize:"none"}} rows={2} placeholder="Adicionar atualização..." value={addNote} onChange={e=>setAddNote(e.target.value)}/>
                <button onClick={()=>addTaskNote(editModal.id)} style={{...btn("var(--green)"),alignSelf:"flex-end",padding:"10px 16px"}}>+</button>
              </div>
            </div>
            <button onClick={()=>{del(editModal.id);setEditModal(null);}} style={{marginTop:16,background:"rgba(240,112,112,0.1)",border:"1px solid rgba(240,112,112,0.3)",borderRadius:10,padding:"8px 16px",color:"var(--red)",fontSize:13,cursor:"pointer"}}>Excluir tarefa</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── LISTS PAGE ───────────────────────────────────────────────────────────────
function ListsPage() {
  const [lists, setLists, listsSynced] = useKV("lists_v1", []);
  const [modal, setModal] = useState(false);
  const [detail, setDetail] = useState(null);
  const [form, setForm]   = useState({title:"",text:""});
  const [addText, setAddText] = useState("");

  const save = n=>{ setLists(n); };
  const add  = ()=>{
    if(!form.title.trim()) return;
    const l={id:Date.now(),...form,items:[],created:now()};
    save([l,...lists]); setModal(false); setForm({title:"",text:""});
  };
  const addItem = id=>{
    if(!addText.trim()) return;
    const item={id:Date.now(),text:addText,done:false,date:now()};
    const n=lists.map(l=>l.id===id?{...l,items:[...(l.items||[]),item]}:l);
    save(n); setDetail(n.find(l=>l.id===id)); setAddText("");
  };
  const tickItem = (lid,iid)=>{
    const n=lists.map(l=>l.id===lid?{...l,items:l.items.map(i=>i.id===iid?{...i,done:!i.done}:i)}:l);
    save(n); setDetail(n.find(l=>l.id===lid));
  };
  const delList = id=>{ save(lists.filter(l=>l.id!==id)); setDetail(null); };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:20}}>
        <button onClick={()=>setModal(true)} style={{...btn(),display:"flex",alignItems:"center",gap:6}}><Icon path={I.plus} size={14}/> Nova Lista</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:14}}>
        {lists.map(l=>(
          <div key={l.id} onClick={()=>setDetail(l)} style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:14,padding:16,cursor:"pointer"}}>
            <div style={{fontWeight:700,fontSize:15,marginBottom:6}}>📋 {l.title}</div>
            {l.text&&<p style={{fontSize:12,color:"var(--text-3)",marginBottom:8,lineHeight:1.5}}>{l.text.slice(0,80)}{l.text.length>80?"...":""}</p>}
            <div style={{fontSize:11,color:"var(--text-3)"}}>{l.items?.length||0} itens · {l.created}</div>
          </div>
        ))}
      </div>
      {lists.length===0&&<Empty text="Nenhuma lista ainda. Crie a primeira!"/>}

      {modal&&(
        <Modal title="Nova Lista" onClose={()=>setModal(false)}>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <input style={inp} placeholder="Título da lista" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/>
            <textarea style={{...inp,resize:"vertical"}} rows={4} placeholder="Descrição / conteúdo inicial..." value={form.text} onChange={e=>setForm({...form,text:e.target.value})}/>
            <button onClick={add} style={btn()}>Criar Lista</button>
          </div>
        </Modal>
      )}

      {detail&&(
        <Modal title={detail.title} onClose={()=>setDetail(null)} wide>
          {detail.text&&<p style={{color:"var(--text-2)",lineHeight:1.7,fontSize:14,marginBottom:16}}>{detail.text}</p>}
          <div style={{marginBottom:16}}>
            {(detail.items||[]).map(item=>(
              <div key={item.id} style={{display:"flex",gap:10,alignItems:"center",padding:"8px 0",borderBottom:"1px solid var(--border-2)"}}>
                <button onClick={()=>tickItem(detail.id,item.id)} style={{width:20,height:20,borderRadius:5,border:`2px solid ${item.done?"var(--green)":"var(--border)"}`,background:item.done?"var(--green)":"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  {item.done&&<Icon path={I.check} size={11} color="#fff"/>}
                </button>
                <span style={{flex:1,fontSize:14,color:"var(--text-1)",textDecoration:item.done?"line-through":"none",opacity:item.done?0.6:1}}>{item.text}</span>
                <span style={{fontSize:10,color:"var(--text-3)"}}>{item.date}</span>
              </div>
            ))}
          </div>
          <div style={{display:"flex",gap:10}}>
            <input style={{...inp,flex:1}} placeholder="Adicionar item..." value={addText} onChange={e=>setAddText(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")addItem(detail.id);}}/>
            <button onClick={()=>addItem(detail.id)} style={{...btn("var(--green)"),padding:"10px 16px"}}>+</button>
          </div>
          <button onClick={()=>delList(detail.id)} style={{marginTop:16,background:"rgba(240,112,112,0.08)",border:"1px solid rgba(240,112,112,0.25)",borderRadius:10,padding:"8px 16px",color:"var(--red)",fontSize:13,cursor:"pointer"}}>Excluir lista</button>
        </Modal>
      )}
    </div>
  );
}

// ─── WEATHER PAGE ─────────────────────────────────────────────────────────────
function WeatherPage() {
  const w = useWeather();
  if(!w) return <div style={{textAlign:"center",padding:"60px 0",color:"var(--text-3)",fontSize:14}}>📍 Obtendo localização...</div>;
  if(w.error) return <div style={{textAlign:"center",padding:"60px 0",color:"var(--text-3)",fontSize:14}}>⚠️ {w.error}</div>;
  return (
    <div style={{maxWidth:600,margin:"0 auto"}}>
      <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:20,padding:32,textAlign:"center",marginBottom:20}}>
        <div style={{fontSize:64,marginBottom:8}}>{w.desc?.split(" ")[0]||"🌡"}</div>
        <div style={{fontSize:72,fontWeight:800,color:"var(--accent)",fontFamily:"'DM Mono',monospace"}}>{w.temp}{w.unit}</div>
        <div style={{fontSize:18,color:"var(--text-2)",marginTop:8}}>{w.desc?.split(" ").slice(1).join(" ")}</div>
        <div style={{fontSize:14,color:"var(--text-3)",marginTop:6}}>📍 {w.city||"Carregando..."}</div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:14,padding:20,textAlign:"center"}}>
          <div style={{fontSize:11,color:"var(--text-3)",letterSpacing:1.5,fontWeight:700,marginBottom:8}}>UMIDADE</div>
          <div style={{fontSize:32,fontWeight:800,color:"var(--text-1)"}}>{w.humidity}%</div>
        </div>
        <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:14,padding:20,textAlign:"center"}}>
          <div style={{fontSize:11,color:"var(--text-3)",letterSpacing:1.5,fontWeight:700,marginBottom:8}}>VENTO</div>
          <div style={{fontSize:32,fontWeight:800,color:"var(--text-1)"}}>{w.wind} <span style={{fontSize:14}}>km/h</span></div>
        </div>
      </div>
    </div>
  );
}

// ─── DOCS PAGE ────────────────────────────────────────────────────────────────
function DocsPage() {
  const [docs, setDocs, synced] = useKV("docs_v1",[]);
  const [modal, setModal] = useState(false);
  const [form, setForm]   = useState({name:"",cat:"Pessoal",tags:"",notes:""});
  const [filter, setFilter] = useState("Todos");
  const [fileData, setFileData] = useState(null); // {name,size,type,data:base64}
  const [fileName, setFileName] = useState("");
  const fileRef = useRef(null);
  const [editingId, setEditingId] = useState(null);
  const [downloading, setDownloading] = useState(null); // id being downloaded
  const cats = ["Pessoal","Financeiro","Saúde","Legal","Trabalho","Outros"];
  const icons = {pdf:"📕",doc:"📘",docx:"📘",xls:"📗",xlsx:"📗",png:"🖼️",jpg:"🖼️",jpeg:"🖼️",default:"📄"};
  const getIcon = n=>{ const e=n.split(".").pop().toLowerCase(); return icons[e]||icons.default; };

  const handleFile = e=>{
    const file=e.target.files[0]; if(!file) return;
    setFileName(file.name);
    if(!form.name) setForm(f=>({...f,name:file.name.replace(/\.[^.]+$/,"")}));
    const reader=new FileReader();
    reader.onload=ev=>setFileData({name:file.name,size:file.size,type:file.type,data:ev.target.result});
    reader.readAsDataURL(file);
  };

  const add = async ()=>{
    if(!form.name.trim()) return;
    const tags = form.tags.split(",").map(t=>t.trim()).filter(Boolean);
    if(editingId) {
      // Se trocou o arquivo, salva novo na nuvem
      if(fileData && fileData.data) {
        await KV.set("doc_file_"+editingId, fileData.data);
      }
      const n=docs.map(d=>d.id===editingId?{...d,...form,tags,
        hasFile:!!(fileData||d.hasFile),
        fileName:fileData?.name||d.fileName,
        fileSize:fileData?.size||d.fileSize,
        fileType:fileData?.type||d.fileType,
      }:d);
      setDocs(n);
    } else {
      const id=Date.now();
      // Salva arquivo em chave separada para não sobrecarregar a lista
      if(fileData?.data) {
        await KV.set("doc_file_"+id, fileData.data);
      }
      const doc={id,date:now(),...form,tags,
        hasFile:!!fileData?.data,
        fileName:fileData?.name||"",
        fileSize:fileData?.size||0,
        fileType:fileData?.type||"",
      };
      setDocs([doc,...docs]);
    }
    setModal(false); setEditingId(null);
    setForm({name:"",cat:"Pessoal",tags:"",notes:""});
    setFileData(null); setFileName("");
  };

  const del = id=>{
    setDocs(p=>p.filter(d=>d.id!==id));
    KV.del("doc_file_"+id); // apaga arquivo da nuvem também
  };

  const edit = id=>{
    const d=docs.find(d=>d.id===id);
    if(!d) return;
    setForm({name:d.name,cat:d.cat,tags:Array.isArray(d.tags)?d.tags.join(", "):"",notes:d.notes||""});
    // Arquivo será re-carregado na hora do download, não precisa pré-carregar aqui
    setFileData(null); setFileName(d.fileName||"");
    setEditingId(id); setModal(true);
  };

  // Download: busca o base64 da chave separada na nuvem
  const download = async (doc)=>{
    if(!doc.hasFile) return;
    setDownloading(doc.id);
    try {
      // Tenta primeiro no cache local (se acabou de subir nesta sessão)
      let data = null;
      // Busca da nuvem
      data = await KV.get("doc_file_"+doc.id);
      if(!data) { alert("Arquivo não encontrado na nuvem."); setDownloading(null); return; }
      const a=document.createElement("a");
      a.href=data;
      a.download=doc.fileName||doc.name;
      a.click();
    } catch(e) {
      alert("Erro ao baixar arquivo.");
    }
    setDownloading(null);
  };

  const filtered = filter==="Todos"?docs:docs.filter(d=>d.cat===filter);

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:10}}>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {["Todos",...cats].map(c=>(
            <button key={c} onClick={()=>setFilter(c)} style={{background:filter===c?"var(--accent)":"var(--bg-card)",border:"none",borderRadius:20,padding:"6px 14px",color:filter===c?"#fff":"var(--text-2)",fontSize:12,cursor:"pointer",fontWeight:600}}>{c}</button>
          ))}
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <span style={{fontSize:10,color:synced?"var(--green)":"var(--text-3)"}}>{synced?"☁ sync":"syncing..."}</span>
          <button onClick={()=>setModal(true)} style={{...btn(),display:"flex",alignItems:"center",gap:6}}><Icon path={I.plus} size={14}/> Adicionar</button>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:12}}>
        {filtered.map(d=>(
          <div key={d.id} style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:14,padding:16,position:"relative"}}>
            <div style={{fontSize:28,marginBottom:10}}>{getIcon(d.fileName||d.name)}</div>
            <div style={{fontWeight:700,marginBottom:4,fontSize:14}}>{d.name}</div>
            <div style={{fontSize:11,color:"var(--accent)",marginBottom:6}}>{d.cat}</div>
            {d.notes&&<div style={{fontSize:11,color:"var(--text-3)",marginBottom:6,lineHeight:1.4}}>{d.notes}</div>}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:8}}>
              <span style={{fontSize:10,color:"var(--text-3)"}}>{d.date}</span>
              {d.hasFile&&<button onClick={()=>download(d)} disabled={downloading===d.id} style={{background:"var(--accent-dim)",border:"1px solid var(--accent-bdr)",borderRadius:6,padding:"3px 8px",color:"var(--accent)",fontSize:10,cursor:downloading===d.id?"wait":"pointer",fontWeight:600}}>{downloading===d.id?"⏳...":"⬇ Baixar"}</button>}
            </div>
            <div style={{position:"absolute",top:10,right:10,display:"flex",gap:4}}>
              <button onClick={()=>edit(d.id)} style={{background:"var(--accent-dim)",border:"1px solid var(--accent-bdr)",borderRadius:6,padding:"3px 8px",color:"var(--accent)",fontSize:10,cursor:"pointer"}}>✏️</button>
              <button onClick={()=>del(d.id)} style={{background:"none",border:"none",color:"var(--text-3)",cursor:"pointer"}}><Icon path={I.trash} size={13}/></button>
            </div>
          </div>
        ))}
      </div>
      {filtered.length===0&&<Empty text="Nenhum documento nesta categoria."/>}
      {modal&&(
        <Modal title="Adicionar Documento" onClose={()=>{setModal(false);setFileData(null);setFileName("");}}>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div onClick={()=>fileRef.current?.click()} style={{border:"2px dashed var(--border)",borderRadius:12,padding:"20px",textAlign:"center",cursor:"pointer",background:fileData?"var(--accent-dim)":"transparent"}}>
              <div style={{fontSize:24,marginBottom:8}}>{fileData?"✅":"📎"}</div>
              <div style={{fontSize:13,color:fileData?"var(--accent)":"var(--text-3)"}}>{fileName||"Clique para anexar um arquivo"}</div>
              {fileData&&<div style={{fontSize:10,color:"var(--text-3)",marginTop:4}}>{(fileData.size/1024).toFixed(0)} KB</div>}
              <input ref={fileRef} type="file" style={{display:"none"}} onChange={handleFile}/>
            </div>
            <input style={inp} placeholder="Nome do documento" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/>
            <select style={inp} value={form.cat} onChange={e=>setForm({...form,cat:e.target.value})}>{cats.map(c=><option key={c}>{c}</option>)}</select>
            <input style={inp} placeholder="Tags (separadas por vírgula)" value={form.tags} onChange={e=>setForm({...form,tags:e.target.value})}/>
            <textarea style={{...inp,resize:"vertical"}} rows={2} placeholder="Observações" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/>
            <button onClick={add} style={btn()}>Salvar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── BILLS PAGE ───────────────────────────────────────────────────────────────
function BillsPage() {
  const [bills, setBills, synced] = useKV("bills_v1",[]);
  const [modal, setModal] = useState(false);
  const [form, setForm]   = useState({name:"",value:"",dueDay:"",cat:"Fixo",recurrent:true});
  const cats = ["Fixo","Variável","Cartão","Imposto","Assinatura"];

  const add = ()=>{
    if(!form.name.trim()||!form.dueDay) return;
    const b={id:Date.now(),...form,value:parseFloat(form.value)||0,paid:false};
    const n=[...bills,b]; setBills(n); DB.insert("bills",{...b,due_day:b.dueDay});
    setModal(false); setForm({name:"",value:"",dueDay:"",cat:"Fixo",recurrent:true});
  };
  const toggle = id=>{
    const b=bills.find(b=>b.id===id);
    const n=bills.map(b=>b.id===id?{...b,paid:!b.paid}:b); setBills(n); DB.update("bills",{id,paid:!b.paid});
  };
  const del = id=>{ setBills(p=>p.filter(b=>b.id!==id)); };
  const day = new Date().getDate();
  const upcoming = bills.filter(b=>!b.paid&&+b.dueDay>=day&&+b.dueDay<=day+5);
  const total    = bills.filter(b=>!b.paid).reduce((s,b)=>s+b.value,0);

  return (
    <div>
      {upcoming.length>0&&(
        <div style={{background:"rgba(240,192,64,0.07)",border:"1px solid rgba(240,192,64,0.25)",borderRadius:14,padding:16,marginBottom:20}}>
          <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:10,color:"var(--yellow)",fontWeight:700,fontSize:13}}>
            <Icon path={I.bell} size={16} color="var(--yellow)"/> Vencem em breve ({upcoming.length})
          </div>
          {upcoming.map(b=><div key={b.id} style={{display:"flex",justifyContent:"space-between",fontSize:13,padding:"4px 0"}}><span>{b.name}</span><span style={{color:"var(--yellow)"}}>Dia {b.dueDay} · {fmtMoney(b.value)}</span></div>)}
        </div>
      )}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div style={{color:"var(--text-3)",fontSize:13}}>Total pendente: <span style={{color:"var(--red)",fontWeight:700}}>{fmtMoney(total)}</span></div>
        <button onClick={()=>setModal(true)} style={{...btn(),display:"flex",alignItems:"center",gap:6}}><Icon path={I.plus} size={14}/> Nova Conta</button>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {bills.map(b=>(
          <div key={b.id} style={{background:"var(--bg-card)",border:`1px solid ${b.paid?"var(--border-2)":"var(--border)"}`,borderRadius:12,padding:"14px 18px",display:"flex",alignItems:"center",gap:14,opacity:b.paid?0.5:1}}>
            <button onClick={()=>toggle(b.id)} style={{width:22,height:22,borderRadius:6,border:`2px solid ${b.paid?"var(--green)":"var(--border)"}`,background:b.paid?"var(--green)":"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              {b.paid&&<Icon path={I.check} size={12} color="#fff"/>}
            </button>
            <div style={{flex:1}}>
              <div style={{fontWeight:600,fontSize:14,textDecoration:b.paid?"line-through":"none"}}>{b.name}</div>
              <div style={{fontSize:11,color:"var(--text-3)"}}>{b.cat} · Vence dia {b.dueDay}{b.recurrent?" · Recorrente":""}</div>
            </div>
            <div style={{fontWeight:700,color:b.paid?"var(--green)":"var(--text-1)",fontSize:15,fontFamily:"'DM Mono',monospace"}}>{fmtMoney(b.value)}</div>
            <button onClick={()=>del(b.id)} style={{background:"none",border:"none",color:"var(--text-3)",cursor:"pointer"}}><Icon path={I.trash} size={14}/></button>
          </div>
        ))}
      </div>
      {bills.length===0&&<Empty text="Nenhuma conta cadastrada."/>}
      {modal&&(
        <Modal title="Nova Conta" onClose={()=>setModal(false)}>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <input style={inp} placeholder="Nome da conta" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/>
            <input style={inp} type="number" placeholder="Valor (R$)" value={form.value} onChange={e=>setForm({...form,value:e.target.value})}/>
            <input style={inp} type="number" min="1" max="31" placeholder="Dia do vencimento" value={form.dueDay} onChange={e=>setForm({...form,dueDay:e.target.value})}/>
            <select style={inp} value={form.cat} onChange={e=>setForm({...form,cat:e.target.value})}>{cats.map(c=><option key={c}>{c}</option>)}</select>
            <label style={{display:"flex",gap:10,alignItems:"center",color:"var(--text-2)",fontSize:14,cursor:"pointer"}}>
              <input type="checkbox" checked={form.recurrent} onChange={e=>setForm({...form,recurrent:e.target.checked})}/>
              Conta recorrente (mensal)
            </label>
            <button onClick={add} style={btn()}>Salvar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── EVENTS PAGE ──────────────────────────────────────────────────────────────
function EventsPage() {
  const [events, setEvents, synced] = useKV("events_v1",[]);
  const [modal, setModal] = useState(false);
  const [form, setForm]   = useState({title:"",date:"",time:"",local:"",cat:"Pessoal",notes:""});
  const cats = ["Pessoal","Médico","Reunião","Viagem","Aniversário","Outros"];
  const catColors = {Pessoal:"var(--accent)",Médico:"var(--red)",Reunião:"var(--purple)",Viagem:"var(--green)",Aniversário:"var(--yellow)",Outros:"var(--text-3)"};

  const add = ()=>{
    if(!form.title.trim()||!form.date) return;
    const e={id:Date.now(),...form};
    const n=[...events,e].sort((a,b)=>new Date(a.date+"T"+(a.time||"00:00"))-new Date(b.date+"T"+(b.time||"00:00")));
    setEvents(n); DB.insert("events",e);
    setModal(false); setForm({title:"",date:"",time:"",local:"",cat:"Pessoal",notes:""});
  };
  const del = id=>{ setEvents(p=>p.filter(e=>e.id!==id)); };
  const todayStr = new Date().toISOString().split("T")[0];

  const Card = ({e})=>(
    <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,padding:"14px 18px",display:"flex",gap:14,alignItems:"flex-start",marginBottom:10}}>
      <div style={{width:4,borderRadius:4,background:catColors[e.cat]||"var(--accent)",alignSelf:"stretch",flexShrink:0}}/>
      <div style={{flex:1}}>
        <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>{e.title}</div>
        <div style={{fontSize:12,color:"var(--text-3)"}}>📅 {new Date(e.date+"T12:00").toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"})}{e.time&&` · ⏰ ${e.time}`}{e.local&&` · 📍 ${e.local}`}</div>
        {e.notes&&<div style={{fontSize:12,color:"var(--text-2)",marginTop:6}}>{e.notes}</div>}
      </div>
      <button onClick={()=>del(e.id)} style={{background:"none",border:"none",color:"var(--text-3)",cursor:"pointer"}}><Icon path={I.trash} size={14}/></button>
    </div>
  );

  return (
    <div>
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:20}}>
        <button onClick={()=>setModal(true)} style={{...btn(),display:"flex",alignItems:"center",gap:6}}><Icon path={I.plus} size={14}/> Novo Compromisso</button>
      </div>
      {events.filter(e=>e.date>=todayStr).length>0&&<>
        <div style={{fontSize:11,color:"var(--accent)",letterSpacing:2,fontWeight:700,marginBottom:14,paddingBottom:8,borderBottom:"1px solid var(--border-2)"}}>PRÓXIMOS</div>
        {events.filter(e=>e.date>=todayStr).map(e=><Card key={e.id} e={e}/>)}
      </>}
      {events.filter(e=>e.date<todayStr).length>0&&<>
        <div style={{fontSize:11,color:"var(--text-3)",letterSpacing:2,fontWeight:700,margin:"20px 0 14px",paddingBottom:8,borderBottom:"1px solid var(--border-2)"}}>PASSADOS</div>
        {events.filter(e=>e.date<todayStr).map(e=><Card key={e.id} e={e}/>)}
      </>}
      {events.length===0&&<Empty text="Nenhum compromisso cadastrado."/>}
      {modal&&(
        <Modal title="Novo Compromisso" onClose={()=>setModal(false)}>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <input style={inp} placeholder="Título" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/>
            <input style={inp} type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/>
            <input style={inp} type="time" value={form.time} onChange={e=>setForm({...form,time:e.target.value})}/>
            <input style={inp} placeholder="Local (opcional)" value={form.local} onChange={e=>setForm({...form,local:e.target.value})}/>
            <select style={inp} value={form.cat} onChange={e=>setForm({...form,cat:e.target.value})}>{cats.map(c=><option key={c}>{c}</option>)}</select>
            <textarea style={{...inp,resize:"vertical"}} rows={3} placeholder="Observações" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/>
            <button onClick={add} style={btn()}>Salvar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── WHITEBOARD ───────────────────────────────────────────────────────────────
function WhiteboardCanvas({ boardId }) {
  const canvasRef = useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [color, setColor]     = useState("#3a8fd4");
  const [size, setSize]       = useState(3);
  const [tool, setTool]       = useState("pen");
  const last    = useRef(null);
  const history = useRef([]);
  const storKey = `whiteboard_${boardId}`;

  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    canvas.width=canvas.offsetWidth;
    canvas.height=Math.max(600, window.innerHeight-300);
    const ctx=canvas.getContext("2d");
    ctx.fillStyle="#091828"; ctx.fillRect(0,0,canvas.width,canvas.height);
    // Try cloud first, fall back to localStorage
    KV.get(storKey).then(cloud => {
      const src = cloud || localStorage.getItem(storKey);
      if(src){ const img=new Image(); img.onload=()=>ctx.drawImage(img,0,0); img.src=src; }
    });
  },[boardId]);

  const getPos=e=>{ const r=canvasRef.current.getBoundingClientRect(); const src=e.touches?e.touches[0]:e; return [src.clientX-r.left,src.clientY-r.top]; };

  const startDraw=e=>{
    // Save snapshot for undo
    history.current.push(canvasRef.current.toDataURL());
    if(history.current.length>20) history.current.shift();
    setDrawing(true); last.current=getPos(e);
  };
  const endDraw=()=>{
    setDrawing(false); last.current=null;
    const dataUrl = canvasRef.current.toDataURL();
    localStorage.setItem(storKey, dataUrl);
    KV.set(storKey, dataUrl);
  };
  const draw=e=>{
    if(!drawing||!last.current) return;
    e.preventDefault();
    const canvas=canvasRef.current, ctx=canvas.getContext("2d");
    const [x,y]=getPos(e);
    ctx.beginPath(); ctx.moveTo(last.current[0],last.current[1]); ctx.lineTo(x,y);
    ctx.strokeStyle=tool==="eraser"?"#091828":color;
    ctx.lineWidth=tool==="eraser"?size*8:size;
    ctx.lineCap="round"; ctx.stroke();
    last.current=[x,y];
  };
  const undo=()=>{
    if(!history.current.length) return;
    const prev=history.current.pop();
    const img=new Image(); img.onload=()=>{ const ctx=canvasRef.current.getContext("2d"); ctx.drawImage(img,0,0); }; img.src=prev;
    localStorage.setItem(storKey, prev);
    KV.set(storKey, prev);
  };
  const clear=()=>{
    history.current.push(canvasRef.current.toDataURL());
    const canvas=canvasRef.current, ctx=canvas.getContext("2d");
    ctx.fillStyle="#091828"; ctx.fillRect(0,0,canvas.width,canvas.height);
    localStorage.setItem(storKey, canvas.toDataURL());
  };
  const colors=["#3a8fd4","#f07070","#2ecc8a","#f0c040","#a070e0","#f09050","#ffffff","#7ab0d8"];

  return (
    <div>
      <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:12,flexWrap:"wrap",background:"var(--bg-card)",padding:"10px 16px",borderRadius:12,border:"1px solid var(--border)"}}>
        <div style={{display:"flex",gap:6}}>
          {[["pen","✏️"],["eraser","🧹"]].map(([t,l])=>(
            <button key={t} onClick={()=>setTool(t)} style={{background:tool===t?"var(--accent)":"var(--bg-input)",border:"none",borderRadius:8,padding:"6px 12px",color:tool===t?"#fff":"var(--text-2)",fontSize:12,cursor:"pointer",fontWeight:600}}>{l} {t==="pen"?"Caneta":"Borracha"}</button>
          ))}
        </div>
        <div style={{display:"flex",gap:4}}>
          {colors.map(c=><button key={c} onClick={()=>{setColor(c);setTool("pen");}} style={{width:22,height:22,borderRadius:"50%",background:c,border:`2px solid ${color===c?"white":"transparent"}`,cursor:"pointer"}}/>)}
        </div>
        <input type="range" min="1" max="20" value={size} onChange={e=>setSize(+e.target.value)} style={{width:70}}/>
        <span style={{fontSize:11,color:"var(--text-2)"}}>{size}px</span>
        <button onClick={undo} style={{background:"var(--bg-input)",border:"1px solid var(--border)",borderRadius:8,padding:"6px 12px",color:"var(--text-2)",fontSize:12,cursor:"pointer"}}>↩ Desfazer</button>
        <button onClick={clear} style={{background:"rgba(240,112,112,0.1)",border:"1px solid rgba(240,112,112,0.3)",borderRadius:8,padding:"6px 12px",color:"var(--red)",fontSize:12,cursor:"pointer",marginLeft:"auto"}}>🗑 Limpar</button>
      </div>
      <canvas ref={canvasRef} className="wb-canvas"
        style={{width:"100%",borderRadius:12,border:"1px solid var(--border)",touchAction:"none",display:"block"}}
        onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
        onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw}/>
    </div>
  );
}

function WhiteboardPage() {
  const [boards, setBoards, _wbSync] = useKV("wb_boards_v1", [{id:"wb_default",name:"Lousa 1"}]);
  const [active, setActive] = useState("wb_default");

  const newBoard=()=>{
    const id=`wb_${Date.now()}`;
    const name=`Lousa ${boards.length+1}`;
    const n=[...boards,{id,name}]; setBoards(n); setActive(id);
  };
  const delBoard=id=>{
    if(boards.length===1) return;
    localStorage.removeItem(`whiteboard_${id}`);
    KV.del(`whiteboard_${id}`);
    const n=boards.filter(b=>Number(b.id)!==Number(id)); setBoards(n);
    setActive(n[n.length-1].id);
  };

  return (
    <div>
      {/* Board tabs */}
      <div style={{display:"flex",gap:6,marginBottom:16,alignItems:"center",flexWrap:"wrap"}}>
        {boards.map(b=>(
          <div key={b.id} style={{display:"flex",alignItems:"center",gap:4,background:active===b.id?"var(--accent)":"var(--bg-card)",borderRadius:20,padding:"5px 12px",cursor:"pointer",border:`1px solid ${active===b.id?"var(--accent)":"var(--border)"}`}}
            onClick={()=>setActive(b.id)}>
            <span style={{fontSize:12,fontWeight:600,color:active===b.id?"#fff":"var(--text-2)"}}>{b.name}</span>
            {boards.length>1&&<button onClick={e=>{e.stopPropagation();delBoard(b.id);}} style={{background:"none",border:"none",color:active===b.id?"rgba(255,255,255,0.6)":"var(--text-3)",cursor:"pointer",fontSize:12,lineHeight:1}}>×</button>}
          </div>
        ))}
        <button onClick={newBoard} style={{background:"var(--bg-input)",border:"1px solid var(--border)",borderRadius:20,padding:"5px 14px",color:"var(--text-2)",fontSize:12,cursor:"pointer"}}>+ Nova Lousa</button>
      </div>
      <WhiteboardCanvas key={active} boardId={active}/>
    </div>
  );
}

// ─── TRADINGVIEW WIDGET ───────────────────────────────────────────────────────
function TVWidget({ type, config, height=400 }) {
  const ref = useRef(null);
  useEffect(()=>{
    if(!ref.current) return;
    ref.current.innerHTML="";
    const script=document.createElement("script");
    script.src=`https://s3.tradingview.com/external-embedding/embed-widget-${type}.js`;
    script.async=true;
    script.innerHTML=JSON.stringify({...config,width:"100%",height});
    ref.current.appendChild(script);
  },[type]);
  return <div ref={ref} style={{width:"100%",height,minHeight:height}}><div className="tradingview-widget-container__widget" style={{width:"100%",height:"100%"}}/></div>;
}

function TVCard({ title, children }) {
  return (
    <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:14,overflow:"hidden"}}>
      {title&&<div style={{padding:"10px 16px",background:"var(--bg-bar)",borderBottom:"1px solid var(--border)",fontSize:10,fontWeight:800,color:"var(--accent)",letterSpacing:2}}>{title}</div>}
      {children}
    </div>
  );
}

// ─── MARKET & INDICATORS PAGE ─────────────────────────────────────────────────
const NEWS_CATS=["GLOBAL/GEOPOLÍTICA","EUA","BRASIL","ECONOMIA","BOLSA","MOEDA","COMMODITIES","CRIPTO","GUERRAS","TECNOLOGIA","GERAL"];
const gNewsCache={};
async function fetchGNews(mode,q=""){
  const key=mode+q;
  if(gNewsCache[key]&&Date.now()-gNewsCache[key].ts<15*60*1000) return gNewsCache[key].data;
  try{
    const p=new URLSearchParams({mode}); if(q)p.set("q",q);
    const r=await fetch(`/api/gnews?${p}`); const d=await r.json();
    const items=d.items||[]; if(items.length)gNewsCache[key]={data:items,ts:Date.now()};
    return items;
  }catch{return[];}
}
function useGNews(mode,q){
  const [news,setNews]=useState([]); const [loading,setLoading]=useState(true);
  useEffect(()=>{ setLoading(true); setNews([]); fetchGNews(mode,q).then(i=>{setNews(i);setLoading(false);}); },[mode,q]);
  return {news,loading};
}
function fmtTime(d){
  if(!d) return ""; try{
    const diff=Math.floor((Date.now()-new Date(d))/60000);
    if(diff<60) return `há ${diff}min`; if(diff<1440) return `há ${Math.floor(diff/60)}h`;
    return new Date(d).toLocaleDateString("pt-BR");
  }catch{return "";}
}

function NewsBlock({mode,q,label}){
  const {news,loading}=useGNews(mode,q); const [active,setActive]=useState(null);
  return(
    <>
      <TVCard title={label}>
        <div style={{padding:"0 16px"}}>
          {loading?[1,2,3].map(i=><div key={i} style={{padding:"12px 0",borderBottom:"1px solid var(--border-2)"}}><div style={{height:12,background:"var(--border)",borderRadius:4,marginBottom:6,width:"85%"}}/><div style={{height:9,background:"var(--border-2)",borderRadius:4,width:"35%"}}/></div>):
           news.slice(0,5).map((n,i)=>(
            <div key={i} onClick={()=>setActive(n)} style={{padding:"10px 0",borderBottom:i<4?"1px solid var(--border-2)":"none",cursor:"pointer"}}>
              <div style={{fontSize:13,color:"var(--text-1)",lineHeight:1.5,marginBottom:3}}>{n.title}</div>
              <div style={{display:"flex",gap:8,fontSize:10,color:"var(--text-3)"}}><span>{n.src}</span><span>{fmtTime(n.date)}</span></div>
            </div>
           ))
          }
          {!loading&&news.length===0&&<div style={{padding:"16px 0",fontSize:12,color:"var(--text-3)",textAlign:"center"}}>Sem notícias no momento</div>}
        </div>
      </TVCard>
      {active&&<Modal title={active.title} onClose={()=>setActive(null)}>
        <div style={{fontSize:12,color:"var(--text-3)",marginBottom:16}}>{active.src} {active.date&&`· ${fmtTime(active.date)}`}</div>
        <a href={active.link} target="_blank" rel="noreferrer" style={{display:"inline-flex",alignItems:"center",gap:8,background:"var(--accent)",color:"#fff",padding:"10px 18px",borderRadius:10,fontSize:14,fontWeight:700,textDecoration:"none"}}>
          <Icon path={I.link} size={14} color="#fff"/> Ler matéria completa
        </a>
      </Modal>}
    </>
  );
}

function MarketPage() {
  const [tab, setTab] = useState("indicadores");
  const [mkt, setMkt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);

  const fetchMkt = async () => {
    try {
      const r = await fetch("/api/market2");
      const d = await r.json();
      if (!d.error) { setMkt(d); setLastUpdate(new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})); }
    } catch {}
    setLoading(false);
  };

  useEffect(() => { fetchMkt(); const id=setInterval(fetchMkt,60000); return()=>clearInterval(id); }, []);

  const tabs = [
    {id:"indicadores", l:"📊 Indicadores"},
    {id:"cambio",      l:"💱 Câmbio"},
    {id:"commodities", l:"🛢 Commodities"},
    {id:"cripto",      l:"₿ Cripto"},
    {id:"noticias",    l:"📰 Notícias"},
    {id:"calendario",  l:"📅 Calendário"},
    {id:"curiosidades",l:"⭐ Curiosidades"},
  ];

  const Row = ({item}) => (
    <tr style={{borderBottom:"1px solid var(--border)"}}>
      <td style={{padding:"7px 10px",fontSize:13,color:"var(--text-1)",whiteSpace:"nowrap"}}>
        <span style={{marginRight:6}}>{item.flag}</span>{item.name}
      </td>
      <td style={{padding:"7px 10px",fontSize:13,fontWeight:700,color:"var(--text-1)",textAlign:"right",whiteSpace:"nowrap"}}>{item.price}</td>
      <td style={{padding:"7px 10px",fontSize:12,fontWeight:700,textAlign:"right",whiteSpace:"nowrap",
        color:item.up===true?"#22c55e":item.up===false?"#ef4444":"var(--text-3)"}}>{item.chg}</td>
      <td style={{padding:"7px 10px",fontSize:12,fontWeight:700,textAlign:"right",whiteSpace:"nowrap"}}>
        <span style={{background:item.up===true?"#22c55e22":item.up===false?"#ef444422":"var(--bg-input)",
          color:item.up===true?"#22c55e":item.up===false?"#ef4444":"var(--text-3)",
          borderRadius:6,padding:"2px 7px",fontSize:11}}>{item.pct}</span>
      </td>
      <td style={{padding:"7px 10px",fontSize:10,color:"var(--text-3)",textAlign:"right"}}>{item.time}</td>
    </tr>
  );

  const Table = ({title, data}) => (
    <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden"}}>
      <div style={{padding:"10px 14px",borderBottom:"1px solid var(--border)"}}>
        <span style={{fontSize:13,fontWeight:800,color:"var(--text-1)"}}>{title}</span>
      </div>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead>
            <tr style={{background:"var(--bg-sub)"}}>
              {["NOME","ÚLTIMO","VAR.","VAR.%","HORA"].map((h,i)=>(
                <th key={h} style={{padding:"6px 10px",fontSize:10,color:"var(--text-3)",
                  textAlign:i===0?"left":"right",fontWeight:700,letterSpacing:1}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && !data ? [1,2,3,4].map(i=>(
              <tr key={i}><td colSpan={5} style={{padding:"10px 14px"}}>
                <div style={{height:12,background:"var(--bg-sub)",borderRadius:4}}/>
              </td></tr>
            )) : (data||[]).map((item,i)=><Row key={i} item={item}/>)}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div>
      <div style={{display:"flex",gap:6,marginBottom:18,flexWrap:"wrap",alignItems:"center"}}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{
            background:tab===t.id?"var(--accent)":"var(--bg-card)",
            border:`1px solid ${tab===t.id?"var(--accent)":"var(--border)"}`,
            borderRadius:20,padding:"7px 16px",
            color:tab===t.id?"#fff":"var(--text-2)",
            fontSize:12,fontWeight:700,cursor:"pointer",transition:"all .15s",
          }}>{t.l}</button>
        ))}
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8}}>
          {lastUpdate&&<span style={{fontSize:10,color:"var(--text-3)"}}>Atualizado {lastUpdate}</span>}
          <button onClick={fetchMkt} style={{...btn("var(--bg-card)"),border:"1px solid var(--border)",color:"var(--text-2)",padding:"6px 12px",fontSize:11,borderRadius:16}}>↻</button>
        </div>
      </div>

      {tab==="indicadores"&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(380px,1fr))",gap:14}}>
          <Table title="🌎 AMÉRICAS" data={mkt?.americas}/>
          <Table title="🇪🇺 EUROPA"  data={mkt?.europa}/>
          <Table title="🌏 ÁSIA & OCEANIA" data={mkt?.asia}/>
          <Table title="📋 FUTUROS" data={mkt?.futuros}/>
        </div>
      )}

      {tab==="cambio"&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(400px,1fr))",gap:14}}>
          <Table title="💱 CÂMBIO" data={mkt?.cambio}/>
          <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden"}}>
            <div style={{padding:"10px 14px",borderBottom:"1px solid var(--border)"}}>
              <span style={{fontSize:13,fontWeight:800,color:"var(--text-1)"}}>📊 Cross Rates — TradingView</span>
            </div>
            <TVWidget type="forex-cross-rates" height={400} config={{colorTheme:"light",isTransparent:true,locale:"pt_BR",currencies:["USD","BRL","EUR","GBP","JPY","CNY","CHF","AUD","CAD"]}}/>
          </div>
        </div>
      )}

      {tab==="commodities"&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(400px,1fr))",gap:14}}>
          <Table title="🛢 COMMODITIES" data={mkt?.commodities}/>
          <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden"}}>
            <div style={{padding:"10px 14px",borderBottom:"1px solid var(--border)"}}>
              <span style={{fontSize:13,fontWeight:800,color:"var(--text-1)"}}>📈 TradingView</span>
            </div>
            <TVWidget type="market-overview" height={480} config={{colorTheme:"light",locale:"pt_BR",isTransparent:true,tabs:[{title:"Commodities",symbols:[{s:"TVC:GOLD",d:"Ouro"},{s:"TVC:SILVER",d:"Prata"},{s:"TVC:USOIL",d:"Petróleo WTI"},{s:"TVC:UKOIL",d:"Brent"},{s:"CBOT:ZS1!",d:"Soja"},{s:"CBOT:ZC1!",d:"Milho"},{s:"CBOT:ZW1!",d:"Trigo"},{s:"NYMEX:KC1!",d:"Café"}],originalTitle:"Commodities"}]}}/>
          </div>
        </div>
      )}

      {tab==="cripto"&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(400px,1fr))",gap:14}}>
          <Table title="₿ CRIPTOMOEDAS" data={mkt?.cripto}/>
          <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden"}}>
            <div style={{padding:"10px 14px",borderBottom:"1px solid var(--border)"}}>
              <span style={{fontSize:13,fontWeight:800,color:"var(--text-1)"}}>📊 Cripto — TradingView</span>
            </div>
            <TVWidget type="market-overview" height={480} config={{colorTheme:"light",locale:"pt_BR",isTransparent:true,tabs:[{title:"Cripto",symbols:[{s:"BITSTAMP:BTCUSD",d:"Bitcoin"},{s:"BITSTAMP:ETHUSD",d:"Ethereum"},{s:"BINANCE:BNBUSD",d:"BNB"},{s:"BINANCE:SOLUSD",d:"Solana"},{s:"BINANCE:XRPUSD",d:"XRP"},{s:"BINANCE:ADAUSD",d:"Cardano"},{s:"BINANCE:DOGEUSD",d:"Dogecoin"},{s:"BINANCE:AVAXUSD",d:"Avalanche"}],originalTitle:"Cripto"}]}}/>
          </div>
        </div>
      )}

      {tab==="noticias"&&(
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
          <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden"}}>
            <div style={{padding:"10px 14px",borderBottom:"1px solid var(--border)"}}>
              <span style={{fontSize:13,fontWeight:800,color:"var(--text-1)"}}>🌍 Notícias Globais — TradingView</span>
            </div>
            <div className="tradingview-widget-container" style={{height:580}}>
              <div className="tradingview-widget-container__widget" style={{height:"100%"}}/>
              <script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-timeline.js" async>{JSON.stringify({feedMode:"all_symbols",colorTheme:"light",isTransparent:true,displayMode:"regular",width:"100%",height:580,locale:"pt_BR"})}</script>
            </div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden",flex:1}}>
              <div style={{padding:"10px 14px",borderBottom:"1px solid var(--border)"}}>
                <span style={{fontSize:13,fontWeight:800,color:"var(--text-1)"}}>📈 Ibovespa</span>
              </div>
              <div className="tradingview-widget-container" style={{height:270}}>
                <div className="tradingview-widget-container__widget" style={{height:"100%"}}/>
                <script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-timeline.js" async>{JSON.stringify({feedMode:"symbol",symbol:"BMFBOVESPA:IBOV",colorTheme:"light",isTransparent:true,displayMode:"compact",width:"100%",height:270,locale:"pt_BR"})}</script>
              </div>
            </div>
            <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden",flex:1}}>
              <div style={{padding:"10px 14px",borderBottom:"1px solid var(--border)"}}>
                <span style={{fontSize:13,fontWeight:800,color:"var(--text-1)"}}>₿ Bitcoin</span>
              </div>
              <div className="tradingview-widget-container" style={{height:270}}>
                <div className="tradingview-widget-container__widget" style={{height:"100%"}}/>
                <script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-timeline.js" async>{JSON.stringify({feedMode:"symbol",symbol:"BITSTAMP:BTCUSD",colorTheme:"light",isTransparent:true,displayMode:"compact",width:"100%",height:270,locale:"pt_BR"})}</script>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab==="calendario"&&(
        <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden"}}>
          <div style={{padding:"12px 16px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
            <span style={{fontSize:14,fontWeight:800,color:"var(--text-1)"}}>📅 Agenda Econômica — TradingView</span>
            <div style={{display:"flex",gap:8}}>
              <a href="https://br.investing.com/economic-calendar" target="_blank" rel="noreferrer"
                style={{fontSize:11,color:"var(--accent)",textDecoration:"none"}}>Investing.com ↗</a>
              <a href="https://br.tradingview.com/economic-calendar/" target="_blank" rel="noreferrer"
                style={{fontSize:11,color:"var(--accent)",textDecoration:"none"}}>TradingView ↗</a>
            </div>
          </div>
          <div className="tradingview-widget-container" style={{height:600}}>
            <div className="tradingview-widget-container__widget" style={{height:"100%"}}/>
            <script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-events.js" async>{JSON.stringify({
              colorTheme:"light",
              isTransparent:true,
              width:"100%",
              height:600,
              locale:"pt_BR",
              importanceFilter:"0,1",
              countryFilter:"us,eu,gb,br,cn,jp,de,fr,it,ca,au,nz,ch,es"
            })}</script>
          </div>
        </div>
      )}

      {tab==="curiosidades"&&<CuriositiesPage/>}
    </div>
  );
}

// ─── CURIOSITIES PAGE ─────────────────────────────────────────────────────────
function CuriositiesPage() {
  const [cards,setCards,_curSync]=useKV("curiosities_v1",[]);
  const [modal,setModal]=useState(false);
  const [detail,setDetail]=useState(null);
  const [form,setForm]=useState({title:"",content:"",link:"",imageUrl:"",tag:""});
  const [updTxt,setUpdTxt]=useState("");

  const add=()=>{ if(!form.title.trim()) return; const n=[...cards,{id:Date.now(),...form,updates:[],created:now()}]; setCards(n); setModal(false); setForm({title:"",content:"",link:"",imageUrl:"",tag:""}); };
  const addUpdate=id=>{ if(!updTxt.trim()) return; const n=cards.map(c=>c.id===id?{...c,updates:[...c.updates,{text:updTxt,date:now()}]}:c); setCards(n); setDetail(n.find(c=>c.id===id)); setUpdTxt(""); };
  const del=id=>{ setCards(cards.filter(c=>Number(c.id)!==Number(id))); setDetail(null); };

  return(
    <div>
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:20}}>
        <button onClick={()=>setModal(true)} style={{...btn(),display:"flex",alignItems:"center",gap:6}}><Icon path={I.plus} size={14}/> Nova Curiosidade</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:14}}>
        {cards.map(c=>(
          <div key={c.id} onClick={()=>setDetail(c)} style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:16,overflow:"hidden",cursor:"pointer"}}>
            {c.imageUrl&&<div style={{height:120,background:`url(${c.imageUrl}) center/cover`,borderBottom:"1px solid var(--border)"}}/>}
            <div style={{padding:16}}>
              {c.tag&&<span style={{background:"var(--bg-input)",borderRadius:4,padding:"2px 8px",fontSize:10,color:"var(--accent)",fontWeight:700,display:"inline-block",marginBottom:8,letterSpacing:1}}>{c.tag.toUpperCase()}</span>}
              <div style={{fontWeight:700,marginBottom:6,fontSize:14}}>{c.title}</div>
              <div style={{fontSize:12,color:"var(--text-3)",lineHeight:1.5,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{c.content}</div>
              {c.updates.length>0&&<div style={{fontSize:10,color:"var(--accent)",marginTop:8}}>{c.updates.length} atualização(ões)</div>}
            </div>
          </div>
        ))}
      </div>
      {cards.length===0&&<Empty text="Nenhuma curiosidade ainda."/>}
      {modal&&<Modal title="Nova Curiosidade" onClose={()=>setModal(false)} wide>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <input style={inp} placeholder="Título" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/>
          <input style={inp} placeholder="Tag / Categoria" value={form.tag} onChange={e=>setForm({...form,tag:e.target.value})}/>
          <textarea style={{...inp,resize:"vertical"}} rows={5} placeholder="Conteúdo" value={form.content} onChange={e=>setForm({...form,content:e.target.value})}/>
          <input style={inp} placeholder="URL de imagem (opcional)" value={form.imageUrl} onChange={e=>setForm({...form,imageUrl:e.target.value})}/>
          <input style={inp} placeholder="Link de referência (opcional)" value={form.link} onChange={e=>setForm({...form,link:e.target.value})}/>
          <button onClick={add} style={btn()}>Salvar Card</button>
        </div>
      </Modal>}
      {detail&&<Modal title={detail.title} onClose={()=>setDetail(null)} wide>
        {detail.imageUrl&&<img src={detail.imageUrl} alt="" style={{width:"100%",borderRadius:10,marginBottom:16,maxHeight:240,objectFit:"cover"}}/>}
        {detail.tag&&<span style={{background:"var(--bg-input)",borderRadius:4,padding:"2px 8px",fontSize:10,color:"var(--accent)",fontWeight:700,display:"inline-block",marginBottom:12,letterSpacing:1}}>{detail.tag.toUpperCase()}</span>}
        <p style={{color:"var(--text-2)",lineHeight:1.7,fontSize:14,marginBottom:16}}>{detail.content}</p>
        {detail.link&&<a href={detail.link} target="_blank" rel="noreferrer" style={{color:"var(--accent)",fontSize:12,display:"flex",gap:6,alignItems:"center",marginBottom:16}}><Icon path={I.link} size={14}/>{detail.link}</a>}
        <div style={{borderTop:"1px solid var(--border)",paddingTop:16}}>
          <div style={{fontSize:10,color:"var(--text-3)",letterSpacing:2,fontWeight:700,marginBottom:12}}>ATUALIZAÇÕES</div>
          {detail.updates.map((u,i)=><div key={i} style={{background:"var(--bg-input)",borderRadius:10,padding:"10px 14px",marginBottom:10}}><div style={{color:"var(--text-2)",fontSize:13}}>{u.text}</div><div style={{fontSize:10,color:"var(--text-3)",marginTop:4}}>🕐 {u.date}</div></div>)}
          <div style={{display:"flex",gap:10,marginTop:12}}>
            <textarea style={{...inp,flex:1,resize:"none"}} rows={2} placeholder="Adicionar atualização..." value={updTxt} onChange={e=>setUpdTxt(e.target.value)}/>
            <button onClick={()=>addUpdate(detail.id)} style={{...btn("var(--green)"),alignSelf:"flex-end",padding:"10px 16px"}}>+</button>
          </div>
        </div>
        <button onClick={()=>del(detail.id)} style={{marginTop:16,background:"rgba(240,112,112,0.08)",border:"1px solid rgba(240,112,112,0.25)",borderRadius:10,padding:"8px 16px",color:"var(--red)",fontSize:13,cursor:"pointer"}}>Excluir card</button>
      </Modal>}
    </div>
  );
}


// ─── MACRO CARDS PAGE ─────────────────────────────────────────────────────────
function MacroPage() {
  const [cards, setCards, _macSync] = useKV("macro_cards_v1", []);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ title:"", content:"", link:"", tag:"", color:"#1a3d5c" });

  const COLORS = ["#1a3d5c","#2d1a5c","#1a4a2e","#5c2d1a","#1a4a4a","#3d1a1a"];

  const save = n => { setCards(n); };
  const add = () => {
    if(!form.title.trim()) return;
    const c = { id:Date.now(), ...form, created:now(), updates:[] };
    save([c, ...cards]);
    setModal(false); setForm({ title:"", content:"", link:"", tag:"", color:"#1a3d5c" });
  };
  const del = id => save(cards.filter(c => c.id !== id));
  const openEdit = c => { setEditing({...c}); };
  const saveEdit = () => {
    save(cards.map(c => c.id === editing.id ? { ...editing, lastEdit: now() } : c));
    setEditing(null);
  };
  const addUpdate = (id, text) => {
    if(!text.trim()) return;
    const upd = { text, date: now() };
    save(cards.map(c => c.id === id ? { ...c, updates: [...(c.updates||[]), upd] } : c));
  };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div style={{fontSize:12,color:"var(--text-3)"}}>Cards estratégicos, projetos e contexto macro</div>
        <button onClick={()=>setModal(true)} style={{...btn(),display:"flex",alignItems:"center",gap:6}}>
          <Icon path={I.plus} size={14}/> Novo Card
        </button>
      </div>

      <div style={{columns:"320px",columnGap:14}}>
        {cards.map(c => (
          <div key={c.id} style={{breakInside:"avoid",background:c.color||"var(--bg-card)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:14,padding:18,marginBottom:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
              <div style={{flex:1}}>
                {c.tag && <span style={{background:"rgba(255,255,255,0.15)",borderRadius:20,padding:"2px 10px",fontSize:10,color:"rgba(255,255,255,0.8)",fontWeight:700,letterSpacing:1,display:"inline-block",marginBottom:6}}>{c.tag.toUpperCase()}</span>}
                <div style={{fontWeight:700,fontSize:15,color:"#fff"}}>{c.title}</div>
              </div>
              <div style={{display:"flex",gap:6,marginLeft:10}}>
                <button onClick={()=>openEdit(c)} style={{background:"rgba(255,255,255,0.1)",border:"none",borderRadius:8,padding:"5px 8px",color:"rgba(255,255,255,0.7)",fontSize:11,cursor:"pointer"}}>✏️</button>
                <button onClick={()=>del(c.id)} style={{background:"none",border:"none",color:"rgba(255,255,255,0.4)",cursor:"pointer"}}><Icon path={I.trash} size={13}/></button>
              </div>
            </div>
            {c.content && <p style={{fontSize:13,color:"rgba(255,255,255,0.8)",lineHeight:1.7,marginBottom:10,whiteSpace:"pre-wrap"}}>{c.content}</p>}
            {c.link && <a href={c.link} target="_blank" rel="noreferrer" style={{fontSize:11,color:"rgba(255,255,255,0.6)",display:"flex",alignItems:"center",gap:4,marginBottom:8,textDecoration:"none"}}>🔗 {c.link.replace(/https?:\/\//,"").slice(0,40)}</a>}
            {c.updates?.length > 0 && (
              <div style={{borderTop:"1px solid rgba(255,255,255,0.1)",paddingTop:8,marginTop:8}}>
                {c.updates.slice(-2).map((u,i) => (
                  <div key={i} style={{fontSize:11,color:"rgba(255,255,255,0.6)",marginBottom:4}}>
                    <span style={{color:"rgba(255,255,255,0.4)",marginRight:6}}>↳ {u.date}</span>{u.text}
                  </div>
                ))}
              </div>
            )}
            <div style={{fontSize:10,color:"rgba(255,255,255,0.35)",marginTop:8}}>{c.lastEdit||c.created}</div>
          </div>
        ))}
      </div>
      {cards.length===0&&<Empty text="Nenhum card ainda. Crie o primeiro!"/>}

      {modal && <Modal title="Novo Card Macro" onClose={()=>setModal(false)} wide>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <input style={inp} placeholder="Título" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/>
          <input style={inp} placeholder="Tag (ex: Estratégia, Mercado, Projeto)" value={form.tag} onChange={e=>setForm({...form,tag:e.target.value})}/>
          <textarea style={{...inp,resize:"vertical"}} rows={5} placeholder="Conteúdo, contexto, análise..." value={form.content} onChange={e=>setForm({...form,content:e.target.value})}/>
          <input style={inp} placeholder="Link (opcional)" value={form.link} onChange={e=>setForm({...form,link:e.target.value})}/>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <span style={{fontSize:12,color:"var(--text-3)"}}>Cor:</span>
            {COLORS.map(c=><button key={c} onClick={()=>setForm({...form,color:c})} style={{width:24,height:24,borderRadius:6,background:c,border:`2px solid ${form.color===c?"white":"transparent"}`,cursor:"pointer"}}/>)}
          </div>
          <button onClick={add} style={btn()}>Criar Card</button>
        </div>
      </Modal>}

      {editing && <Modal title="Editar Card" onClose={()=>setEditing(null)} wide>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <input style={inp} value={editing.title} onChange={e=>setEditing({...editing,title:e.target.value})}/>
          <input style={inp} value={editing.tag||""} onChange={e=>setEditing({...editing,tag:e.target.value})}/>
          <textarea style={{...inp,resize:"vertical"}} rows={6} value={editing.content||""} onChange={e=>setEditing({...editing,content:e.target.value})}/>
          <input style={inp} placeholder="Link" value={editing.link||""} onChange={e=>setEditing({...editing,link:e.target.value})}/>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <span style={{fontSize:12,color:"var(--text-3)"}}>Cor:</span>
            {COLORS.map(c=><button key={c} onClick={()=>setEditing({...editing,color:c})} style={{width:24,height:24,borderRadius:6,background:c,border:`2px solid ${editing.color===c?"white":"transparent"}`,cursor:"pointer"}}/>)}
          </div>
          <div style={{borderTop:"1px solid var(--border)",paddingTop:14}}>
            <div style={{fontSize:10,color:"var(--text-3)",letterSpacing:2,marginBottom:10,fontWeight:700}}>ADICIONAR ATUALIZAÇÃO</div>
            <UpdateInput onSave={text=>addUpdate(editing.id,text)}/>
          </div>
          <button onClick={saveEdit} style={btn()}>Salvar</button>
        </div>
      </Modal>}
    </div>
  );
}

function UpdateInput({ onSave }) {
  const [text, setText] = useState("");
  return (
    <div style={{display:"flex",gap:10}}>
      <input style={{...inp,flex:1}} placeholder="Adicionar atualização..." value={text} onChange={e=>setText(e.target.value)}
        onKeyDown={e=>{ if(e.key==="Enter"&&text.trim()){ onSave(text); setText(""); } }}/>
      <button onClick={()=>{ if(text.trim()){ onSave(text); setText(""); } }} style={{...btn("var(--green)"),padding:"10px 16px"}}>+</button>
    </div>
  );
}

// ─── FERRAMENTAS / SIMULADORES ────────────────────────────────────────────────
function PortfolioSimulator() {
  const [assets, setAssets, _s1] = useKV("sim_assets_v1", []);
  const [form, setForm] = useState({ name:"", ticker:"", qty:"", price:"", type:"Ação" });
  const types = ["Ação","FII","Cripto","Renda Fixa","ETF","Outro"];

  const save = n => { setAssets(n); };
  const add = () => {
    if(!form.name||!form.qty||!form.price) return;
    save([...assets, { id:Date.now(), ...form, qty:+form.qty, price:+form.price }]);
    setForm({ name:"", ticker:"", qty:"", price:"", type:"Ação" });
  };
  const del = id => save(assets.filter(a => a.id !== id));

  const total = assets.reduce((s,a) => s + a.qty*a.price, 0);
  const byType = types.map(t => ({ type:t, value:assets.filter(a=>a.type===t).reduce((s,a)=>s+a.qty*a.price,0) })).filter(t=>t.value>0);

  return (
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
      {/* Input */}
      <div>
        <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:14,padding:18,marginBottom:16}}>
          <div style={{fontSize:11,color:"var(--accent)",letterSpacing:2,fontWeight:800,marginBottom:14}}>📊 ADICIONAR ATIVO</div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <input style={inp} placeholder="Nome (ex: Petrobras)" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/>
            <input style={inp} placeholder="Ticker (ex: PETR4)" value={form.ticker} onChange={e=>setForm({...form,ticker:e.target.value})}/>
            <div style={{display:"flex",gap:10}}>
              <input style={{...inp,flex:1}} placeholder="Qtd" type="number" value={form.qty} onChange={e=>setForm({...form,qty:e.target.value})}/>
              <input style={{...inp,flex:1}} placeholder="Preço R$" type="number" value={form.price} onChange={e=>setForm({...form,price:e.target.value})}/>
            </div>
            <select style={inp} value={form.type} onChange={e=>setForm({...form,type:e.target.value})}>{types.map(t=><option key={t}>{t}</option>)}</select>
            <button onClick={add} style={btn()}>+ Adicionar</button>
          </div>
        </div>
        {/* Summary */}
        <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:14,padding:18}}>
          <div style={{fontSize:11,color:"var(--accent)",letterSpacing:2,fontWeight:800,marginBottom:14}}>DISTRIBUIÇÃO</div>
          {byType.map(t => (
            <div key={t.type} style={{marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:4}}>
                <span style={{color:"var(--text-2)"}}>{t.type}</span>
                <span style={{fontWeight:700}}>{total>0?((t.value/total)*100).toFixed(1):0}%</span>
              </div>
              <div style={{height:6,background:"var(--bg-input)",borderRadius:3,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${total>0?(t.value/total)*100:0}%`,background:"var(--accent)",borderRadius:3,transition:"width .3s"}}/>
              </div>
            </div>
          ))}
          <div style={{marginTop:14,paddingTop:14,borderTop:"1px solid var(--border)",display:"flex",justifyContent:"space-between"}}>
            <span style={{color:"var(--text-3)",fontSize:13}}>Total carteira</span>
            <span style={{fontWeight:800,fontSize:16,color:"var(--green)",fontFamily:"'DM Mono',monospace"}}>{fmtMoney(total)}</span>
          </div>
        </div>
      </div>
      {/* Asset list */}
      <div>
        <div style={{fontSize:11,color:"var(--text-3)",letterSpacing:2,fontWeight:700,marginBottom:12}}>ATIVOS</div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {assets.map(a => (
            <div key={a.id} style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,padding:"12px 16px",display:"flex",alignItems:"center",gap:12}}>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,fontSize:14}}>{a.ticker||a.name}</div>
                <div style={{fontSize:11,color:"var(--text-3)"}}>{a.type} · {a.qty} cotas · {fmtMoney(a.price)} cada</div>
              </div>
              <div style={{fontWeight:700,color:"var(--green)",fontFamily:"'DM Mono',monospace",fontSize:14}}>{fmtMoney(a.qty*a.price)}</div>
              <button onClick={()=>del(a.id)} style={{background:"none",border:"none",color:"var(--text-3)",cursor:"pointer"}}><Icon path={I.trash} size={14}/></button>
            </div>
          ))}
          {assets.length===0&&<Empty text="Adicione ativos para simular"/>}
        </div>
      </div>
    </div>
  );
}

function CashFlowSimulator() {
  const [items, setItems, _s2] = useKV("sim_cashflow_v1", []);
  const [form, setForm] = useState({ desc:"", value:"", type:"entrada", month:"", recurrent:false });

  const save = n => { setItems(n); };
  const add = () => {
    if(!form.desc||!form.value) return;
    save([...items, { id:Date.now(), ...form, value:+form.value }]);
    setForm({ desc:"", value:"", type:"entrada", month:"", recurrent:false });
  };
  const del = id => save(items.filter(i => i.id !== id));

  const entradas = items.filter(i=>i.type==="entrada").reduce((s,i)=>s+i.value,0);
  const saidas   = items.filter(i=>i.type==="saida").reduce((s,i)=>s+i.value,0);
  const saldo    = entradas - saidas;

  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:20}}>
        {[["Entradas",entradas,"var(--green)","📈"],["Saídas",saidas,"var(--red)","📉"],["Saldo",saldo,saldo>=0?"var(--green)":"var(--red)","💰"]].map(([l,v,c,e])=>(
          <div key={l} style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,padding:"14px 18px",textAlign:"center"}}>
            <div style={{fontSize:20,marginBottom:4}}>{e}</div>
            <div style={{fontSize:11,color:"var(--text-3)",letterSpacing:1,marginBottom:4}}>{l.toUpperCase()}</div>
            <div style={{fontSize:20,fontWeight:800,color:c,fontFamily:"'DM Mono',monospace"}}>{fmtMoney(Math.abs(v))}</div>
          </div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        <div>
          <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:14,padding:18,marginBottom:16}}>
            <div style={{fontSize:11,color:"var(--accent)",letterSpacing:2,fontWeight:800,marginBottom:14}}>ADICIONAR ITEM</div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              <input style={inp} placeholder="Descrição" value={form.desc} onChange={e=>setForm({...form,desc:e.target.value})}/>
              <input style={inp} type="number" placeholder="Valor R$" value={form.value} onChange={e=>setForm({...form,value:e.target.value})}/>
              <select style={inp} value={form.type} onChange={e=>setForm({...form,type:e.target.value})}>
                <option value="entrada">📈 Entrada</option>
                <option value="saida">📉 Saída</option>
              </select>
              <input style={inp} placeholder="Mês (ex: Jan 2026)" value={form.month} onChange={e=>setForm({...form,month:e.target.value})}/>
              <button onClick={add} style={btn()}>+ Adicionar</button>
            </div>
          </div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {items.map(i=>(
            <div key={i.id} style={{background:"var(--bg-card)",border:`1px solid ${i.type==="entrada"?"rgba(46,204,138,0.3)":"rgba(240,112,112,0.3)"}`,borderRadius:12,padding:"12px 16px",display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:18}}>{i.type==="entrada"?"📈":"📉"}</span>
              <div style={{flex:1}}>
                <div style={{fontWeight:600,fontSize:13}}>{i.desc}</div>
                {i.month&&<div style={{fontSize:10,color:"var(--text-3)"}}>{i.month}</div>}
              </div>
              <span style={{fontWeight:700,color:i.type==="entrada"?"var(--green)":"var(--red)",fontFamily:"'DM Mono',monospace",fontSize:14}}>{i.type==="saida"?"-":""}{fmtMoney(i.value)}</span>
              <button onClick={()=>del(i.id)} style={{background:"none",border:"none",color:"var(--text-3)",cursor:"pointer"}}><Icon path={I.trash} size={13}/></button>
            </div>
          ))}
          {items.length===0&&<Empty text="Nenhum item ainda"/>}
        </div>
      </div>
    </div>
  );
}

function ProfessionalPortfolioSim() {
  const [projects, setProjects, _s3] = useKV("sim_portfolio_v1", []);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ name:"", desc:"", status:"Em andamento", client:"", value:"", tags:"" });
  const statuses = ["Em andamento","Concluído","Pausado","Proposta"];
  const statusColor = {"Em andamento":"var(--accent)","Concluído":"var(--green)","Pausado":"var(--yellow)","Proposta":"var(--purple)"};

  const save = n => { setProjects(n); };
  const add = () => {
    if(!form.name) return;
    save([{ id:Date.now(), ...form, value:+form.value||0, tags:form.tags.split(",").map(t=>t.trim()).filter(Boolean), date:now() }, ...projects]);
    setModal(false); setForm({ name:"", desc:"", status:"Em andamento", client:"", value:"", tags:"" });
  };
  const del = id => save(projects.filter(p => p.id !== id));

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div style={{display:"flex",gap:8}}>
          {statuses.map(s => <span key={s} style={{fontSize:11,color:statusColor[s],fontWeight:700}}>{projects.filter(p=>p.status===s).length} {s}</span>)}
        </div>
        <button onClick={()=>setModal(true)} style={{...btn(),display:"flex",alignItems:"center",gap:6}}><Icon path={I.plus} size={14}/> Novo Projeto</button>
      </div>
      <div style={{columns:"300px",columnGap:14}}>
        {projects.map(p => (
          <div key={p.id} style={{breakInside:"avoid",background:"var(--bg-card)",border:`1px solid ${statusColor[p.status]}44`,borderRadius:14,padding:16,marginBottom:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
              <div style={{flex:1}}>
                <span style={{fontSize:10,color:statusColor[p.status],fontWeight:700,letterSpacing:1}}>{p.status.toUpperCase()}</span>
                <div style={{fontWeight:700,fontSize:15,marginTop:2}}>{p.name}</div>
                {p.client&&<div style={{fontSize:11,color:"var(--text-3)"}}>👤 {p.client}</div>}
              </div>
              <button onClick={()=>del(p.id)} style={{background:"none",border:"none",color:"var(--text-3)",cursor:"pointer"}}><Icon path={I.trash} size={13}/></button>
            </div>
            {p.desc&&<p style={{fontSize:13,color:"var(--text-2)",lineHeight:1.6,marginBottom:8}}>{p.desc}</p>}
            {p.value>0&&<div style={{fontSize:13,fontWeight:700,color:"var(--green)",fontFamily:"'DM Mono',monospace",marginBottom:6}}>{fmtMoney(p.value)}</div>}
            {p.tags?.length>0&&<div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
              {p.tags.map(t=><span key={t} style={{background:"var(--bg-input)",borderRadius:4,padding:"2px 8px",fontSize:10,color:"var(--text-3)"}}>{t}</span>)}
            </div>}
          </div>
        ))}
      </div>
      {projects.length===0&&<Empty text="Nenhum projeto no portfólio ainda."/>}
      {modal&&<Modal title="Novo Projeto" onClose={()=>setModal(false)}>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <input style={inp} placeholder="Nome do projeto" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/>
          <input style={inp} placeholder="Cliente" value={form.client} onChange={e=>setForm({...form,client:e.target.value})}/>
          <textarea style={{...inp,resize:"vertical"}} rows={3} placeholder="Descrição" value={form.desc} onChange={e=>setForm({...form,desc:e.target.value})}/>
          <select style={inp} value={form.status} onChange={e=>setForm({...form,status:e.target.value})}>{statuses.map(s=><option key={s}>{s}</option>)}</select>
          <input style={inp} type="number" placeholder="Valor R$" value={form.value} onChange={e=>setForm({...form,value:e.target.value})}/>
          <input style={inp} placeholder="Tags (separadas por vírgula)" value={form.tags} onChange={e=>setForm({...form,tags:e.target.value})}/>
          <button onClick={add} style={btn()}>Adicionar</button>
        </div>
      </Modal>}
    </div>
  );
}

function ToolsPage() {
  const [sim, setSim] = useState("portfolio");
  const sims = [
    { id:"portfolio", label:"📊 Carteira de Investimentos" },
    { id:"cashflow",  label:"💰 Fluxo de Caixa"           },
    { id:"projetos",  label:"🗂 Portfólio Profissional"    },
  ];
  return (
    <div>
      <div style={{display:"flex",gap:6,marginBottom:24,flexWrap:"wrap"}}>
        {sims.map(s=>(
          <button key={s.id} onClick={()=>setSim(s.id)} style={{background:sim===s.id?"var(--accent)":"var(--bg-card)",border:`1px solid ${sim===s.id?"var(--accent)":"var(--border)"}`,borderRadius:24,padding:"9px 20px",color:sim===s.id?"#fff":"var(--text-2)",fontSize:13,fontWeight:700,cursor:"pointer"}}>
            {s.label}
          </button>
        ))}
      </div>
      {sim==="portfolio" && <PortfolioSimulator/>}
      {sim==="cashflow"  && <CashFlowSimulator/>}
      {sim==="projetos"  && <ProfessionalPortfolioSim/>}
    </div>
  );
}

// ─── BEDROCK PAGE ─────────────────────────────────────────────────────────────
function BedrockPage() {
  const [info, setInfo, _brSync] = useKV("bedrock_info_v1", { name:"BEDROCK", desc:"", mission:"", vision:"", site:"", status:"Ativo" });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [notes, setNotes] = useState(() => S.get("bedrock_notes", []));
  const [noteText, setNoteText] = useState("");

  const saveInfo = () => { S.set("bedrock_info", draft); setInfo(draft); setEditing(false); };
  const addNote  = () => {
    if(!noteText.trim()) return;
    const n = [...notes, { id:Date.now(), text:noteText, date:now() }];
    setNotes(n); S.set("bedrock_notes", n); setNoteText("");
  };
  const delNote = id => { const n=notes.filter(n=>n.id!==id); setNotes(n); S.set("bedrock_notes",n); };

  return (
    <div style={{maxWidth:900,margin:"0 auto"}}>
      {/* Header */}
      <div style={{background:"linear-gradient(135deg,#0a1628,#1a3d5c)",border:"1px solid var(--border)",borderRadius:20,padding:28,marginBottom:20,position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:-20,right:-20,fontSize:120,opacity:0.05}}>🪨</div>
        <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:16}}>
          <div style={{width:56,height:56,borderRadius:14,background:"linear-gradient(135deg,#1a78c2,#0a4a8c)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,boxShadow:"0 4px 20px rgba(26,120,194,0.4)"}}>🪨</div>
          <div>
            <div style={{fontSize:26,fontWeight:900,letterSpacing:2,color:"#fff"}}>{info.name||"BEDROCK"}</div>
            <div style={{fontSize:12,color:"rgba(255,255,255,0.5)",letterSpacing:3}}>PROJETO · {info.status||"ATIVO"}</div>
          </div>
          <button onClick={()=>{ setDraft({...info}); setEditing(true); }} style={{marginLeft:"auto",background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:10,padding:"8px 16px",color:"rgba(255,255,255,0.8)",fontSize:12,cursor:"pointer"}}>✏️ Editar</button>
        </div>
        {info.desc&&<p style={{color:"rgba(255,255,255,0.7)",lineHeight:1.7,fontSize:14,marginBottom:12}}>{info.desc}</p>}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          {info.mission&&<div><div style={{fontSize:10,color:"rgba(255,255,255,0.4)",letterSpacing:2,marginBottom:4}}>MISSÃO</div><p style={{color:"rgba(255,255,255,0.8)",fontSize:13,lineHeight:1.6}}>{info.mission}</p></div>}
          {info.vision&&<div><div style={{fontSize:10,color:"rgba(255,255,255,0.4)",letterSpacing:2,marginBottom:4}}>VISÃO</div><p style={{color:"rgba(255,255,255,0.8)",fontSize:13,lineHeight:1.6}}>{info.vision}</p></div>}
        </div>
        {info.site&&<a href={info.site} target="_blank" rel="noreferrer" style={{display:"inline-flex",alignItems:"center",gap:6,marginTop:12,color:"rgba(100,180,255,0.8)",fontSize:12,textDecoration:"none"}}>🔗 {info.site}</a>}
      </div>

      {/* Notes */}
      <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:14,padding:20}}>
        <div style={{fontSize:11,color:"var(--accent)",letterSpacing:2,fontWeight:800,marginBottom:16}}>📋 NOTAS DO PROJETO</div>
        <div style={{display:"flex",gap:10,marginBottom:16}}>
          <textarea style={{...inp,flex:1,resize:"none"}} rows={2} placeholder="Adicionar nota, ideia ou atualização..." value={noteText} onChange={e=>setNoteText(e.target.value)}/>
          <button onClick={addNote} style={{...btn("var(--green)"),alignSelf:"flex-end",padding:"10px 16px"}}>+</button>
        </div>
        <div style={{columns:"280px",columnGap:12}}>
          {notes.map(n=>(
            <div key={n.id} style={{breakInside:"avoid",background:"var(--bg-input)",borderRadius:10,padding:"10px 14px",marginBottom:10}}>
              <p style={{margin:0,color:"var(--text-1)",fontSize:13,lineHeight:1.6,whiteSpace:"pre-wrap"}}>{n.text}</p>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:6}}>
                <span style={{fontSize:10,color:"var(--text-3)"}}>{n.date}</span>
                <button onClick={()=>delNote(n.id)} style={{background:"none",border:"none",color:"var(--text-3)",cursor:"pointer"}}><Icon path={I.trash} size={12}/></button>
              </div>
            </div>
          ))}
          {notes.length===0&&<div style={{color:"var(--text-3)",fontSize:13,textAlign:"center",padding:"20px 0"}}>Nenhuma nota ainda</div>}
        </div>
      </div>

      {editing&&<Modal title="Editar BEDROCK" onClose={()=>setEditing(false)} wide>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <input style={inp} placeholder="Nome" value={draft.name||""} onChange={e=>setDraft({...draft,name:e.target.value})}/>
          <select style={inp} value={draft.status||"Ativo"} onChange={e=>setDraft({...draft,status:e.target.value})}>
            {["Ativo","Em desenvolvimento","Pausado","Lançado"].map(s=><option key={s}>{s}</option>)}
          </select>
          <textarea style={{...inp,resize:"vertical"}} rows={3} placeholder="Descrição do projeto" value={draft.desc||""} onChange={e=>setDraft({...draft,desc:e.target.value})}/>
          <textarea style={{...inp,resize:"vertical"}} rows={2} placeholder="Missão" value={draft.mission||""} onChange={e=>setDraft({...draft,mission:e.target.value})}/>
          <textarea style={{...inp,resize:"vertical"}} rows={2} placeholder="Visão" value={draft.vision||""} onChange={e=>setDraft({...draft,vision:e.target.value})}/>
          <input style={inp} placeholder="Site / URL" value={draft.site||""} onChange={e=>setDraft({...draft,site:e.target.value})}/>
          <button onClick={saveInfo} style={btn()}>Salvar</button>
        </div>
      </Modal>}
    </div>
  );
}

// ─── PROFESSIONAL PAGE ────────────────────────────────────────────────────────
function MenuTile({ color, emoji, label, sub, wide, tall, onClick }) {
  return (
    <div className={`tile${wide?" wide":""}${tall?" tall":""}`}
      style={{background:color}} onClick={onClick}>
      <span className="tile-icon">{emoji}</span>
      <div>
        <div className="tile-label">{label}</div>
        {sub&&<div className="tile-sub">{sub}</div>}
      </div>
    </div>
  );
}

function WeatherTile({ onClick }) {
  const w = useWeather();
  return (
    <div className="tile" style={{background:"var(--tile-weather)"}} onClick={onClick}>
      <span className="tile-live">CLIMA</span>
      <span className="tile-icon">{w?.desc?.split(" ")[0]||"🌡"}</span>
      <div>
        {w&&!w.error
          ? <><div className="tile-label" style={{fontSize:28,fontFamily:"'DM Mono',monospace"}}>{w.temp}{w.unit}</div><div className="tile-sub">{w.city||"..."}</div></>
          : <div className="tile-label">Clima</div>}
      </div>
    </div>
  );
}

function HomePage({ onNavigate }) {
  return (
    <div className="tiles-grid">
      <MenuTile color="var(--tile-diary)"  emoji="📓" label="Diário"       sub="Registros, ideias, lembretes" wide onClick={()=>onNavigate("diary")}/>
      <MenuTile color="var(--tile-tasks)"  emoji="✅" label="Tarefas"      sub="Cards editáveis"              onClick={()=>onNavigate("tasks")}/>
      <MenuTile color="var(--tile-docs)"   emoji="📁" label="Documentos"   sub="Arquivos e anexos"            onClick={()=>onNavigate("docs")}/>
      <MenuTile color="var(--tile-bills)"  emoji="💳" label="Contas"       sub="Vencimentos e pagamentos"     onClick={()=>onNavigate("bills")}/>
      <MenuTile color="var(--tile-events)" emoji="📅" label="Compromissos" sub="Agenda e eventos"             onClick={()=>onNavigate("events")}/>
      <MenuTile color="var(--tile-lists)"  emoji="📋" label="Listas"       sub="Checklists e anotações"       onClick={()=>onNavigate("lists")}/>
      <WeatherTile onClick={()=>onNavigate("weather")}/>
      <MenuTile color="var(--tile-market)" emoji="📈" label="Mercado & Indicadores" sub="Bolsas, câmbio, cripto, notícias" wide onClick={()=>onNavigate("market")}/>
      <MenuTile color="var(--tile-white)"  emoji="🖊️" label="Whiteboard"   sub="Lousa digital"               onClick={()=>onNavigate("whiteboard")}/>
      <MenuTile color="#1a3a2a"             emoji="💻" label=".BAT / Scripts" sub="Automações e comandos"       onClick={()=>onNavigate("bat")}/>
      <MenuTile color="#1a0a2a"             emoji="📺" label="Letreiro"     sub="Mensagem em tela cheia" onClick={()=>onNavigate("letreiro")}/>
    </div>
  );
}


// ─── LETREIRO PAGE ────────────────────────────────────────────────────────────
function LetreirPage() {
  const PRESETS = [
    { label:'Branco',   value:'#ffffff' },
    { label:'Amarelo',  value:'#ffe030' },
    { label:'Ciano',    value:'#00e5ff' },
    { label:'Verde',    value:'#00ff88' },
    { label:'Rosa',     value:'#ff2d78' },
    { label:'Laranja',  value:'#ff8c00' },
    { label:'Roxo',     value:'#c084fc' },
    { label:'Vermelho', value:'#ff4444' },
  ];
  const BG_PRESETS = [
    { label:'Preto',    value:'#000000' },
    { label:'Azul esc', value:'#0d1b2e' },
    { label:'Roxo esc', value:'#1a0a2e' },
    { label:'Verde esc',value:'#0a1e0f' },
    { label:'Vermelho', value:'#1e0505' },
    { label:'Cinza',    value:'#1a1a1a' },
  ];

  const [kvConfig, setKvConfig, kvSynced] = useKV('letreiro_v1', {});

  const [text,     setText]     = useState(kvConfig.text     || 'Bem-vindo ao Painel!');
  const [color,    setColor]    = useState(kvConfig.color    || '#ffe030');
  const [bgColor,  setBgColor]  = useState(kvConfig.bgColor  || '#000000');
  const [fontSize, setFontSize] = useState(kvConfig.fontSize || 96);
  const [speed,    setSpeed]    = useState(kvConfig.speed    || 60);
  const [bold,     setBold]     = useState(kvConfig.bold     ?? true);
  const [italic,   setItalic]   = useState(kvConfig.italic   || false);

  // When cloud config arrives, sync local state
  useEffect(() => {
    if (!kvSynced || !kvConfig || Object.keys(kvConfig).length === 0) return;
    if (kvConfig.text     !== undefined) setText(kvConfig.text);
    if (kvConfig.color    !== undefined) setColor(kvConfig.color);
    if (kvConfig.bgColor  !== undefined) setBgColor(kvConfig.bgColor);
    if (kvConfig.fontSize !== undefined) setFontSize(kvConfig.fontSize);
    if (kvConfig.speed    !== undefined) setSpeed(kvConfig.speed);
    if (kvConfig.bold     !== undefined) setBold(kvConfig.bold);
    if (kvConfig.italic   !== undefined) setItalic(kvConfig.italic);
  }, [kvSynced]);
  const [running,  setRunning]  = useState(false);
  const [draft,    setDraft]    = useState(kvConfig.text  || 'Bem-vindo ao Painel!');

  // fullscreen marquee state
  const [fullscreen, setFullscreen] = useState(false);
  const posRef      = useRef(null);   // pixel position (starts offscreen right)
  const animRef     = useRef(null);
  const spanRef     = useRef(null);
  const lastTimeRef = useRef(null);
  const [pos, setPos] = useState(0);  // left px

  const save = (patch) => {
    const next = { text, color, bgColor, fontSize, speed, bold, italic, ...patch };
    setKvConfig(next);  // syncs to cloud + localStorage via useKV
  };

  const startMarquee = () => {
    save({ text: draft });
    setText(draft);
    setRunning(true);
    setFullscreen(true);
  };

  const stopMarquee = () => {
    setRunning(false);
    setFullscreen(false);
    cancelAnimationFrame(animRef.current);
    lastTimeRef.current = null;
  };

  // Animation loop — runs whenever fullscreen + running
  useEffect(() => {
    if (!fullscreen || !running) return;

    // Init position: start from the right edge of screen
    const screenW = window.innerWidth;
    posRef.current = screenW;
    setPos(screenW);
    lastTimeRef.current = null;

    const tick = (ts) => {
      if (lastTimeRef.current === null) lastTimeRef.current = ts;
      const dt = (ts - lastTimeRef.current) / 1000; // seconds
      lastTimeRef.current = ts;

      const spanW = spanRef.current ? spanRef.current.offsetWidth : 800;
      posRef.current -= speed * dt;

      // Reset when fully off left edge
      if (posRef.current < -spanW - 40) {
        posRef.current = window.innerWidth + 40;
      }

      setPos(posRef.current);
      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [fullscreen, running, speed]);

  // ESC to exit fullscreen
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') stopMarquee(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── FULLSCREEN OVERLAY ──
  if (fullscreen) {
    return (
      <div
        onClick={stopMarquee}
        style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: bgColor,
          display: 'flex', alignItems: 'center',
          overflow: 'hidden', cursor: 'pointer',
          userSelect: 'none',
        }}
        title="Clique ou ESC para fechar"
      >
        <span
          ref={spanRef}
          style={{
            position: 'absolute',
            left: pos,
            whiteSpace: 'nowrap',
            fontSize: fontSize,
            fontWeight: bold ? 800 : 400,
            fontStyle: italic ? 'italic' : 'normal',
            color: color,
            fontFamily: "'DM Sans', sans-serif",
            textShadow: `0 0 40px ${color}88, 0 0 80px ${color}44`,
            lineHeight: 1.1,
            letterSpacing: '0.02em',
          }}
        >
          {text}
        </span>
        {/* Close hint */}
        <div style={{
          position: 'absolute', top: 16, right: 20,
          color: 'rgba(255,255,255,0.25)', fontSize: 11,
          fontFamily: 'monospace', letterSpacing: 2,
          pointerEvents: 'none',
        }}>
          ESC ou clique para sair
        </div>
      </div>
    );
  }

  // ── CONFIGURAÇÃO ──
  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      {/* Preview mini */}
      <div style={{
        background: bgColor,
        borderRadius: 14, marginBottom: 24, overflow: 'hidden',
        height: 120, display: 'flex', alignItems: 'center',
        border: '1px solid var(--border)',
        position: 'relative',
      }}>
        <div style={{
          animation: 'marqueePreview 8s linear infinite',
          whiteSpace: 'nowrap',
          fontSize: Math.min(fontSize, 52),
          fontWeight: bold ? 800 : 400,
          fontStyle: italic ? 'italic' : 'normal',
          color: color,
          fontFamily: "'DM Sans', sans-serif",
          textShadow: `0 0 20px ${color}66`,
          paddingLeft: '100%',
        }}>
          {draft || 'Digite seu texto…'}
        </div>
        <style>{`
          @keyframes marqueePreview {
            0%   { transform: translateX(0); }
            100% { transform: translateX(-100%); }
          }
        `}</style>
      </div>

      {/* Text input */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: 20, marginBottom: 16 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: 2, display: 'block', marginBottom: 8 }}>TEXTO DO LETREIRO</label>
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          rows={2}
          placeholder="Digite a mensagem aqui..."
          style={{ ...inp, resize: 'vertical', fontSize: 16, fontWeight: 700 }}
        />
      </div>

      {/* Controls grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>

        {/* Cor do texto */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: 2, display: 'block', marginBottom: 10 }}>COR DO TEXTO</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            {PRESETS.map(p => (
              <div key={p.value}
                onClick={() => { setColor(p.value); save({ color: p.value }); }}
                style={{
                  width: 28, height: 28, borderRadius: '50%', background: p.value,
                  border: color === p.value ? '3px solid var(--accent)' : '2px solid var(--border)',
                  cursor: 'pointer', transition: 'transform .12s',
                  transform: color === p.value ? 'scale(1.2)' : 'scale(1)',
                }}
                title={p.label}
              />
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="color" value={color} onChange={e => { setColor(e.target.value); save({ color: e.target.value }); }}
              style={{ width: 36, height: 36, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}/>
            <span style={{ fontSize: 12, color: 'var(--text-2)', fontFamily: 'monospace' }}>{color}</span>
          </div>
        </div>

        {/* Cor de fundo */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: 2, display: 'block', marginBottom: 10 }}>COR DE FUNDO</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            {BG_PRESETS.map(p => (
              <div key={p.value}
                onClick={() => { setBgColor(p.value); save({ bgColor: p.value }); }}
                style={{
                  width: 28, height: 28, borderRadius: '50%', background: p.value,
                  border: bgColor === p.value ? '3px solid var(--accent)' : '2px solid var(--border)',
                  cursor: 'pointer', transition: 'transform .12s',
                  transform: bgColor === p.value ? 'scale(1.2)' : 'scale(1)',
                }}
                title={p.label}
              />
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="color" value={bgColor} onChange={e => { setBgColor(e.target.value); save({ bgColor: e.target.value }); }}
              style={{ width: 36, height: 36, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}/>
            <span style={{ fontSize: 12, color: 'var(--text-2)', fontFamily: 'monospace' }}>{bgColor}</span>
          </div>
        </div>

        {/* Tamanho da fonte */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: 2, display: 'block', marginBottom: 10 }}>TAMANHO — {fontSize}px</label>
          <input type="range" min={32} max={240} value={fontSize}
            onChange={e => { setFontSize(Number(e.target.value)); save({ fontSize: Number(e.target.value) }); }}
            style={{ width: '100%', accentColor: 'var(--accent)' }}/>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            {[32, 72, 120, 180, 240].map(s => (
              <button key={s} onClick={() => { setFontSize(s); save({ fontSize: s }); }}
                style={{ ...btn(fontSize===s?'var(--accent)':'var(--bg-input)'), padding: '4px 8px', fontSize: 11, borderRadius: 8, color: fontSize===s?'#fff':'var(--text-2)', border: `1px solid ${fontSize===s?'var(--accent)':'var(--border)'}` }}>
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Velocidade */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: 2, display: 'block', marginBottom: 10 }}>VELOCIDADE — {speed}px/s</label>
          <input type="range" min={10} max={400} value={speed}
            onChange={e => { setSpeed(Number(e.target.value)); save({ speed: Number(e.target.value) }); }}
            style={{ width: '100%', accentColor: 'var(--accent)' }}/>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            {[{ l:'Lenta', v:30 },{ l:'Normal', v:80 },{ l:'Rápida', v:160 },{ l:'Turbo', v:320 }].map(o => (
              <button key={o.v} onClick={() => { setSpeed(o.v); save({ speed: o.v }); }}
                style={{ ...btn(speed===o.v?'var(--accent)':'var(--bg-input)'), padding: '4px 8px', fontSize: 11, borderRadius: 8, color: speed===o.v?'#fff':'var(--text-2)', border: `1px solid ${speed===o.v?'var(--accent)':'var(--border)'}` }}>
                {o.l}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Style toggles */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, marginBottom: 20, display: 'flex', gap: 12 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: 2, alignSelf: 'center', marginRight: 4 }}>ESTILO</label>
        {[
          { lbl: 'Negrito', val: bold, set: v => { setBold(v); save({ bold: v }); }, icon: 'B' },
          { lbl: 'Itálico', val: italic, set: v => { setItalic(v); save({ italic: v }); }, icon: 'I' },
        ].map(o => (
          <button key={o.lbl} onClick={() => o.set(!o.val)}
            style={{
              background: o.val ? 'var(--accent)' : 'var(--bg-input)',
              border: `1px solid ${o.val ? 'var(--accent)' : 'var(--border)'}`,
              color: o.val ? '#fff' : 'var(--text-2)',
              borderRadius: 10, padding: '8px 18px', fontSize: 14,
              fontWeight: o.lbl==='Negrito' ? 800 : 400,
              fontStyle: o.lbl==='Itálico' ? 'italic' : 'normal',
              cursor: 'pointer', transition: 'all .15s',
            }}>
            {o.icon} {o.lbl}
          </button>
        ))}
      </div>

      {/* Launch button */}
      <button onClick={startMarquee} style={{
        ...btn('var(--accent)'),
        width: '100%', fontSize: 16, fontWeight: 800,
        padding: '16px', borderRadius: 14, letterSpacing: 2,
        boxShadow: '0 4px 24px rgba(40,120,200,0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
      }}>
        <span style={{ fontSize: 22 }}>📺</span> EXIBIR LETREIRO EM TELA CHEIA
      </button>
      <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-3)', marginTop: 10 }}>
        Clique na tela ou pressione ESC para fechar
      </div>
    </div>
  );
}

// ─── PAGE TITLES ─────────────────────────────────────────────────────────────
const PAGE_META = {
  home:       {label:"Menu",                emoji:"🏠"},
  diary:      {label:"Diário",              emoji:"📓"},
  tasks:      {label:"Tarefas",             emoji:"✅"},
  docs:       {label:"Documentos",          emoji:"📁"},
  bills:      {label:"Contas",              emoji:"💳"},
  events:     {label:"Compromissos",        emoji:"📅"},
  lists:      {label:"Listas",              emoji:"📋"},
  weather:    {label:"Clima",               emoji:"🌤"},
  market:     {label:"Mercado & Indicadores",emoji:"📈"},
  whiteboard: {label:"Whiteboard",          emoji:"🖊️"},
  bat:          {label:".BAT / Scripts",     emoji:"💻"},
  letreiro:     {label:"Letreiro",             emoji:"📺"},
};

// ─── BAT PAGE ─────────────────────────────────────────────────────────────────
function BatPage() {
  const [scripts, setScripts] = useState(()=>S.get("bat_scripts",[
    {id:1, name:"Olá Mundo", code:"@echo off\necho Olá Mundo!\npause", desc:"Script de exemplo"},
    {id:2, name:"Info do Sistema", code:"@echo off\nsysteminfo\npause", desc:"Exibe informações do sistema"},
  ]));
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({name:"",code:"",desc:""});
  const [modal, setModal] = useState(false);

  const save = n=>{ setScripts(n); S.set("bat_scripts",n); };
  const add  = ()=>{
    if(!form.name.trim()) return;
    const s={id:Date.now(),...form};
    save([...scripts,s]); setModal(false); setForm({name:"",code:"",desc:""});
  };
  const del  = id=>save(scripts.filter(s=>Number(s.id)!==Number(id)));
  const download = s=>{
    const blob=new Blob([s.code.replace(/\\n/g,"\n")],{type:"text/plain"});
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=s.name+".bat"; a.click();
  };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div style={{fontSize:13,color:"var(--text-3)"}}>Scripts .BAT para Windows — edite, salve e baixe</div>
        <button onClick={()=>setModal(true)} style={{...btn(),display:"flex",alignItems:"center",gap:6}}><Icon path={I.plus} size={14}/> Novo Script</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:14}}>
        {scripts.map(s=>(
          <div key={s.id} style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:14,overflow:"hidden"}}>
            <div style={{padding:"12px 16px",borderBottom:"1px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontWeight:700,fontSize:14}}>💻 {s.name}</div>
                {s.desc&&<div style={{fontSize:11,color:"var(--text-3)",marginTop:2}}>{s.desc}</div>}
              </div>
              <div style={{display:"flex",gap:6}}>
                <button onClick={()=>setEditing(s)} style={{background:"var(--accent-dim)",border:"1px solid var(--accent-bdr)",borderRadius:8,padding:"5px 10px",color:"var(--accent)",fontSize:11,cursor:"pointer"}}>✏️ Editar</button>
                <button onClick={()=>download(s)} style={{background:"rgba(46,204,138,0.1)",border:"1px solid rgba(46,204,138,0.3)",borderRadius:8,padding:"5px 10px",color:"var(--green)",fontSize:11,cursor:"pointer"}}>⬇ .bat</button>
                <button onClick={()=>del(s.id)} style={{background:"none",border:"none",color:"var(--text-3)",cursor:"pointer"}}><Icon path={I.trash} size={14}/></button>
              </div>
            </div>
            <pre style={{padding:"12px 16px",fontSize:12,color:"var(--text-2)",overflowX:"auto",fontFamily:"'DM Mono',monospace",lineHeight:1.6,maxHeight:160,overflowY:"auto",background:"var(--bg-input)",margin:0}}>{s.code}</pre>
          </div>
        ))}
      </div>

      {modal&&<Modal title="Novo Script .BAT" onClose={()=>setModal(false)} wide>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <input style={inp} placeholder="Nome do script" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/>
          <input style={inp} placeholder="Descrição (opcional)" value={form.desc} onChange={e=>setForm({...form,desc:e.target.value})}/>
          <textarea style={{...inp,fontFamily:"'DM Mono',monospace",fontSize:13,resize:"vertical"}} rows={10} placeholder={"@echo off\necho Seu script aqui\npause"} value={form.code} onChange={e=>setForm({...form,code:e.target.value})}/>
          <button onClick={add} style={btn()}>Salvar Script</button>
        </div>
      </Modal>}

      {editing&&<Modal title={`Editar: ${editing.name}`} onClose={()=>setEditing(null)} wide>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <input style={inp} value={editing.name} onChange={e=>setEditing({...editing,name:e.target.value})}/>
          <input style={inp} value={editing.desc} onChange={e=>setEditing({...editing,desc:e.target.value})}/>
          <textarea style={{...inp,fontFamily:"'DM Mono',monospace",fontSize:13,resize:"vertical"}} rows={12} value={editing.code} onChange={e=>setEditing({...editing,code:e.target.value})}/>
          <button onClick={()=>{ save(scripts.map(s=>s.id===editing.id?editing:s)); setEditing(null); }} style={btn()}>Salvar alterações</button>
        </div>
      </Modal>}
    </div>
  );
}


// ─── DJ STUDIO PAGE ──────────────────────────────────────────────────────────
// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState("home");
  const [viewMode, setViewMode] = useState(()=>localStorage.getItem("view_mode")||"auto");
  const market = useMarketData();

  // Apply viewport meta based on mode
  useEffect(()=>{
    let meta = document.querySelector("meta[name=viewport]");
    if(!meta){ meta=document.createElement("meta"); meta.name="viewport"; document.head.appendChild(meta); }
    if(viewMode==="desktop"){
      meta.content="width=1280";
    } else if(viewMode==="mobile"){
      meta.content="width=device-width, initial-scale=1.0, maximum-scale=1.0";
    } else {
      meta.content="width=device-width, initial-scale=1.0";
    }
    localStorage.setItem("view_mode", viewMode);
  },[viewMode]);
  const meta = PAGE_META[page]||PAGE_META.home;

  const ViewToggle = () => (
    <div style={{display:"flex",gap:3,alignItems:"center",flexShrink:0}}>
      {[
        {k:"auto",   icon:"⚡", title:"Automático"},
        {k:"mobile", icon:"📱", title:"Mobile"},
        {k:"desktop",icon:"🖥", title:"Desktop"},
      ].map(o=>(
        <button key={o.k} onClick={()=>setViewMode(o.k)}
          title={o.title}
          style={{background:viewMode===o.k?"var(--accent)":"transparent",
            border:`1px solid ${viewMode===o.k?"var(--accent)":"var(--border)"}`,
            color:viewMode===o.k?"#fff":"var(--text-3)",
            borderRadius:8, padding:"4px 9px", cursor:"pointer",
            fontSize:13, lineHeight:1, transition:"all .15s"}}>
          {o.icon}
        </button>
      ))}
    </div>
  );

  const renderPage = () => {
    switch(page) {
      case "diary":      return <DiaryPage/>;
      case "tasks":      return <TasksPage/>;
      case "docs":       return <DocsPage/>;
      case "bills":      return <BillsPage/>;
      case "events":     return <EventsPage/>;
      case "lists":      return <ListsPage/>;
      case "weather":    return <WeatherPage/>;
      case "market":     return <MarketPage/>;
      case "whiteboard": return <WhiteboardPage/>;
      case "bat":          return <BatPage/>;
      case "letreiro":      return <LetreirPage/>;
      default:           return <HomePage onNavigate={setPage}/>;
    }
  };

  return (
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column"}}>
      {/* TOP BAR */}
      <header style={{background:"var(--bg-bar)",borderBottom:"1px solid var(--border)",padding:"0 20px",display:"flex",alignItems:"center",justifyContent:"space-between",height:54,flexShrink:0,gap:16}}>
        <div style={{display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
          <div style={{width:32,height:32,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>📱</div>
          <div>
            <div style={{fontWeight:800,fontSize:11,letterSpacing:1.5,lineHeight:1}}>PAINEL DE CONTROLE</div>
            <div style={{fontWeight:400,fontSize:9,letterSpacing:2,color:"var(--text-3)",lineHeight:1,marginTop:2}}>PESSOAL</div>
          </div>
        </div>
        {/* Ticker always visible */}
        <div style={{flex:1,overflow:"hidden"}}>
          <TickerStrip market={market}/>
        </div>
      </header>

      {/* BREADCRUMB BAR */}
      <div style={{background:"var(--bg-sub)",borderBottom:"1px solid var(--border-2)",padding:"0 20px",height:40,display:"flex",alignItems:"center",gap:10}}>
        {page!=="home"&&(
          <button onClick={()=>setPage("home")} style={{background:"none",border:"none",color:"var(--text-3)",cursor:"pointer",display:"flex",alignItems:"center",gap:4,fontSize:12}}>
            <Icon path={I.back} size={14}/> Menu
          </button>
        )}
        {page!=="home"&&<span style={{color:"var(--border)",fontSize:12}}>/</span>}
        <span style={{fontSize:13,fontWeight:700,color:"var(--text-1)"}}>{meta.emoji} {meta.label}</span>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8}}>
          <ViewToggle/>
          <LiveBadge label=""/>
          <span style={{fontSize:10,color:"var(--text-3)"}}>v3.0</span>
        </div>
      </div>

      {/* CONTENT */}
      <main style={{flex:1,padding: page==="home"?"0":"24px 20px",maxWidth: page==="market"||page==="home"?"100%":1280,width:"100%",margin:"0 auto",animation:"fadeIn .2s ease"}}>
        {renderPage()}
      </main>

      <footer style={{borderTop:"1px solid var(--border-2)",padding:"8px 20px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:10,color:"var(--border)",letterSpacing:1}}>PAINEL DE CONTROLE PESSOAL · v3.0</span>
        <span style={{fontSize:10,color:"var(--border)"}}>{new Date().toLocaleDateString("pt-BR")}</span>
      </footer>
    </div>
  );
}

























