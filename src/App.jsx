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
  delete:async (t,id)=>{ try{ await fetch(`/api/db?table=${t}&id=${id}`,{method:"DELETE"}); }catch{} },
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

// useKV — like useState but synced to cloud + localStorage
function useKV(key, def) {
  const [data, setData] = useState(() => {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch { return def; }
  });
  const [synced, setSynced] = useState(false);

  // On mount: pull from cloud, merge with local, push any local-only data
  useEffect(() => {
    KV.get(key).then(cloud => {
      if (cloud !== null) {
        setData(cloud);
        try { localStorage.setItem(key, JSON.stringify(cloud)); } catch {}
      }
      setSynced(true);
    });
  }, [key]);

  const save = (next) => {
    const value = typeof next === 'function' ? next(data) : next;
    setData(value);
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
    KV.set(key, value);
    return value;
  };

  return [data, save, synced];
}

function useDB(table, localKey, def=[]) {
  const [data, setData] = useState(()=>S.get(localKey,def));
  const [synced, setSynced] = useState(false);

  useEffect(()=>{
    DB.list(table).then(async rows=>{
      const local = S.get(localKey, def);
      if(rows && Array.isArray(rows) && rows.length>0){
        const bankIds = new Set(rows.map(r=>String(r.id)));
        const onlyLocal = local.filter(l=>!bankIds.has(String(l.id)));
        for(const item of onlyLocal) await DB.insert(table,item);
        const all = [...rows,...onlyLocal].sort((a,b)=>Number(b.id)-Number(a.id));
        setData(all); S.set(localKey,all);
      } else if(local.length>0){
        for(const item of local) await DB.insert(table,item);
        setData(local);
      }
      setSynced(true);
    });
  },[table]);

  return [data,setData,synced];
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
  const [entries, setEntries, synced] = useDB(storageKey, storageKey, []);
  const [text, setText] = useState("");
  const [mood, setMood] = useState("🙂");
  const moods = ["😄","🙂","😐","😔","😤","🤔","🎉"];
  const showMoods = storageKey === "diary";

  const add = () => {
    if(!text.trim()) return;
    const e = {id:Date.now(), text, mood, done:false, date:nowISO()};
    const n = [e, ...entries];
    setEntries(n); S.set(storageKey, n); DB.insert(storageKey, e); setText("");
  };
  const del  = id => { const n=entries.filter(e=>e.id!==id); setEntries(n); S.set(storageKey,n); DB.delete(storageKey,id); };
  const tick = id => {
    const cur = entries.find(e=>e.id===id);
    const n = entries.map(e=>e.id===id?{...e,done:!e.done}:e);
    setEntries(n); S.set(storageKey,n); DB.update(storageKey,{id,done:!cur.done});
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
  // async cloud push (fire-and-forget)
  KV.set(DB_BOARD_KEY, boards);
}

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function fmtBoardDate(key) {
  const [y,m,d] = key.split('-');
  const dt = new Date(Number(y), Number(m)-1, Number(d));
  return dt.toLocaleDateString('pt-BR', {weekday:'long', day:'numeric', month:'long', year:'numeric'});
}

function DayBoardCanvas({ dayKey, readOnly }) {
  // ── State ──
  const [nodes,    setNodes]    = useState([]);
  const [edges,    setEdges]    = useState([]);
  const [selected, setSelected] = useState(null);
  const [editing,  setEditing]  = useState(null);
  const [connecting, setConnecting] = useState(null);
  const [pan,   setPan]   = useState({ x: 60, y: 60 });
  const [scale, setScale] = useState(1);

  // ── Refs (never stale in events) ──
  const stateRef = useRef({});
  stateRef.current = { nodes, edges, pan, scale, selected, editing, connecting, readOnly };

  const dragRef    = useRef(null); // { kind:'node'|'pan', id, ox,oy,px,py }
  const containerRef = useRef(null);

  // ── Load / save ──
  useEffect(() => {
    const b = loadBoards()[dayKey] || { nodes:[], edges:[] };
    setNodes(b.nodes || []);
    setEdges(b.edges || []);
    setSelected(null); setEditing(null); setConnecting(null);
    setPan({ x:60, y:60 }); setScale(1);
  }, [dayKey]);

  useEffect(() => {
    const boards = loadBoards();
    boards[dayKey] = { nodes, edges };
    saveBoards(boards);
  }, [nodes, edges, dayKey]);

  // ── Helpers ──
  const nextColor = (count) => POST_COLORS[count % POST_COLORS.length];
  const makeNode  = (x, y, color, text='') => ({
    id: Date.now() + Math.random(), x, y, w:170, h:100, color: color||nextColor(0), text,
  });
  const toWorld = useCallback((cx, cy) => {
    const { pan, scale } = stateRef.current;
    return { x:(cx - pan.x)/scale, y:(cy - pan.y)/scale };
  }, []);

  // ── Global pointer events (drag nodes + pan canvas) ──
  useEffect(() => {
    const onMove = (e) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.px;
      const dy = e.clientY - d.py;
      if (d.kind === 'pan') {
        setPan({ x: d.ox + dx, y: d.oy + dy });
      } else if (d.kind === 'node') {
        const { scale } = stateRef.current;
        setNodes(ns => ns.map(n => n.id === d.id
          ? { ...n, x: d.ox + dx/scale, y: d.oy + dy/scale }
          : n
        ));
      }
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup',   onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup',   onUp);
    };
  }, []);

  // ── Zoom: mouse wheel + pinch touch ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Mouse wheel
    const onWheel = (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.91;
      // Zoom toward cursor position
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setScale(s => {
        const next = Math.min(3, Math.max(0.2, s * factor));
        const ratio = next / s;
        setPan(p => ({ x: cx - (cx - p.x)*ratio, y: cy - (cy - p.y)*ratio }));
        return next;
      });
    };

    // Pinch touch
    let lastDist = null;
    let lastMid  = null;

    const getTouches = (e) => Array.from(e.touches);

    const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const mid  = (a, b, rect) => ({
      x: (a.clientX + b.clientX)/2 - rect.left,
      y: (a.clientY + b.clientY)/2 - rect.top,
    });

    const onTouchStart = (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const [t0,t1] = getTouches(e);
        lastDist = dist(t0,t1);
        lastMid  = mid(t0,t1, el.getBoundingClientRect());
        // cancel any pointer drag so pan doesn't fight pinch
        dragRef.current = null;
      }
    };

    const onTouchMove = (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const [t0,t1] = getTouches(e);
        const rect = el.getBoundingClientRect();
        const newDist = dist(t0,t1);
        const newMid  = mid(t0,t1, rect);

        if (lastDist && lastMid) {
          const factor = newDist / lastDist;
          setScale(s => {
            const next = Math.min(3, Math.max(0.2, s * factor));
            const ratio = next / s;
            // zoom toward pinch midpoint + allow panning with two fingers
            const panDx = newMid.x - lastMid.x;
            const panDy = newMid.y - lastMid.y;
            setPan(p => ({
              x: newMid.x - (lastMid.x - p.x)*ratio + panDx*(1-ratio),
              y: newMid.y - (lastMid.y - p.y)*ratio + panDy*(1-ratio),
            }));
            return next;
          });
        }
        lastDist = newDist;
        lastMid  = newMid;
      }
    };

    const onTouchEnd = (e) => {
      if (e.touches.length < 2) {
        lastDist = null;
        lastMid  = null;
      }
    };

    el.addEventListener('wheel',      onWheel,      { passive:false });
    el.addEventListener('touchstart', onTouchStart, { passive:false });
    el.addEventListener('touchmove',  onTouchMove,  { passive:false });
    el.addEventListener('touchend',   onTouchEnd,   { passive:true  });

    return () => {
      el.removeEventListener('wheel',      onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove',  onTouchMove);
      el.removeEventListener('touchend',   onTouchEnd);
    };
  }, []);

  // ── Canvas background pointer down → pan ──
  const onBgPointerDown = (e) => {
    if (e.target !== e.currentTarget) return; // only raw background
    const { connecting } = stateRef.current;
    if (connecting) { setConnecting(null); return; }
    setSelected(null);
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { kind:'pan', ox:stateRef.current.pan.x, oy:stateRef.current.pan.y, px:e.clientX, py:e.clientY };
  };

  // ── Double-click background → new node ──
  const onBgDblClick = (e) => {
    if (e.target !== e.currentTarget) return;
    if (readOnly) return;
    const rect = containerRef.current.getBoundingClientRect();
    const { x,y } = toWorld(e.clientX - rect.left, e.clientY - rect.top);
    const node = makeNode(x-85, y-50, nextColor(stateRef.current.nodes.length));
    setNodes(n => [...n, node]);
    setSelected(node.id);
    setEditing(node.id);
  };

  // ── Node pointer down → drag ──
  const onNodePointerDown = (e, node) => {
    const { editing, connecting, readOnly } = stateRef.current;
    if (readOnly) return;
    if (editing === node.id) return; // inside textarea, don't drag
    if (connecting) { connectNodes(node.id); return; }
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { kind:'node', id:node.id, ox:node.x, oy:node.y, px:e.clientX, py:e.clientY };
  };

  // ── Node click ──
  const onNodeClick = (e, node) => {
    e.stopPropagation();
    const { connecting } = stateRef.current;
    if (connecting) { connectNodes(node.id); return; }
    setSelected(node.id);
  };

  // ── Node double-click → edit ──
  const onNodeDblClick = (e, node) => {
    e.stopPropagation();
    if (!readOnly) setEditing(node.id);
  };

  // ── Actions ──
  const deleteNode = (id) => {
    setNodes(n => n.filter(x => x.id !== id));
    setEdges(e => e.filter(x => x.from !== id && x.to !== id));
    if (stateRef.current.selected  === id) setSelected(null);
    if (stateRef.current.editing   === id) setEditing(null);
  };

  const addConnectedNode = (srcNode) => {
    if (readOnly) return;
    const child = makeNode(srcNode.x + srcNode.w + 60, srcNode.y, srcNode.color);
    setNodes(n => [...n, child]);
    setEdges(e => [...e, { id:Date.now()+Math.random(), from:srcNode.id, to:child.id }]);
    setSelected(child.id);
    setEditing(child.id);
  };

  const connectNodes = (toId) => {
    const { connecting } = stateRef.current;
    if (!connecting || connecting === toId) { setConnecting(null); return; }
    const dup = stateRef.current.edges.find(e =>
      (e.from===connecting&&e.to===toId)||(e.from===toId&&e.to===connecting)
    );
    if (!dup) setEdges(e => [...e, { id:Date.now()+Math.random(), from:connecting, to:toId }]);
    setConnecting(null);
  };

  const changeColor = (id, c) => setNodes(n => n.map(x => x.id===id ? {...x,color:c} : x));
  const updateText  = (id, t) => setNodes(n => n.map(x => x.id===id ? {...x,text:t}  : x));

  const addNode = () => {
    const { pan, scale, nodes } = stateRef.current;
    const node = makeNode((-pan.x/scale)+80+nodes.length*20, (-pan.y/scale)+80+nodes.length*10, nextColor(nodes.length));
    setNodes(n => [...n, node]);
    setSelected(node.id); setEditing(node.id);
  };

  const getCenter = n => ({ cx: n.x + n.w/2, cy: n.y + n.h/2 });

  // ── Render ──
  return (
    <div ref={containerRef} style={{ position:'relative', width:'100%', height:'100%', overflow:'hidden',
        background:'#f0f4f8',
        backgroundImage:'radial-gradient(circle,#c8d8e8 1px,transparent 1px)',
        backgroundSize:'28px 28px',
        cursor: dragRef.current?.kind==='pan' ? 'grabbing' : 'default',
        touchAction:'none',
      }}
      onPointerDown={onBgPointerDown}
      onDoubleClick={onBgDblClick}
    >
      {/* ── Toolbar ── */}
      {!readOnly && (
        <div style={{ position:'absolute', top:10, left:'50%', transform:'translateX(-50%)', zIndex:30,
            display:'flex', gap:6, alignItems:'center',
            background:'rgba(255,255,255,0.92)', backdropFilter:'blur(10px)',
            border:'1px solid #d0dcea', borderRadius:28, padding:'6px 16px',
            boxShadow:'0 4px 20px #0002',
          }}>
          {connecting
            ? <span style={{fontSize:11,color:'#7c3aed',fontWeight:600}}>🔗 Clique num post-it para conectar · clique no fundo para cancelar</span>
            : <span style={{fontSize:11,color:'#64748b'}}>Arraste para mover · duplo clique no fundo = novo post-it · scroll = zoom</span>
          }
          <button onClick={addNode}
            style={{background:'#3a8fd4',border:'none',borderRadius:16,color:'#fff',fontSize:12,fontWeight:700,padding:'5px 14px',cursor:'pointer'}}>
            + Post-it
          </button>
          <button onClick={() => { setPan({x:60,y:60}); setScale(1); }}
            style={{background:'transparent',border:'1px solid #d0dcea',borderRadius:16,color:'#64748b',fontSize:11,padding:'4px 10px',cursor:'pointer'}}>
            ↺ Reset
          </button>
          {selected && !editing && (
            <button onClick={() => deleteNode(selected)}
              style={{background:'#fee2e2',border:'1px solid #fca5a5',borderRadius:16,color:'#dc2626',fontSize:11,padding:'4px 10px',cursor:'pointer'}}>
              🗑 Apagar
            </button>
          )}
        </div>
      )}

      {/* Scale badge */}
      <div style={{position:'absolute',bottom:10,right:12,zIndex:20,fontSize:10,color:'#94a3b8',background:'rgba(255,255,255,0.8)',padding:'3px 8px',borderRadius:8,border:'1px solid #e2e8f0'}}>
        {Math.round(scale*100)}% · {nodes.length} post-it{nodes.length!==1?'s':''}
      </div>

      {/* ── SVG edges ── */}
      <svg style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none',zIndex:1}}>
        <defs>
          <marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="#94a3b8"/>
          </marker>
        </defs>
        <g transform={`translate(${pan.x},${pan.y}) scale(${scale})`}>
          {edges.map(e => {
            const f = nodes.find(n=>n.id===e.from), t = nodes.find(n=>n.id===e.to);
            if (!f||!t) return null;
            const fc=getCenter(f), tc=getCenter(t);
            const mx=(fc.cx+tc.cx)/2;
            return (
              <g key={e.id} style={{pointerEvents:'stroke'}}>
                <path d={`M${fc.cx} ${fc.cy} C${mx} ${fc.cy},${mx} ${tc.cy},${tc.cx} ${tc.cy}`}
                  stroke="#94a3b8" strokeWidth={1.5/scale} fill="none"
                  strokeDasharray={`${6/scale} ${3/scale}`} markerEnd="url(#arr)" opacity={0.8}/>
              </g>
            );
          })}
        </g>
      </svg>

      {/* ── Nodes ── */}
      <div style={{position:'absolute',inset:0,zIndex:2}}>
        {nodes.map(node => {
          const isSel  = selected   === node.id;
          const isEdit = editing    === node.id;
          const isConn = connecting === node.id;
          const tx = pan.x + node.x * scale;
          const ty = pan.y + node.y * scale;
          const nw = node.w * scale;
          const nh = node.h * scale;
          return (
            <div key={node.id}
              style={{
                position:'absolute', left:tx, top:ty, width:nw, height:nh,
                background:node.color,
                borderRadius: 10*scale,
                boxShadow: isSel
                  ? '0 0 0 3px #3a8fd4, 0 8px 28px #0003'
                  : isConn
                  ? '0 0 0 3px #a070e0, 0 8px 28px #0003'
                  : '0 3px 12px #0002',
                cursor: isEdit ? 'text' : 'grab',
                userSelect:'none', overflow:'visible',
                zIndex: isSel ? 20 : 3,
                display:'flex', flexDirection:'column',
                transition:'box-shadow .12s',
                touchAction:'none',
              }}
              onPointerDown={e => onNodePointerDown(e, node)}
              onClick={e => onNodeClick(e, node)}
              onDoubleClick={e => onNodeDblClick(e, node)}
            >
              {/* Header / color strip */}
              <div style={{
                height: Math.max(18*scale, 18),
                background:'rgba(0,0,0,0.10)',
                borderRadius: `${10*scale}px ${10*scale}px 0 0`,
                display:'flex', alignItems:'center', justifyContent:'space-between',
                padding:`0 ${6*scale}px`, flexShrink:0, gap: 4*scale,
              }}>
                {/* Drag handle hint */}
                <span style={{fontSize:9*scale,opacity:.4,letterSpacing:1}}>⠿</span>
                {/* Color palette (only when selected) */}
                {isSel && !readOnly && (
                  <div style={{display:'flex',gap:3*scale}}>
                    {POST_COLORS.map(c => (
                      <div key={c} onPointerDown={e=>{e.stopPropagation();changeColor(node.id,c);}}
                        style={{width:10*scale,height:10*scale,borderRadius:'50%',background:c,
                          border:node.color===c?`${1.5*scale}px solid rgba(0,0,0,0.6)`:`${scale}px solid rgba(0,0,0,0.15)`,
                          cursor:'pointer',flexShrink:0}}/>
                    ))}
                  </div>
                )}
              </div>

              {/* Text body */}
              <div style={{flex:1, padding:`${5*scale}px ${8*scale}px`, overflow:'hidden'}}>
                {isEdit && !readOnly ? (
                  <textarea autoFocus
                    value={node.text}
                    onChange={e => updateText(node.id, e.target.value)}
                    onBlur={() => setEditing(null)}
                    onKeyDown={e => { if(e.key==='Escape') setEditing(null); e.stopPropagation(); }}
                    onPointerDown={e => e.stopPropagation()}
                    style={{width:'100%',height:'100%',background:'transparent',border:'none',outline:'none',
                      resize:'none',fontSize:Math.max(11*scale,10),fontFamily:'inherit',
                      color:'rgba(0,0,0,0.75)',lineHeight:1.5,padding:0}}
                  />
                ) : (
                  <div style={{fontSize:Math.max(11*scale,10),color:'rgba(0,0,0,0.75)',lineHeight:1.5,
                      wordBreak:'break-word',whiteSpace:'pre-wrap',height:'100%',overflow:'hidden'}}>
                    {node.text || <span style={{opacity:.35,fontStyle:'italic',fontSize:Math.max(10*scale,9)}}>duplo clique para editar</span>}
                  </div>
                )}
              </div>

              {/* Action buttons — always visible at the bottom of the card */}
              {!readOnly && !isEdit && (
                <div style={{
                  display:'flex', gap:3, padding:`${3*scale}px ${5*scale}px ${4*scale}px`,
                  flexShrink:0, justifyContent:'space-between', alignItems:'center',
                  borderTop:`${scale}px solid rgba(0,0,0,0.08)`,
                  background:'rgba(0,0,0,0.05)',
                  borderRadius:`0 0 ${9*scale}px ${9*scale}px`,
                }} onPointerDown={e=>e.stopPropagation()}>
                  <button onClick={e=>{e.stopPropagation();addConnectedNode(node);}}
                    title="Criar novo post-it conectado"
                    style={{flex:1,background:'rgba(58,143,212,0.85)',border:'none',
                      borderRadius:6*scale,color:'#fff',
                      fontSize:Math.max(9*scale,8),fontWeight:700,
                      padding:`${2*scale}px ${4*scale}px`,cursor:'pointer',
                      whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                    + Continuar
                  </button>
                  <button onClick={e=>{e.stopPropagation();setConnecting(node.id);}}
                    title="Ligar a outro post-it"
                    style={{background:'rgba(160,112,224,0.85)',border:'none',
                      borderRadius:6*scale,color:'#fff',
                      fontSize:Math.max(9*scale,8),
                      padding:`${2*scale}px ${5*scale}px`,cursor:'pointer',
                      whiteSpace:'nowrap'}}>
                    🔗
                  </button>
                  <button onClick={e=>{e.stopPropagation();deleteNode(node.id);}}
                    title="Apagar post-it"
                    style={{background:'rgba(220,38,38,0.75)',border:'none',
                      borderRadius:6*scale,color:'#fff',
                      fontSize:Math.max(9*scale,8),
                      padding:`${2*scale}px ${5*scale}px`,cursor:'pointer'}}>
                    ✕
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Empty state */}
      {nodes.length===0 && !readOnly && (
        <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',
            alignItems:'center',justifyContent:'center',pointerEvents:'none',gap:8}}>
          <div style={{fontSize:44,opacity:.12}}>📌</div>
          <div style={{fontSize:13,color:'#94a3b8',textAlign:'center',lineHeight:1.8}}>
            Duplo clique em qualquer lugar para criar um post-it<br/>
            ou clique em <strong>+ Post-it</strong> na barra acima
          </div>
        </div>
      )}
      {nodes.length===0 && readOnly && (
        <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',
            justifyContent:'center',pointerEvents:'none'}}>
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 196px)', minHeight: 500 }}>
      {/* Header bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        {/* Today / History toggle */}
        <button onClick={() => { setViewKey(today); setShowHistory(false); }} style={{ ...btn(isToday && !showHistory ? 'var(--accent)' : 'var(--bg-card)'), border: `1px solid ${isToday && !showHistory ? 'var(--accent)' : 'var(--border)'}`, color: isToday && !showHistory ? '#fff' : 'var(--text-2)', padding: '8px 20px', fontSize: 13, borderRadius: 20 }}>
          📌 Hoje
        </button>
        <button onClick={() => setShowHistory(h => !h)} style={{ ...btn(showHistory ? 'var(--purple)' : 'var(--bg-card)'), border: `1px solid ${showHistory ? 'var(--purple)' : 'var(--border)'}`, color: showHistory ? '#fff' : 'var(--text-2)', padding: '8px 20px', fontSize: 13, borderRadius: 20 }}>
          🗂 Histórico {historyKeys.length > 0 && `(${historyKeys.length})`}
        </button>

        {/* Date label */}
        <span style={{ fontSize: 13, color: 'var(--text-3)', marginLeft: 4 }}>
          {isToday && !showHistory ? '— ' + new Date().toLocaleDateString('pt-BR', { weekday:'long', day:'numeric', month:'long' }) : showHistory ? '— selecione um dia abaixo' : '— ' + fmtBoardDate(viewKey)}
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
          <DayBoardCanvas key={viewKey} dayKey={viewKey} readOnly={!isToday}/>
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
  const [entries, setEntries, synced] = useDB("ideas","ideas",[]);
  const [text, setText]   = useState("");
  const [tag, setTag]     = useState("");
  const [editing, setEditing] = useState(null);
  const [editText, setEditText] = useState("");
  const [editTag, setEditTag]   = useState("");

  const add = () => {
    if(!text.trim()) return;
    const e={id:Date.now(),text,tag,mood:"💡",date:nowISO()};
    const n=[e,...entries]; setEntries(n); S.set("ideas",n); DB.insert("ideas",e); setText(""); setTag("");
  };
  const del = id=>{ const n=entries.filter(e=>e.id!==id); setEntries(n); S.set("ideas",n); DB.delete("ideas",id); };
  const openEdit = e=>{ setEditing(e); setEditText(e.text); setEditTag(e.tag||""); };
  const saveEdit = ()=>{
    const n=entries.map(e=>e.id===editing.id?{...e,text:editText,tag:editTag}:e);
    setEntries(n); S.set("ideas",n); DB.update("ideas",{id:editing.id,text:editText,mood:editing.mood}); setEditing(null);
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
  const [entries, setEntries, synced] = useDB("reminders","reminders",[]);
  const [text, setText]   = useState("");
  const [editing, setEditing] = useState(null);
  const [editText, setEditText] = useState("");
  const [filter, setFilter]   = useState("all");

  const add = () => {
    if(!text.trim()) return;
    const e={id:Date.now(),text,mood:"🔔",done:false,date:nowISO()};
    const n=[e,...entries]; setEntries(n); S.set("reminders",n); DB.insert("reminders",e); setText("");
  };
  const tick = id=>{
    const cur=entries.find(e=>e.id===id);
    const n=entries.map(e=>e.id===id?{...e,done:!e.done}:e);
    setEntries(n); S.set("reminders",n); DB.update("reminders",{id,done:!cur.done});
  };
  const del = id=>{ const n=entries.filter(e=>e.id!==id); setEntries(n); S.set("reminders",n); DB.delete("reminders",id); };
  const openEdit = e=>{ setEditing(e); setEditText(e.text); };
  const saveEdit = ()=>{
    const n=entries.map(e=>e.id===editing.id?{...e,text:editText}:e);
    setEntries(n); S.set("reminders",n); DB.update("reminders",{id:editing.id,text:editText,mood:editing.mood}); setEditing(null);
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
function DiaryPage() {
  const [active, setActive] = useState("dia");
  const tabs = [
    {id:"dia",       label:"📌 Dia",       color:"#e67e22"},
    {id:"diary",     label:"📓 Diário",    color:"var(--accent)"},
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
        {active==="ideas"     && <IdeasCards/>}
        {active==="reminders" && <RemindersCards/>}
      </div>
    </div>
  );
}

// ─── TASKS PAGE ───────────────────────────────────────────────────────────────
function TasksPage() {
  const [tasks, setTasks, synced] = useDB("tasks","tasks",[]);
  const [text, setText]   = useState("");
  const [prio, setPrio]   = useState("normal");
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState(null);
  const [editModal, setEditModal] = useState(null);
  const [addNote, setAddNote] = useState("");

  const prioColor = {alta:"var(--red)",normal:"var(--accent)",baixa:"var(--text-3)"};
  const prioLabel = {alta:"🔴 Alta",normal:"🔵 Normal",baixa:"⚪ Baixa"};

  const save = n=>{ setTasks(n); S.set("tasks",n); };

  const add = ()=>{
    if(!text.trim()) return;
    const t={id:Date.now(),text,prio,done:false,date:nowISO(),notes:[],updates:[]};
    const n=[t,...tasks]; save(n); DB.insert("tasks",t); setText("");
  };
  const toggle = id=>{
    const t=tasks.find(t=>t.id===id);
    if(!t) return;
    const n=tasks.map(t=>t.id===id?{...t,done:!t.done}:t); save(n); DB.update("tasks",{id,done:!t.done});
  };
  const del = id=>{ save(tasks.filter(t=>t.id!==id)); DB.delete("tasks",id); };
  const addTaskNote = (id)=>{
    if(!addNote.trim()) return;
    const note={text:addNote,date:now()};
    const n=tasks.map(t=>t.id===id?{...t,updates:[...(t.updates||[]),note]}:t);
    save(n);
    const updated=n.find(t=>t.id===id);
    DB.update("tasks",{id,updates:updated.updates});
    setEditModal(updated);
    setAddNote("");
  };

  const filtered = tasks.filter(t=>
    filter==="all"?true: filter==="done"?t.done: filter==="todo"?!t.done: t.prio===filter
  );

  return (
    <div>
      {/* Input */}
      <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:14,padding:20,marginBottom:20}}>
        <div style={{fontSize:10,color:"var(--accent)",letterSpacing:2,fontWeight:800,marginBottom:12}}>✅ NOVA TAREFA</div>
        <textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Descreva a tarefa..." rows={2}
          style={{...inp,resize:"none",marginBottom:12}} onKeyDown={e=>{if(e.ctrlKey&&e.key==="Enter")add();}}/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{display:"flex",gap:8}}>
            {["alta","normal","baixa"].map(p=>(
              <button key={p} onClick={()=>setPrio(p)} style={{background:prio===p?prioColor[p]+"22":"var(--bg-input)",border:`1px solid ${prio===p?prioColor[p]:"var(--border)"}`,borderRadius:20,padding:"5px 12px",color:prio===p?prioColor[p]:"var(--text-3)",fontSize:11,fontWeight:700,cursor:"pointer"}}>{prioLabel[p]}</button>
            ))}
          </div>
          <button onClick={add} style={{...btn(),padding:"8px 20px"}}>+ Adicionar</button>
        </div>
      </div>

      {/* Filters */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {[["all","Todas"],["todo","Pendentes"],["done","Concluídas"],["alta","Alta"],["normal","Normal"]].map(([id,label])=>(
            <button key={id} onClick={()=>setFilter(id)} style={{background:filter===id?"var(--accent)":"var(--bg-card)",border:"none",borderRadius:20,padding:"5px 12px",color:filter===id?"#fff":"var(--text-2)",fontSize:11,fontWeight:600,cursor:"pointer"}}>{label}</button>
          ))}
        </div>
        <span style={{fontSize:11,color:"var(--text-3)"}}>{tasks.filter(t=>!t.done).length} pendentes</span>
      </div>

      {/* Cards grid */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12}}>
        {filtered.map(t=>(
          <div key={t.id} onClick={()=>setEditModal(t)} style={{background:"var(--bg-card)",border:`1px solid ${t.done?"var(--border-2)":prioColor[t.prio]+"44"}`,borderRadius:12,padding:"14px 16px",cursor:"pointer",opacity:t.done?0.6:1,transition:"opacity .2s"}}>
            <div style={{display:"flex",gap:10,alignItems:"flex-start",marginBottom:8}}>
              <button onClick={e=>{e.stopPropagation();toggle(t.id);}} style={{width:22,height:22,borderRadius:6,border:`2px solid ${t.done?"var(--green)":prioColor[t.prio]}`,background:t.done?"var(--green)":"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1}}>
                {t.done&&<Icon path={I.check} size={12} color="#fff"/>}
              </button>
              <p style={{margin:0,fontSize:14,color:"var(--text-1)",lineHeight:1.5,textDecoration:t.done?"line-through":"none",flex:1}}>{t.text}</p>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:10,color:"var(--text-3)"}}>
              <span style={{color:prioColor[t.prio],fontWeight:700}}>{prioLabel[t.prio]}</span>
              <span>{new Date(t.date).toLocaleDateString("pt-BR")} {new Date(t.date).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</span>
            </div>
            {t.updates?.length>0&&<div style={{fontSize:10,color:"var(--accent)",marginTop:6}}>{t.updates.length} atualização(ões)</div>}
            <button onClick={e=>{e.stopPropagation();del(t.id);}} style={{position:"absolute",display:"none"}}>x</button>
          </div>
        ))}
        {filtered.length===0&&<Empty text="Nenhuma tarefa aqui."/>}
      </div>

      {editModal&&(
        <Modal title={editModal.text.slice(0,40)+"..."} onClose={()=>{setEditModal(null);setAddNote("");}}>
          <div style={{marginBottom:16}}>
            <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:12}}>
              <button onClick={()=>toggle(editModal.id)} style={{...btn(editModal.done?"var(--green)":"var(--bg-input)"),padding:"6px 14px",fontSize:12,border:`1px solid ${editModal.done?"var(--green)":"var(--border)"}`}}>
                {editModal.done?"✅ Concluída":"⬜ Pendente"}
              </button>
              <span style={{fontSize:11,color:prioColor[editModal.prio],fontWeight:700}}>{prioLabel[editModal.prio]}</span>
            </div>
            <p style={{color:"var(--text-2)",lineHeight:1.7,fontSize:14,marginBottom:16}}>{editModal.text}</p>
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
  const [docs, setDocs, synced] = useDB("documents","docs",[]);
  const [modal, setModal] = useState(false);
  const [form, setForm]   = useState({name:"",cat:"Pessoal",tags:"",notes:""});
  const [filter, setFilter] = useState("Todos");
  const [fileData, setFileData] = useState(null);
  const [fileName, setFileName] = useState("");
  const fileRef = useRef(null);
  const [editingId, setEditingId] = useState(null);
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

  const add = ()=>{
    if(!form.name.trim()) return;
    const tags = form.tags.split(",").map(t=>t.trim()).filter(Boolean);
    if(editingId) {
      const n=docs.map(d=>d.id===editingId?{...d,...form,tags,file:fileData||d.file}:d);
      setDocs(n); S.set("docs",n);
      DB.update("documents",{id:editingId,name:form.name,cat:form.cat,notes:form.notes});
    } else {
      const doc={id:Date.now(),...form,date:now(),tags,file:fileData};
      const n=[doc,...docs]; setDocs(n); S.set("docs",n);
      const dbRow={id:doc.id,name:doc.name,cat:doc.cat,tags:doc.tags,notes:doc.notes,date:doc.date,
        file_data:fileData?.data||"",file_name:fileData?.name||"",file_size:fileData?.size||0,file_type:fileData?.type||""};
      DB.insert("documents",dbRow);
    }
    setModal(false); setEditingId(null); setForm({name:"",cat:"Pessoal",tags:"",notes:""}); setFileData(null); setFileName("");
  };
  const del  = id=>{ const n=docs.filter(d=>d.id!==id); setDocs(n); S.set("docs",n); DB.delete("documents",id); };
  const edit = id=>{ const d=docs.find(d=>d.id===id); if(d){ setForm({name:d.name,cat:d.cat,tags:Array.isArray(d.tags)?d.tags.join(", "):"",notes:d.notes||""}); setFileData(d.file||null); setFileName(d.file?.name||""); setEditingId(id); setModal(true); } };
  const download = doc=>{ if(!doc.file?.data) return; const a=document.createElement("a"); a.href=doc.file.data; a.download=doc.file.name; a.click(); };

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
            <div style={{fontSize:28,marginBottom:10}}>{getIcon(d.file?.name||d.name)}</div>
            <div style={{fontWeight:700,marginBottom:4,fontSize:14}}>{d.name}</div>
            <div style={{fontSize:11,color:"var(--accent)",marginBottom:6}}>{d.cat}</div>
            {d.notes&&<div style={{fontSize:11,color:"var(--text-3)",marginBottom:6,lineHeight:1.4}}>{d.notes}</div>}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:8}}>
              <span style={{fontSize:10,color:"var(--text-3)"}}>{d.date}</span>
              {d.file?.data&&<button onClick={()=>download(d)} style={{background:"var(--accent-dim)",border:"1px solid var(--accent-bdr)",borderRadius:6,padding:"3px 8px",color:"var(--accent)",fontSize:10,cursor:"pointer",fontWeight:600}}>⬇ Baixar</button>}
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
  const [bills, setBills, synced] = useDB("bills","bills",[]);
  const [modal, setModal] = useState(false);
  const [form, setForm]   = useState({name:"",value:"",dueDay:"",cat:"Fixo",recurrent:true});
  const cats = ["Fixo","Variável","Cartão","Imposto","Assinatura"];

  const add = ()=>{
    if(!form.name.trim()||!form.dueDay) return;
    const b={id:Date.now(),...form,value:parseFloat(form.value)||0,paid:false};
    const n=[...bills,b]; setBills(n); S.set("bills",n); DB.insert("bills",{...b,due_day:b.dueDay});
    setModal(false); setForm({name:"",value:"",dueDay:"",cat:"Fixo",recurrent:true});
  };
  const toggle = id=>{
    const b=bills.find(b=>b.id===id);
    const n=bills.map(b=>b.id===id?{...b,paid:!b.paid}:b); setBills(n); S.set("bills",n); DB.update("bills",{id,paid:!b.paid});
  };
  const del = id=>{ const n=bills.filter(b=>b.id!==id); setBills(n); S.set("bills",n); DB.delete("bills",id); };
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
  const [events, setEvents, synced] = useDB("events","events",[]);
  const [modal, setModal] = useState(false);
  const [form, setForm]   = useState({title:"",date:"",time:"",local:"",cat:"Pessoal",notes:""});
  const cats = ["Pessoal","Médico","Reunião","Viagem","Aniversário","Outros"];
  const catColors = {Pessoal:"var(--accent)",Médico:"var(--red)",Reunião:"var(--purple)",Viagem:"var(--green)",Aniversário:"var(--yellow)",Outros:"var(--text-3)"};

  const add = ()=>{
    if(!form.title.trim()||!form.date) return;
    const e={id:Date.now(),...form};
    const n=[...events,e].sort((a,b)=>new Date(a.date+"T"+(a.time||"00:00"))-new Date(b.date+"T"+(b.time||"00:00")));
    setEvents(n); S.set("events",n); DB.insert("events",e);
    setModal(false); setForm({title:"",date:"",time:"",local:"",cat:"Pessoal",notes:""});
  };
  const del = id=>{ const n=events.filter(e=>e.id!==id); setEvents(n); S.set("events",n); DB.delete("events",id); };
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
  const [boards, setBoards] = useState(()=>S.get("wb_boards",[{id:"wb_default",name:"Lousa 1"}]));
  const [active, setActive] = useState("wb_default");

  const newBoard=()=>{
    const id=`wb_${Date.now()}`;
    const name=`Lousa ${boards.length+1}`;
    const n=[...boards,{id,name}]; setBoards(n); S.set("wb_boards",n); setActive(id);
  };
  const delBoard=id=>{
    if(boards.length===1) return;
    localStorage.removeItem(`whiteboard_${id}`);
    KV.del(`whiteboard_${id}`);
    const n=boards.filter(b=>b.id!==id); setBoards(n); S.set("wb_boards",n);
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
  const dark = {colorTheme:"dark",locale:"pt_BR",isTransparent:true};
  const tabs = [{id:"indicadores",l:"📊 Indicadores"},{id:"noticias",l:"📰 Notícias"},{id:"curiosidades",l:"⭐ Curiosidades"}];

  return (
    <div>
      <div style={{display:"flex",gap:6,marginBottom:20,flexWrap:"wrap"}}>
        {tabs.map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{background:tab===t.id?"var(--accent)":"var(--bg-card)",border:"none",borderRadius:20,padding:"8px 18px",color:tab===t.id?"#fff":"var(--text-2)",fontSize:13,fontWeight:600,cursor:"pointer"}}>{t.l}</button>)}
      </div>

      {tab==="indicadores"&&(
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          <TVCard title="📊 ÍNDICES — BOLSAS GLOBAIS">
            <TVWidget type="market-overview" height={500} config={{...dark,tabs:[{title:"Índices",symbols:[{s:"BMFBOVESPA:IBOV",d:"Ibovespa"},{s:"TVC:SPX",d:"S&P 500"},{s:"NASDAQ:NDX",d:"Nasdaq 100"},{s:"DJ:DJI",d:"Dow Jones"},{s:"CBOE:VIX",d:"VIX"},{s:"TVC:FTSE",d:"FTSE 100"},{s:"XETR:DAX",d:"DAX"},{s:"TVC:NI225",d:"Nikkei 225"}],originalTitle:"Índices"}]}}/>
          </TVCard>
          <TVCard title="💱 CÂMBIO">
            <TVWidget type="forex-cross-rates" height={500} config={{...dark,currencies:["USD","BRL","EUR","GBP","JPY","CNY","CHF","AUD"]}}/>
          </TVCard>
          <TVCard title="₿ CRIPTO">
            <TVWidget type="market-overview" height={480} config={{...dark,tabs:[{title:"Cripto",symbols:[{s:"BITSTAMP:BTCUSD",d:"Bitcoin"},{s:"BITSTAMP:ETHUSD",d:"Ethereum"},{s:"BINANCE:BNBUSD",d:"BNB"},{s:"BINANCE:SOLUSD",d:"Solana"},{s:"BINANCE:XRPUSD",d:"XRP"},{s:"BINANCE:ADAUSD",d:"Cardano"}],originalTitle:"Cripto"}]}}/>
          </TVCard>
          <TVCard title="🛢 COMMODITIES">
            <TVWidget type="market-overview" height={480} config={{...dark,tabs:[{title:"Commodities",symbols:[{s:"TVC:GOLD",d:"Ouro"},{s:"TVC:SILVER",d:"Prata"},{s:"TVC:USOIL",d:"Petróleo WTI"},{s:"TVC:UKOIL",d:"Petróleo Brent"},{s:"CBOT:ZS1!",d:"Soja"},{s:"CBOT:ZC1!",d:"Milho"},{s:"CBOT:ZW1!",d:"Trigo"},{s:"NYMEX:NG1!",d:"Gás Natural"}],originalTitle:"Commodities"}]}}/>
          </TVCard>
        </div>
      )}

      {tab==="noticias"&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(290px,1fr))",gap:14}}>
          <TVCard title="🌍 DESTAQUES DO DIA">
            <div style={{padding:"0 16px"}}>
              {useGNews("top","").news.slice(0,6).map((n,i)=>(
                <div key={i} style={{padding:"10px 0",borderBottom:i<5?"1px solid var(--border-2)":"none"}}>
                  <div style={{fontSize:13,color:"var(--text-1)",lineHeight:1.5,marginBottom:3}}>{n.title}</div>
                  <div style={{fontSize:10,color:"var(--text-3)"}}>{n.src}</div>
                </div>
              ))}
            </div>
          </TVCard>
          {[["economia brasil","🇧🇷 BRASIL"],["ibovespa bolsa b3","📈 BOLSA"],["bitcoin cripto ethereum","₿ CRIPTO"],["trump estados unidos","🇺🇸 EUA"],["guerra conflito militar","⚔️ GUERRAS"],["tecnologia inteligencia artificial","🤖 TECNOLOGIA"]].map(([q,l])=>(
            <NewsBlock key={q} mode="search" q={q} label={l}/>
          ))}
        </div>
      )}

      {tab==="curiosidades"&&<CuriositiesPage/>}
    </div>
  );
}

// ─── CURIOSITIES PAGE ─────────────────────────────────────────────────────────
function CuriositiesPage() {
  const [cards,setCards]=useState(()=>S.get("curiosities",[]));
  const [modal,setModal]=useState(false);
  const [detail,setDetail]=useState(null);
  const [form,setForm]=useState({title:"",content:"",link:"",imageUrl:"",tag:""});
  const [updTxt,setUpdTxt]=useState("");

  const add=()=>{ if(!form.title.trim()) return; const n=[...cards,{id:Date.now(),...form,updates:[],created:now()}]; setCards(n); S.set("curiosities",n); setModal(false); setForm({title:"",content:"",link:"",imageUrl:"",tag:""}); };
  const addUpdate=id=>{ if(!updTxt.trim()) return; const n=cards.map(c=>c.id===id?{...c,updates:[...c.updates,{text:updTxt,date:now()}]}:c); setCards(n); S.set("curiosities",n); setDetail(n.find(c=>c.id===id)); setUpdTxt(""); };
  const del=id=>{ setCards(cards.filter(c=>c.id!==id)); S.set("curiosities",cards.filter(c=>c.id!==id)); setDetail(null); };

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
  const [cards, setCards] = useState(() => S.get("macro_cards", []));
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ title:"", content:"", link:"", tag:"", color:"#1a3d5c" });

  const COLORS = ["#1a3d5c","#2d1a5c","#1a4a2e","#5c2d1a","#1a4a4a","#3d1a1a"];

  const save = n => { setCards(n); S.set("macro_cards", n); };
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
  const [assets, setAssets] = useState(() => S.get("sim_assets", []));
  const [form, setForm] = useState({ name:"", ticker:"", qty:"", price:"", type:"Ação" });
  const types = ["Ação","FII","Cripto","Renda Fixa","ETF","Outro"];

  const save = n => { setAssets(n); S.set("sim_assets", n); };
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
  const [items, setItems] = useState(() => S.get("sim_cashflow", []));
  const [form, setForm] = useState({ desc:"", value:"", type:"entrada", month:"", recurrent:false });

  const save = n => { setItems(n); S.set("sim_cashflow", n); };
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
  const [projects, setProjects] = useState(() => S.get("sim_portfolio", []));
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ name:"", desc:"", status:"Em andamento", client:"", value:"", tags:"" });
  const statuses = ["Em andamento","Concluído","Pausado","Proposta"];
  const statusColor = {"Em andamento":"var(--accent)","Concluído":"var(--green)","Pausado":"var(--yellow)","Proposta":"var(--purple)"};

  const save = n => { setProjects(n); S.set("sim_portfolio", n); };
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
  const [info, setInfo]   = useState(() => S.get("bedrock_info", { name:"BEDROCK", desc:"", mission:"", vision:"", site:"", status:"Ativo" }));
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
function ProfessionalPage() {
  const [section, setSection] = useState("home");

  const tiles = [
    { id:"macro",    label:"MACRO",        emoji:"🌐", color:"#1a3a5c", sub:"Estratégia e contexto" },
    { id:"tools",    label:"FERRAMENTAS",  emoji:"🛠",  color:"#2d1a5c", sub:"Simuladores e análises" },
    { id:"bedrock",  label:"BEDROCK",      emoji:"🪨", color:"#0a2a4a", sub:"Seu projeto" },
  ];

  if(section !== "home") {
    const meta = tiles.find(t=>t.id===section)||{};
    return (
      <div>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:24}}>
          <button onClick={()=>setSection("home")} style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:10,padding:"7px 14px",color:"var(--text-2)",fontSize:13,cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>
            <Icon path={I.back} size={14}/> Profissional
          </button>
          <span style={{color:"var(--border)"}}>/</span>
          <span style={{fontSize:14,fontWeight:700}}>{meta.emoji} {meta.label}</span>
        </div>
        {section==="macro"   && <MacroPage/>}
        {section==="tools"   && <ToolsPage/>}
        {section==="bedrock" && <BedrockPage/>}
      </div>
    );
  }

  return (
    <div className="tiles-grid" style={{maxWidth:900}}>
      {tiles.map(t=>(
        <div key={t.id} className="tile" style={{background:t.color,aspectRatio:"1/1"}} onClick={()=>setSection(t.id)}>
          <span className="tile-icon">{t.emoji}</span>
          <div>
            <div className="tile-label">{t.label}</div>
            <div className="tile-sub">{t.sub}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── MENU (HOME) ──────────────────────────────────────────────────────────────
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
      <MenuTile color="#1a3050"             emoji="💼" label="Profissional"         sub="Macro, Ferramentas, BEDROCK"  onClick={()=>onNavigate("professional")}/>
      <MenuTile color="var(--tile-market)" emoji="📈" label="Mercado & Indicadores" sub="Bolsas, câmbio, cripto, notícias" wide onClick={()=>onNavigate("market")}/>
      <MenuTile color="var(--tile-white)"  emoji="🖊️" label="Whiteboard"   sub="Lousa digital"               onClick={()=>onNavigate("whiteboard")}/>
      <MenuTile color="#1a3a2a"             emoji="💻" label=".BAT / Scripts" sub="Automações e comandos"       onClick={()=>onNavigate("bat")}/>
      <MenuTile color="#0d1a2e"             emoji="🎛️" label="DJ Studio"     sub="Pads · Mixer · Studio · Gravação" wide onClick={()=>onNavigate("dj")}/>
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
  const [draft,    setDraft]    = useState(saved.text     || 'Bem-vindo ao Painel!');

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
  professional: {label:"Profissional",        emoji:"💼"},
  dj:           {label:"DJ Studio",            emoji:"🎛️"},
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
  const del  = id=>save(scripts.filter(s=>s.id!==id));
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
function DJStudioPage() {
  const TOTAL_PADS = 32;
  const KEY_LABELS = ['1','2','3','4','5','6','7','8','Q','W','E','R','T','Y','U','I','A','S','D','F','G','H','J','K','Z','X','C','V','B','N','M',','];
  const KEY_MAP = {'1':0,'2':1,'3':2,'4':3,'5':4,'6':5,'7':6,'8':7,'q':8,'w':9,'e':10,'r':11,'t':12,'y':13,'u':14,'i':15,'a':16,'s':17,'d':18,'f':19,'g':20,'h':21,'j':22,'k':23,'z':24,'x':25,'c':26,'v':27,'b':28,'n':29,'m':30,',':31};
  const PAD_COLORS = ['#ff2d78','#ff7020','#ffe000','#00ff9d','#00e5ff','#0070ff','#9b30ff','#ff30c4','#ff5050','#ffa020','#ccff20','#20ffb0','#20d4ff','#4455ff','#cc44ff','#ff4499','#ff2020','#ffaa00','#00ffff','#88ff00','#ff0088','#0088ff','#ff8800','#44ddff','#dd44ff','#ffdd44','#44ff88','#ff4444','#8888ff','#ff8844','#44ffcc','#cc44ff'];

  /* ── DEFAULT LIBRARY (static, never mutates) ── */
  const BASE_LIBRARY = {
    '🎉 Memes BR': [
      {n:'Uepa / Grito',i:'😱',t:'fx',st:'uepa'},{n:'Adriano?',i:'📢',t:'fx',st:'adriano'},
      {n:'Ronaldo!',i:'⚽',t:'fx',st:'ronaldo'},{n:'Galvão Bueno',i:'🎙️',t:'fx',st:'galvao'},
      {n:'Pamonha',i:'🌽',t:'fx',st:'pamonha'},{n:'Houston Problem',i:'🌌',t:'fx',st:'houston'},
      {n:'Contagem',i:'🔢',t:'fx',st:'contagem'},
    ],
    '🔔 Efeitos': [
      {n:'Sirene',i:'🚨',t:'fx',st:'siren'},{n:'Aplausos',i:'👏',t:'fx',st:'claps'},
      {n:'Tiro',i:'🔫',t:'fx',st:'gunshot'},{n:'Corneta',i:'📯',t:'fx',st:'horn'},
      {n:'Sinal Escolar',i:'🔔',t:'fx',st:'school'},{n:'Carro Freando',i:'🛑',t:'fx',st:'brake'},
      {n:'Air Horn',i:'📢',t:'fx',st:'airhorn'},{n:'Whoosh',i:'💨',t:'fx',st:'whoosh'},
      {n:'Rewind',i:'⏪',t:'fx',st:'rewind'},{n:'Laser',i:'🔴',t:'fx',st:'laser'},
      {n:'Bomba',i:'💣',t:'fx',st:'bomb'},
    ],
    '🎬 Cinemas': [
      {n:'Warner Bros',i:'🎬',t:'fx',st:'warner'},{n:'Champions Lg',i:'🏆',t:'fx',st:'champions'},
      {n:'Fanfarra',i:'🎺',t:'fx',st:'fanfare'},{n:'Dramático',i:'🎭',t:'fx',st:'dramatic'},
    ],
    '🥁 Bateria': [
      {n:'Kick 808',i:'🥁',t:'drum',st:'kick',f:55},{n:'Snare',i:'💥',t:'drum',st:'snare'},
      {n:'Hi-Hat F',i:'🎩',t:'drum',st:'hat_c'},{n:'Hi-Hat A',i:'🎩',t:'drum',st:'hat_o'},
      {n:'Clap',i:'👏',t:'drum',st:'clap'},{n:'Tom Low',i:'🔵',t:'drum',st:'tom',f:80},
      {n:'Tom High',i:'🟢',t:'drum',st:'tom',f:260},{n:'Crash',i:'⭐',t:'drum',st:'crash'},
      {n:'Ride',i:'🟡',t:'drum',st:'ride'},{n:'Rim',i:'🎯',t:'drum',st:'rim'},
      {n:'Cowbell',i:'🐄',t:'drum',st:'cowbell'},{n:'Shaker',i:'🌊',t:'drum',st:'shaker'},
    ],
    '⚡ Eletrônico': [
      {n:'Kick Electro',i:'⚡',t:'elec',st:'kick_e',f:55},{n:'Bass Drop',i:'📉',t:'elec',st:'drop',f:40},
      {n:'Riser',i:'🚀',t:'elec',st:'riser'},{n:'Stab',i:'🗡️',t:'elec',st:'stab',f:440},
      {n:'Arp Up',i:'🌀',t:'elec',st:'arp_up',f:220},{n:'Sub Boom',i:'💠',t:'elec',st:'sub',f:30},
      {n:'Glitch',i:'📻',t:'elec',st:'glitch'},{n:'Vinyl Scratch',i:'🎵',t:'elec',st:'scratch'},
    ],
    '🎹 Instrumentos': [
      {n:'Piano C4',i:'🎹',t:'inst',st:'piano',f:261.63},{n:'Piano E4',i:'🎹',t:'inst',st:'piano',f:329.63},
      {n:'Piano G4',i:'🎹',t:'inst',st:'piano',f:392},{n:'Baixo C2',i:'🎸',t:'inst',st:'bass',f:65.4},
      {n:'Baixo E2',i:'🎸',t:'inst',st:'bass',f:82.4},{n:'Violão',i:'🎸',t:'inst',st:'guitar',f:220},
      {n:'Trompete',i:'🎺',t:'inst',st:'trumpet',f:440},{n:'Flauta',i:'🪈',t:'inst',st:'flute',f:523.25},
      {n:'Sax',i:'🎷',t:'inst',st:'sax',f:293.66},{n:'Violino',i:'🎻',t:'inst',st:'violin',f:659},
    ],
  };

  /* ── PAD BANKS ── stored in localStorage as { banks:[{id,name,pads:[...]}, ...], activeBank:0 } */
  const defaultPad = (i) => ({id:i,label:null,icon:null,sound:null,synthType:null,freq:null});
  const defaultBank = (name='Pad 1') => ({ id: Date.now(), name, pads: Array.from({length:TOTAL_PADS}, (_,i)=>defaultPad(i)) });

  const loadBankState = () => {
    try {
      const raw = localStorage.getItem('dj_banks_v2');
      if (raw) return JSON.parse(raw);
    } catch {}
    // (cloud sync happens via useEffect below)
    // migrate from old dj_pads
    const oldPads = (() => { try { const r=localStorage.getItem('dj_pads'); return r?JSON.parse(r):null; } catch{return null;} })();
    const bank1 = defaultBank('Pad 1');
    if (oldPads) bank1.pads = oldPads.map((p,i)=>({...defaultPad(i),...p}));
    else {
      // preload defaults
      const preloads = [
        {i:0,n:'Kick 808',ic:'🥁',t:'drum',st:'kick',f:55},{i:1,n:'Snare',ic:'💥',t:'drum',st:'snare'},
        {i:2,n:'Hi-Hat',ic:'🎩',t:'drum',st:'hat_c'},{i:3,n:'Clap',ic:'👏',t:'drum',st:'clap'},
        {i:4,n:'Sirene',ic:'🚨',t:'fx',st:'siren'},{i:5,n:'Air Horn',ic:'📢',t:'fx',st:'airhorn'},
        {i:6,n:'Tiro',ic:'🔫',t:'fx',st:'gunshot'},{i:7,n:'Rewind',ic:'⏪',t:'fx',st:'rewind'},
        {i:8,n:'Kick Electro',ic:'⚡',t:'elec',st:'kick_e',f:55},{i:9,n:'Bass Drop',ic:'📉',t:'elec',st:'drop',f:40},
        {i:10,n:'Riser',ic:'🚀',t:'elec',st:'riser'},{i:11,n:'Stab',ic:'🗡️',t:'elec',st:'stab',f:440},
        {i:12,n:'Warner',ic:'🎬',t:'fx',st:'warner'},{i:13,n:'Champions',ic:'🏆',t:'fx',st:'champions'},
        {i:14,n:'Contagem',ic:'🔢',t:'fx',st:'contagem'},{i:15,n:'Houston',ic:'🌌',t:'fx',st:'houston'},
      ];
      preloads.forEach(p => { bank1.pads[p.i] = {id:p.i,label:p.n,icon:p.ic,sound:p.t,synthType:p.st,freq:p.f||440}; });
    }
    return { banks: [bank1], activeBank: 0 };
  };

  const [bankState, setBankState] = useState(loadBankState);
  /* uploadedSounds: { name -> AudioBuffer } — React state so re-render fires */
  const [uploadedSounds, setUploadedSounds] = useState({});
  /* mySounds: [{n,i,t:'sample',nm}] — React state so sidebar re-renders */
  const [mySounds, setMySounds] = useState([]);
  /* mySoundsIndex: persisted list of uploaded sound names for cloud recovery */
  const [mySoundsIndex, setMySoundsIndex] = useState([]);

  const [view, setView] = useState('pads');
  const [layout, setLayout] = useState('4x8');
  const [currentCat, setCurrentCat] = useState('🎉 Memes BR');
  const [flashIdx, setFlashIdx] = useState(null);
  const [padVol, setPadVol] = useState(80);
  const [assignModal, setAssignModal] = useState(null);
  const [bankModal, setBankModal] = useState(false);   // create/manage banks
  const [newBankName, setNewBankName] = useState('');
  const [renamingBank, setRenamingBank] = useState(null); // {id, name}
  const [padCfgModal, setPadCfgModal] = useState(null); // {padIdx}
  const [ytUrlA, setYtUrlA] = useState('');
  const [ytUrlB, setYtUrlB] = useState('');
  const [ytIdA, setYtIdA] = useState(null);
  const [ytIdB, setYtIdB] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [clips, setClips] = useState([]);
  const [playheadPx, setPlayheadPx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recTime, setRecTime] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [bpm, setBpmState] = useState(120);
  const [toastMsg, setToastMsg] = useState('');
  const [toastVisible, setToastVisible] = useState(false);

  const audioCtxRef = useRef(null);
  const micStreamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recChunksRef = useRef([]);
  const recIntervalRef = useRef(null);
  const analyserRef = useRef(null);
  const analyserAnimRef = useRef(null);
  const playAnimRef = useRef(null);
  const playStartRef = useRef(0);
  const playheadSecRef = useRef(0);
  const waveformRef = useRef(null);

  /* ── Derived ── */
  const activeBank = bankState.banks[bankState.activeBank] || bankState.banks[0];
  const padState = activeBank ? activeBank.pads : Array.from({length:TOTAL_PADS},(_,i)=>defaultPad(i));

  /* ── Persist ── */
  const saveBankState = (next) => {
    setBankState(next);
    try { localStorage.setItem('dj_banks_v2', JSON.stringify(next)); } catch {}
    KV.set('dj_banks_v2', next);  // push to cloud
  };

  // On mount: pull DJ banks from cloud
  useEffect(() => {
    KV.get('dj_banks_v2').then(cloud => {
      if (cloud && cloud.banks && cloud.banks.length > 0) {
        setBankState(cloud);
        try { localStorage.setItem('dj_banks_v2', JSON.stringify(cloud)); } catch {}
      }
    });
  }, []);

  const savePads = (newPads) => {
    const next = { ...bankState, banks: bankState.banks.map((b,i) => i===bankState.activeBank ? {...b, pads:newPads} : b) };
    saveBankState(next);
  };

  /* ── Keyboard ── */
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
      const idx = KEY_MAP[e.key.toLowerCase()];
      if (idx !== undefined) triggerPad(idx);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [bankState, padVol, uploadedSounds]);

  /* ── Audio Context ── */
  const getCtx = () => {
    if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext||window.webkitAudioContext)();
    if (audioCtxRef.current.state==='suspended') audioCtxRef.current.resume();
    return audioCtxRef.current;
  };

  const showToast = (msg, dur=2600) => {
    setToastMsg(msg); setToastVisible(true);
    setTimeout(()=>setToastVisible(false), dur);
  };

  /* ── Synth engine (same as before, inlined) ── */
  const playSynth = (type, freq, vol) => {
    const c = getCtx(); const now = c.currentTime;
    const g = c.createGain(); g.gain.value = vol; g.connect(c.destination);
    const noise = (dur) => { const b=c.createBuffer(1,c.sampleRate*dur,c.sampleRate); const d=b.getChannelData(0); for(let j=0;j<d.length;j++) d[j]=Math.random()*2-1; return b; };
    switch(type) {
      case 'kick':    { const o=c.createOscillator();o.connect(g);o.frequency.setValueAtTime(180,now);o.frequency.exponentialRampToValueAtTime(0.001,now+.5);g.gain.exponentialRampToValueAtTime(0.001,now+.5);o.start(now);o.stop(now+.5);break; }
      case 'snare':   { const s=c.createBufferSource();s.buffer=noise(.25);const f=c.createBiquadFilter();f.type='bandpass';f.frequency.value=2000;f.Q.value=.7;s.connect(f);f.connect(g);g.gain.exponentialRampToValueAtTime(0.001,now+.25);s.start(now);break; }
      case 'hat_c':   { const s=c.createBufferSource();s.buffer=noise(.08);const f=c.createBiquadFilter();f.type='highpass';f.frequency.value=8000;s.connect(f);f.connect(g);g.gain.exponentialRampToValueAtTime(0.001,now+.08);s.start(now);break; }
      case 'hat_o':   { const s=c.createBufferSource();s.buffer=noise(.4);const f=c.createBiquadFilter();f.type='highpass';f.frequency.value=6000;s.connect(f);f.connect(g);g.gain.exponentialRampToValueAtTime(0.001,now+.4);s.start(now);break; }
      case 'clap':    { [0,.01,.02].forEach(off=>{const s=c.createBufferSource();s.buffer=noise(.18);const f=c.createBiquadFilter();f.type='bandpass';f.frequency.value=1200;s.connect(f);f.connect(g);g.gain.setValueAtTime(vol*.5,now+off);g.gain.exponentialRampToValueAtTime(0.001,now+off+.18);s.start(now+off);});break; }
      case 'tom':     { const o=c.createOscillator();o.connect(g);o.frequency.setValueAtTime((freq||80)*2,now);o.frequency.exponentialRampToValueAtTime((freq||80)*.5,now+.35);g.gain.exponentialRampToValueAtTime(0.001,now+.35);o.start(now);o.stop(now+.35);break; }
      case 'crash':   { const s=c.createBufferSource();s.buffer=noise(1.2);const f=c.createBiquadFilter();f.type='highpass';f.frequency.value=4000;s.connect(f);f.connect(g);g.gain.exponentialRampToValueAtTime(0.001,now+1.2);s.start(now);break; }
      case 'ride':    { const s=c.createBufferSource();s.buffer=noise(.6);const f=c.createBiquadFilter();f.type='highpass';f.frequency.value=5000;s.connect(f);f.connect(g);g.gain.exponentialRampToValueAtTime(0.001,now+.6);s.start(now);break; }
      case 'rim':     { const o=c.createOscillator();o.connect(g);o.frequency.value=800;g.gain.exponentialRampToValueAtTime(0.001,now+.08);o.start(now);o.stop(now+.08);break; }
      case 'cowbell': { const o1=c.createOscillator();const o2=c.createOscillator();o1.frequency.value=562;o2.frequency.value=845;o1.type='square';o2.type='square';o1.connect(g);o2.connect(g);g.gain.exponentialRampToValueAtTime(0.001,now+.6);o1.start(now);o1.stop(now+.6);o2.start(now);o2.stop(now+.6);break; }
      case 'shaker':  { const s=c.createBufferSource();s.buffer=noise(.12);const f=c.createBiquadFilter();f.type='bandpass';f.frequency.value=7000;s.connect(f);f.connect(g);g.gain.exponentialRampToValueAtTime(0.001,now+.12);s.start(now);break; }
      case 'kick_e':  { const o=c.createOscillator();o.connect(g);o.frequency.setValueAtTime(200,now);o.frequency.exponentialRampToValueAtTime(0.001,now+.7);g.gain.exponentialRampToValueAtTime(0.001,now+.7);o.start(now);o.stop(now+.7);break; }
      case 'drop':    { const o=c.createOscillator();o.type='sawtooth';o.connect(g);o.frequency.setValueAtTime(400,now);o.frequency.exponentialRampToValueAtTime(30,now+1.5);g.gain.exponentialRampToValueAtTime(0.001,now+1.5);o.start(now);o.stop(now+1.5);break; }
      case 'riser':   { const o=c.createOscillator();o.type='sawtooth';o.connect(g);o.frequency.setValueAtTime(80,now);o.frequency.exponentialRampToValueAtTime(2000,now+2);g.gain.setValueAtTime(0.01,now);g.gain.linearRampToValueAtTime(vol,now+1.8);g.gain.exponentialRampToValueAtTime(0.001,now+2);o.start(now);o.stop(now+2);break; }
      case 'stab':    { const o=c.createOscillator();o.type='sawtooth';o.frequency.value=freq||440;const f=c.createBiquadFilter();f.type='lowpass';f.frequency.setValueAtTime(3000,now);f.frequency.exponentialRampToValueAtTime(200,now+.25);o.connect(f);f.connect(g);g.gain.exponentialRampToValueAtTime(0.001,now+.25);o.start(now);o.stop(now+.25);break; }
      case 'arp_up':  { [1,1.25,1.5,2].forEach((r,i)=>{const o=c.createOscillator();o.type='square';o.frequency.value=(freq||220)*r;o.connect(g);o.start(now+i*.1);o.stop(now+i*.1+.08);});break; }
      case 'sub':     { const o=c.createOscillator();o.frequency.value=freq||30;o.connect(g);g.gain.exponentialRampToValueAtTime(0.001,now+1.2);o.start(now);o.stop(now+1.2);break; }
      case 'glitch':  { for(let i=0;i<6;i++){const o=c.createOscillator();o.type='square';o.frequency.value=(freq||1000)*(Math.random()*4+.5);o.connect(g);o.start(now+i*.04);o.stop(now+i*.04+.03);}break; }
      case 'scratch': { const s=c.createBufferSource();s.buffer=noise(.3);const f=c.createBiquadFilter();f.type='bandpass';f.frequency.value=2000;s.connect(f);f.connect(g);g.gain.setValueAtTime(vol,now);g.gain.setValueAtTime(vol*.2,now+.1);g.gain.setValueAtTime(vol,now+.15);g.gain.exponentialRampToValueAtTime(0.001,now+.3);s.start(now);break; }
      case 'piano':   { const o=c.createOscillator();o.type='triangle';o.frequency.value=freq||261.63;o.connect(g);g.gain.setValueAtTime(vol,now);g.gain.exponentialRampToValueAtTime(0.001,now+1.5);o.start(now);o.stop(now+1.5);break; }
      case 'bass':    { const o=c.createOscillator();o.type='sawtooth';o.frequency.value=freq||65.4;const f=c.createBiquadFilter();f.type='lowpass';f.frequency.value=400;o.connect(f);f.connect(g);g.gain.exponentialRampToValueAtTime(0.001,now+.5);o.start(now);o.stop(now+.5);break; }
      case 'guitar':  { const o=c.createOscillator();o.type='sawtooth';o.frequency.value=freq||220;const f=c.createBiquadFilter();f.type='lowpass';f.frequency.value=2000;o.connect(f);f.connect(g);g.gain.exponentialRampToValueAtTime(0.001,now+.8);o.start(now);o.stop(now+.8);break; }
      case 'trumpet': { const o=c.createOscillator();o.type='square';o.frequency.value=freq||440;o.connect(g);g.gain.setValueAtTime(0.01,now);g.gain.linearRampToValueAtTime(vol,now+.05);g.gain.exponentialRampToValueAtTime(0.001,now+.5);o.start(now);o.stop(now+.5);break; }
      case 'flute':   { const o=c.createOscillator();o.type='sine';o.frequency.value=freq||523.25;o.connect(g);g.gain.setValueAtTime(0.01,now);g.gain.linearRampToValueAtTime(vol,now+.08);g.gain.exponentialRampToValueAtTime(0.001,now+1);o.start(now);o.stop(now+1);break; }
      case 'sax':     { const o=c.createOscillator();o.type='sawtooth';o.frequency.value=freq||293.66;const f=c.createBiquadFilter();f.type='bandpass';f.frequency.value=(freq||293.66)*1.5;f.Q.value=3;o.connect(f);f.connect(g);g.gain.exponentialRampToValueAtTime(0.001,now+.7);o.start(now);o.stop(now+.7);break; }
      case 'violin':  { const o=c.createOscillator();o.type='sawtooth';o.frequency.value=freq||659;o.connect(g);g.gain.setValueAtTime(0.01,now);g.gain.linearRampToValueAtTime(vol,now+.1);g.gain.exponentialRampToValueAtTime(0.001,now+1);o.start(now);o.stop(now+1);break; }
      case 'siren':   { const o=c.createOscillator();o.connect(g);o.frequency.setValueAtTime(700,now);o.frequency.exponentialRampToValueAtTime(1400,now+.5);o.frequency.exponentialRampToValueAtTime(700,now+1);g.gain.exponentialRampToValueAtTime(0.001,now+1);o.start(now);o.stop(now+1);break; }
      case 'claps':   { for(let i=0;i<12;i++){const s=c.createBufferSource();s.buffer=noise(.12);const f=c.createBiquadFilter();f.type='bandpass';f.frequency.value=1200;s.connect(f);f.connect(g);s.start(now+i*.08);}break; }
      case 'gunshot': { const s=c.createBufferSource();s.buffer=noise(.35);const f=c.createBiquadFilter();f.type='lowpass';f.frequency.value=2000;s.connect(f);f.connect(g);g.gain.setValueAtTime(vol*1.5,now);g.gain.exponentialRampToValueAtTime(0.001,now+.35);s.start(now);break; }
      case 'horn':    { [261.63,329.63,392,523.25].forEach((fr,i)=>{const o=c.createOscillator();o.type='square';o.frequency.value=fr;o.connect(g);o.start(now+i*.12);o.stop(now+i*.12+.2);});break; }
      case 'school':  { const o=c.createOscillator();o.frequency.value=800;o.connect(g);for(let i=0;i<6;i++){g.gain.setValueAtTime(vol,now+i*.12);g.gain.setValueAtTime(0,now+i*.12+.06);}o.start(now);o.stop(now+.8);break; }
      case 'brake':   { const s=c.createBufferSource();s.buffer=noise(.8);const f=c.createBiquadFilter();f.type='bandpass';f.frequency.value=3000;f.Q.value=2;s.connect(f);f.connect(g);g.gain.setValueAtTime(vol*.5,now);g.gain.linearRampToValueAtTime(vol,now+.4);g.gain.exponentialRampToValueAtTime(0.001,now+.8);s.start(now);break; }
      case 'airhorn': { const o=c.createOscillator();o.type='sawtooth';o.frequency.value=320;const o2=c.createOscillator();o2.type='sawtooth';o2.frequency.value=480;o.connect(g);o2.connect(g);g.gain.exponentialRampToValueAtTime(0.001,now+.8);o.start(now);o.stop(now+.8);o2.start(now);o2.stop(now+.8);break; }
      case 'whoosh':  { const s=c.createBufferSource();s.buffer=noise(.5);const f=c.createBiquadFilter();f.type='bandpass';f.frequency.value=2000;s.connect(f);f.connect(g);g.gain.setValueAtTime(0,now);g.gain.linearRampToValueAtTime(vol,now+.1);g.gain.exponentialRampToValueAtTime(0.001,now+.5);s.start(now);break; }
      case 'rewind':  { const o=c.createOscillator();o.type='sawtooth';o.connect(g);o.frequency.setValueAtTime(2000,now);o.frequency.exponentialRampToValueAtTime(80,now+.8);g.gain.exponentialRampToValueAtTime(0.001,now+.8);o.start(now);o.stop(now+.8);break; }
      case 'laser':   { const o=c.createOscillator();o.connect(g);o.frequency.setValueAtTime(3000,now);o.frequency.exponentialRampToValueAtTime(100,now+.4);g.gain.exponentialRampToValueAtTime(0.001,now+.4);o.start(now);o.stop(now+.4);break; }
      case 'bomb':    { const s=c.createBufferSource();s.buffer=noise(.8);const f=c.createBiquadFilter();f.type='lowpass';f.frequency.value=300;s.connect(f);f.connect(g);g.gain.setValueAtTime(0,now);g.gain.linearRampToValueAtTime(vol*1.5,now+.05);g.gain.exponentialRampToValueAtTime(0.001,now+.8);s.start(now);break; }
      case 'uepa':    { const o=c.createOscillator();o.connect(g);o.frequency.setValueAtTime(400,now);o.frequency.linearRampToValueAtTime(800,now+.1);o.frequency.linearRampToValueAtTime(600,now+.25);g.gain.exponentialRampToValueAtTime(0.001,now+.3);o.start(now);o.stop(now+.3);break; }
      case 'adriano': { [300,250,280,300,350].forEach((fr,i)=>{const o=c.createOscillator();o.type='triangle';o.frequency.value=fr;o.connect(g);o.start(now+i*.12);o.stop(now+i*.12+.1);});break; }
      case 'ronaldo': { const o=c.createOscillator();o.type='square';o.connect(g);o.frequency.setValueAtTime(250,now);o.frequency.linearRampToValueAtTime(400,now+.15);o.frequency.setValueAtTime(350,now+.2);o.frequency.linearRampToValueAtTime(500,now+.45);g.gain.exponentialRampToValueAtTime(0.001,now+.6);o.start(now);o.stop(now+.6);break; }
      case 'galvao':  { [350,300,320,280,350,400].forEach((fr,i)=>{const o=c.createOscillator();o.type='sine';o.frequency.value=fr;o.connect(g);o.start(now+i*.1);o.stop(now+i*.1+.09);});break; }
      case 'pamonha': { const o=c.createOscillator();o.type='triangle';o.connect(g);o.frequency.setValueAtTime(200,now);o.frequency.linearRampToValueAtTime(280,now+.3);o.frequency.linearRampToValueAtTime(180,now+.7);o.frequency.linearRampToValueAtTime(260,now+1);g.gain.exponentialRampToValueAtTime(0.001,now+1.1);o.start(now);o.stop(now+1.1);break; }
      case 'houston': { [320,280,300,260,300].forEach((fr,i)=>{const o=c.createOscillator();o.type='triangle';o.frequency.value=fr;o.connect(g);o.start(now+i*.15);o.stop(now+i*.15+.12);});break; }
      case 'contagem':{ for(let i=0;i<5;i++){const o=c.createOscillator();o.frequency.value=i===4?880:440;o.connect(g);o.start(now+i*.5);o.stop(now+i*.5+.1);}break; }
      case 'warner':  { [261.63,329.63,392,493.88,523.25].forEach((fr,i)=>{const o=c.createOscillator();o.type='square';const og=c.createGain();og.gain.value=vol*.7;o.frequency.value=fr;o.connect(og);og.connect(c.destination);og.gain.exponentialRampToValueAtTime(0.001,now+i*.08+.4);o.start(now+i*.08);o.stop(now+i*.08+.4);});break; }
      case 'champions':{ [392,523.25,659.25,783.99].forEach((fr,i)=>{const o=c.createOscillator();o.type='triangle';const og=c.createGain();og.gain.value=vol;o.frequency.value=fr;o.connect(og);og.connect(c.destination);og.gain.exponentialRampToValueAtTime(0.001,now+i*.25+.5);o.start(now+i*.25);o.stop(now+i*.25+.5);});break; }
      case 'fanfare': { [523.25,659.25,783.99,1046.5].forEach((fr,i)=>{const o=c.createOscillator();o.type='square';const og=c.createGain();og.gain.value=vol*.6;o.frequency.value=fr;o.connect(og);og.connect(c.destination);og.gain.exponentialRampToValueAtTime(0.001,now+i*.12+.4);o.start(now+i*.12);o.stop(now+i*.12+.4);});break; }
      case 'dramatic':{ [196,246.94,261.63].forEach((fr,i)=>{const o=c.createOscillator();o.type='sawtooth';const f=c.createBiquadFilter();f.type='lowpass';f.frequency.value=800;const og=c.createGain();og.gain.value=vol*.5;o.frequency.value=fr;o.connect(f);f.connect(og);og.connect(c.destination);og.gain.exponentialRampToValueAtTime(0.001,now+i*.4+1.5);o.start(now+i*.4);o.stop(now+i*.4+1.5);});break; }
      default: { const o=c.createOscillator();o.frequency.value=freq||440;o.connect(g);g.gain.exponentialRampToValueAtTime(0.001,now+.5);o.start(now);o.stop(now+.5); }
    }
  };

  /* ── Trigger pad ── */
  const triggerPad = (i) => {
    const p = padState[i];
    if (!p || !p.sound) return;
    setFlashIdx(i); setTimeout(()=>setFlashIdx(null),130);
    const vol = (padVol/100)*0.8;
    if (p.sound==='sample') {
      const buf = uploadedSounds[p.nm || p.label];
      if (!buf) { showToast(`⚠ Arquivo "${p.label}" não está carregado. Faça upload novamente.`); return; }
      const c2=getCtx(); const src=c2.createBufferSource(); src.buffer=buf;
      const g=c2.createGain(); g.gain.value=vol; src.connect(g); g.connect(c2.destination); src.start();
    } else { playSynth(p.synthType, p.freq, vol); }
  };

  /* ── Library items (merged base + my sounds) ── */
  const ALL_CATS = { ...BASE_LIBRARY, '📂 Meus Sons': mySounds };
  const catKeys = Object.keys(ALL_CATS);
  const catItems = ALL_CATS[currentCat] || [];

  const previewSound = (s) => {
    const vol=(padVol/100)*0.7;
    if (s.t==='sample') {
      const buf = uploadedSounds[s.nm||s.n];
      if (!buf) { showToast('Arquivo não carregado'); return; }
      const c2=getCtx(); const src=c2.createBufferSource(); src.buffer=buf;
      const g=c2.createGain(); g.gain.value=vol; src.connect(g); g.connect(c2.destination); src.start();
    } else { playSynth(s.st, s.f, vol); }
  };

  /* ── Assign sound to pad ── */
  const confirmAssign = (padIdx, snd) => {
    const newPad = {
      ...padState[padIdx],
      label: snd.n, icon: snd.i,
      sound: snd.t==='sample' ? 'sample' : snd.t,
      synthType: snd.t==='sample' ? null : snd.st,
      freq: snd.f || 440,
      nm: snd.t==='sample' ? (snd.nm||snd.n) : null,
    };
    savePads(padState.map((p,i)=>i===padIdx?newPad:p));
    setAssignModal(null);
    showToast(`${snd.n} → PAD ${padIdx+1} (${activeBank.name})`);
  };

  /* ── Clear a single pad ── */
  const clearPad = (i) => {
    savePads(padState.map((p,idx)=>idx===i?defaultPad(i):p));
    setPadCfgModal(null);
    showToast(`PAD ${i+1} limpo`);
  };

  /* ── Upload sounds: decode + persist base64 to cloud ── */
  const uploadSounds = (e) => {
    const c = getCtx();
    Array.from(e.target.files).forEach(file => {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        try {
          const arrayBuf = ev.target.result.slice(0);
          const buf = await c.decodeAudioData(arrayBuf);
          const nm = file.name;
          setUploadedSounds(prev => ({...prev, [nm]: buf}));
          setMySounds(prev => {
            if (prev.find(x=>x.nm===nm)) return prev;
            return [...prev, {n:nm, i:'🎵', t:'sample', nm}];
          });
          setCurrentCat('📂 Meus Sons');
          // Persist base64 to cloud so other devices can load it
          const b64reader = new FileReader();
          b64reader.onload = (ev2) => {
            const b64 = ev2.target.result; // data:audio/...;base64,...
            KV.set(`dj_sound_${nm}`, b64);
            // Save index of uploaded sounds
            setMySoundsIndex(prev => {
              const next = prev.find(x=>x.nm===nm) ? prev : [...prev, {n:nm, i:'🎵', t:'sample', nm}];
              KV.set('dj_my_sounds_index', next);
              return next;
            });
          };
          b64reader.readAsDataURL(new Blob([arrayBuf]));
          showToast(`✓ "${nm}" carregado e sincronizado`);
        } catch(err) {
          showToast(`❌ Erro ao decodificar: ${file.name}`);
          console.error(err);
        }
      };
      reader.onerror = () => showToast(`❌ Erro ao ler: ${file.name}`);
      reader.readAsArrayBuffer(file);
    });
    e.target.value = '';
  };

  /* ── Load sounds from cloud on mount ── */
  useEffect(() => {
    KV.get('dj_my_sounds_index').then(async index => {
      if (!index || !index.length) return;
      const c = getCtx();
      const loaded = [];
      for (const s of index) {
        try {
          const b64 = await KV.get(`dj_sound_${s.nm}`);
          if (!b64) continue;
          const res = await fetch(b64);
          const arrayBuf = await res.arrayBuffer();
          const buf = await c.decodeAudioData(arrayBuf);
          setUploadedSounds(prev => ({...prev, [s.nm]: buf}));
          loaded.push(s);
        } catch(err) { console.warn('Could not load sound:', s.nm, err); }
      }
      if (loaded.length) {
        setMySounds(prev => {
          const names = new Set(prev.map(x=>x.nm));
          const news = loaded.filter(x=>!names.has(x.nm));
          return news.length ? [...prev, ...news] : prev;
        });
        setMySoundsIndex(loaded);
        showToast(`✓ ${loaded.length} som(ns) carregado(s) da nuvem`);
      }
    });
  }, []);

  /* ── Mic recording ── */
  const getMic = async () => {
    if (!micStreamRef.current || !micStreamRef.current.active)
      micStreamRef.current = await navigator.mediaDevices.getUserMedia({audio:true});
    return micStreamRef.current;
  };

  const startAnalyser = (stream) => {
    const c=getCtx(); const src=c.createMediaStreamSource(stream);
    const an=c.createAnalyser(); an.fftSize=64; src.connect(an); analyserRef.current=an;
    const tick = () => {
      analyserAnimRef.current=requestAnimationFrame(tick);
      const d=new Uint8Array(an.frequencyBinCount); an.getByteFrequencyData(d);
      const avg=d.reduce((a,b)=>a+b,0)/d.length; setMicLevel(avg/255*100);
      if (waveformRef.current) Array.from(waveformRef.current.children).forEach((bar,i)=>{bar.style.height=((d[i]||0)/255*40+4)+'px';});
    };
    tick();
  };
  const stopAnalyser = () => { if(analyserAnimRef.current){cancelAnimationFrame(analyserAnimRef.current);analyserAnimRef.current=null;} setMicLevel(0); };

  const toggleRec = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      clearInterval(recIntervalRef.current);
      setIsRecording(false); stopAnalyser(); return;
    }
    try {
      const stream = await getMic();
      startAnalyser(stream);
      recChunksRef.current=[];
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = e => recChunksRef.current.push(e.data);
      mr.onstop = async () => {
        const blob=new Blob(recChunksRef.current,{type:'audio/webm'});
        const ab=await blob.arrayBuffer();
        const buf=await getCtx().decodeAudioData(ab);
        const nm=`🎙 Mic ${new Date().toLocaleTimeString('pt-BR')}`;
        setUploadedSounds(prev=>({...prev,[nm]:buf}));
        const newEntry = {n:nm,i:'🎙️',t:'sample',nm};
        setMySounds(prev=>[...prev, newEntry]);
        setMySoundsIndex(prev=>{
          const next=[...prev, newEntry];
          KV.set('dj_my_sounds_index', next);
          return next;
        });
        // persist mic recording as base64
        const b64 = `data:audio/webm;base64,${btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())))}`;
        KV.set(`dj_sound_${nm}`, b64);
        setCurrentCat('📂 Meus Sons');
        showToast(`✓ "${nm}" salvo e sincronizado`);
      };
      mr.start(); mediaRecorderRef.current=mr;
      setIsRecording(true); setRecTime(0);
      recIntervalRef.current=setInterval(()=>setRecTime(t=>t+1),1000);
      showToast('🔴 Gravando...');
    } catch { showToast('Permita acesso ao microfone!'); }
  };

  /* ── Bank management ── */
  const createBank = () => {
    const name = newBankName.trim() || `Pad ${bankState.banks.length+1}`;
    const newBank = defaultBank(name);
    const next = { banks:[...bankState.banks, newBank], activeBank: bankState.banks.length };
    saveBankState(next); setNewBankName(''); setBankModal(false);
    showToast(`✓ "${name}" criado e ativado`);
  };

  const switchBank = (idx) => {
    saveBankState({...bankState, activeBank:idx});
    showToast(`▶ ${bankState.banks[idx].name}`);
  };

  const deleteBank = (idx) => {
    if (bankState.banks.length===1) { showToast('Precisa ter ao menos 1 pad'); return; }
    if (!window.confirm(`Apagar "${bankState.banks[idx].name}"?`)) return;
    const banks = bankState.banks.filter((_,i)=>i!==idx);
    const active = Math.min(bankState.activeBank, banks.length-1);
    saveBankState({banks, activeBank:active});
  };

  const renameBank = () => {
    if (!renamingBank) return;
    const banks = bankState.banks.map((b,i)=>i===renamingBank.idx?{...b,name:renamingBank.name}:b);
    saveBankState({...bankState,banks}); setRenamingBank(null);
  };

  const duplicateBank = (idx) => {
    const src = bankState.banks[idx];
    const copy = {...defaultBank(src.name+' (cópia)'), pads:[...src.pads.map(p=>({...p}))]};
    const banks = [...bankState.banks, copy];
    saveBankState({...bankState, banks, activeBank:banks.length-1});
    showToast(`✓ "${copy.name}" criado`);
  };

  const clearAllPads = () => {
    if (!window.confirm('Limpar todos os pads deste banco?')) return;
    savePads(Array.from({length:TOTAL_PADS},(_,i)=>defaultPad(i)));
    showToast('Pads limpos.');
  };

  const exportConfig = () => {
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([JSON.stringify(bankState,null,2)],{type:'application/json'}));
    a.download='djstudio-banks.json'; a.click(); showToast('Exportado!');
  };

  const importConfig = (e) => {
    const file=e.target.files[0]; if(!file) return;
    const r=new FileReader();
    r.onload=ev=>{ try{ saveBankState(JSON.parse(ev.target.result)); showToast('Importado!'); }catch{ showToast('Arquivo inválido.'); } };
    r.readAsText(file); e.target.value='';
  };

  /* ── YouTube ── */
  const extractYTId = s => { const m=s.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/); return m?m[1]:null; };

  /* ── Studio ── */
  const addTrack = (name) => {
    const colors=['#00e5ff','#ff2d78','#00ff9d','#ffe000','#9b30ff','#ff7020'];
    setTracks(t=>[...t,{id:Date.now(),name,color:colors[t.length%colors.length],muted:false,solo:false}]);
  };
  const togglePlay = () => {
    if(isPlaying){setIsPlaying(false);cancelAnimationFrame(playAnimRef.current);return;}
    setIsPlaying(true); playStartRef.current=performance.now()-playheadSecRef.current*1000;
    const anim=()=>{ const s=(performance.now()-playStartRef.current)/1000; playheadSecRef.current=s; setPlayheadPx(s*zoom); playAnimRef.current=requestAnimationFrame(anim); };
    requestAnimationFrame(anim);
  };
  const stopPlayback = () => { setIsPlaying(false);cancelAnimationFrame(playAnimRef.current);playheadSecRef.current=0;setPlayheadPx(0); };

  const importAudioToStudio = (e) => {
    const file=e.target.files[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=async ev=>{
      const buf=await getCtx().decodeAudioData(ev.target.result.slice(0));
      const nm=file.name;
      setUploadedSounds(prev=>({...prev,[nm]:buf}));
      setMySounds(prev=>prev.find(x=>x.nm===nm)?prev:[...prev,{n:nm,i:'🎵',t:'sample',nm}]);
      if(!tracks.length) addTrack(nm);
      const targetColor=tracks[0]?.color||'#00e5ff';
      const targetId=tracks[0]?.id||Date.now();
      setClips(c=>[...c,{id:Date.now(),trackId:targetId,startFrac:0,durFrac:Math.min(buf.duration/60,.95),label:nm,color:targetColor}]);
      showToast(`✓ "${nm}" importado`);
    };
    reader.readAsArrayBuffer(file); e.target.value='';
  };

  /* ── Helpers ── */
  const recFmt = s=>`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  const gridCols = layout==='4x4'?4:8;
  const padH = layout==='2x8'?44:layout==='4x4'?80:60;

  /* ── Styles ── */
  const dj = {
    outer: { display:'flex',flexDirection:'column',height:'calc(100vh - 140px)',background:'#080810',borderRadius:14,overflow:'hidden',border:'1px solid #1a1a2e' },
    topbar: { display:'flex',alignItems:'center',gap:8,padding:'6px 12px',background:'#0f0f18',borderBottom:'1px solid #1e1e2e',flexShrink:0,flexWrap:'wrap',gap:6 },
    tab: a=>({ background:'transparent',border:`1px solid ${a?'#00e5ff':'#252535'}`,color:a?'#00e5ff':'#505060',fontFamily:"'Orbitron',sans-serif",fontSize:8,letterSpacing:2,padding:'4px 10px',borderRadius:4,cursor:'pointer' }),
    bankBtn: (a,color)=>({ background:a?color+'22':'transparent',border:`2px solid ${a?color:'#252535'}`,color:a?color:'#606070',fontFamily:"'Orbitron',sans-serif",fontSize:8,letterSpacing:1,padding:'4px 10px',borderRadius:5,cursor:'pointer',fontWeight:a?700:400,transition:'all .15s',position:'relative' }),
    sidebar: { width:200,flexShrink:0,background:'#0f0f18',borderRight:'1px solid #1a1a2e',display:'flex',flexDirection:'column',overflow:'hidden' },
    sndItem: { display:'flex',alignItems:'center',gap:5,padding:'5px 8px',marginBottom:2,background:'#12121c',border:'1px solid #1e1e2e',borderRadius:4,cursor:'pointer',fontSize:9 },
    djBtn: (c='#00e5ff')=>({ background:'transparent',border:`1px solid ${c}`,color:c,fontFamily:"'Orbitron',sans-serif",fontSize:8,letterSpacing:1,padding:'5px 10px',borderRadius:4,cursor:'pointer',whiteSpace:'nowrap' }),
    inp2: { background:'#08080f',border:'1px solid #252535',borderRadius:5,color:'#c8d0e0',fontFamily:"'Share Tech Mono',monospace",fontSize:11,padding:'6px 10px',outline:'none',width:'100%',boxSizing:'border-box' },
    pad: (i,empty,flash)=>({
      backgroundImage:empty?'none':`linear-gradient(135deg,${PAD_COLORS[i]}bb,${PAD_COLORS[i]}66)`,
      background:empty?'#12121c':undefined,
      border:`2px ${empty?'dashed':'solid'} ${empty?'#252535':PAD_COLORS[i]+'55'}`,
      borderRadius:8,cursor:'pointer',position:'relative',
      display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
      gap:2,overflow:'hidden',userSelect:'none',height:padH,
      transform:flash?'scale(0.88)':'scale(1)',
      filter:flash?'brightness(1.7)':'brightness(1)',
      transition:'transform 0.08s,filter 0.08s',
      boxShadow:empty?'none':`0 0 10px ${PAD_COLORS[i]}28`,
    }),
    catBtn: a=>({ background:'transparent',border:`1px solid ${a?'#00e5ff':'#252535'}`,color:a?'#00e5ff':'#505060',fontFamily:"'Orbitron',sans-serif",fontSize:7,letterSpacing:1,padding:'3px 6px',borderRadius:3,cursor:'pointer',margin:'2px' }),
  };

  const BANK_COLORS=['#00e5ff','#ff2d78','#00ff9d','#ffe000','#9b30ff','#ff7020','#44ddff','#ff4499'];

  return (
    <div>
      <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@700;900&family=Share+Tech+Mono&display=swap" rel="stylesheet"/>

      {/* Toast */}
      {toastVisible&&<div style={{position:'fixed',bottom:24,left:'50%',transform:'translateX(-50%)',background:'#0f0f18',border:'1px solid #00e5ff',color:'#00e5ff',fontFamily:"'Orbitron',sans-serif",fontSize:9,letterSpacing:2,padding:'8px 18px',borderRadius:6,zIndex:9999,boxShadow:'0 0 20px #00e5ff33'}}>{toastMsg}</div>}

      {/* Assign Modal */}
      {assignModal&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setAssignModal(null)}>
          <div style={{background:'#0f0f18',border:'1px solid #00e5ff',borderRadius:12,padding:20,width:400,boxShadow:'0 0 40px #00e5ff18'}} onClick={e=>e.stopPropagation()}>
            <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:11,letterSpacing:3,color:'#00e5ff',marginBottom:8}}>ATRIBUIR AO PAD</div>
            <div style={{fontSize:9,color:'#606070',marginBottom:14,letterSpacing:1}}>{assignModal.i} {assignModal.n} · banco: {activeBank.name}</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(8,1fr)',gap:5,marginBottom:14}}>
              {padState.map((_,i)=>(
                <div key={i} onClick={()=>confirmAssign(i,assignModal)}
                  style={{aspectRatio:'1',borderRadius:5,backgroundImage:`linear-gradient(135deg,${PAD_COLORS[i]}cc,${PAD_COLORS[i]}66)`,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Orbitron',sans-serif",fontSize:8,fontWeight:700,color:'#fff',textShadow:'0 1px 3px #0008',border:`1px solid ${PAD_COLORS[i]}44`}}
                  onMouseEnter={e=>{e.currentTarget.style.transform='scale(1.12)';}} onMouseLeave={e=>{e.currentTarget.style.transform='scale(1)';}}>
                  {padState[i].label?padState[i].icon||'🎵':i+1}
                </div>
              ))}
            </div>
            <div style={{display:'flex',justifyContent:'flex-end',gap:8}}>
              <button onClick={()=>setAssignModal(null)} style={dj.djBtn('#ff2d78')}>CANCELAR</button>
            </div>
          </div>
        </div>
      )}

      {/* Pad Config Modal */}
      {padCfgModal!==null&&(
        <Modal title={`PAD ${padCfgModal+1} — ${activeBank.name}`} onClose={()=>setPadCfgModal(null)}>
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            <div style={{fontSize:12,color:'var(--text-3)'}}>Som atual: <b>{padState[padCfgModal]?.label||'Vazio'}</b></div>
            <div style={{fontSize:11,color:'var(--text-3)'}}>Para trocar o som, use o botão PAD na barra lateral.</div>
            <div style={{display:'flex',gap:8,marginTop:4}}>
              <button style={{...btn('var(--red,#e74c3c)')}} onClick={()=>clearPad(padCfgModal)}>🗑 Limpar Pad</button>
              <button style={{...btn()}} onClick={()=>setPadCfgModal(null)}>Fechar</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Bank Modal */}
      {bankModal&&(
        <Modal title="Gerenciar Pads" onClose={()=>setBankModal(false)} wide>
          <div style={{display:'flex',flexDirection:'column',gap:16}}>
            {/* Existing banks */}
            <div>
              <div style={{fontSize:12,fontWeight:700,marginBottom:10,color:'var(--text-2)'}}>Pads existentes</div>
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                {bankState.banks.map((b,i)=>(
                  <div key={b.id} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',background:'var(--bg-input)',borderRadius:8,border:`1px solid ${i===bankState.activeBank?BANK_COLORS[i%8]+'66':'var(--border)'}`}}>
                    <div style={{width:10,height:10,borderRadius:'50%',background:BANK_COLORS[i%8],flexShrink:0}}/>
                    {renamingBank?.idx===i ? (
                      <input style={{...inp,flex:1,padding:'4px 8px',fontSize:12}} value={renamingBank.name}
                        onChange={e=>setRenamingBank({...renamingBank,name:e.target.value})}
                        onKeyDown={e=>{if(e.key==='Enter')renameBank();if(e.key==='Escape')setRenamingBank(null);}}
                        autoFocus/>
                    ) : (
                      <span style={{flex:1,fontSize:13,fontWeight:i===bankState.activeBank?700:400,color:i===bankState.activeBank?BANK_COLORS[i%8]:'var(--text-1)'}}>{b.name}</span>
                    )}
                    <div style={{display:'flex',gap:4}}>
                      {i!==bankState.activeBank&&<button style={{...btn(),padding:'4px 10px',fontSize:11}} onClick={()=>{switchBank(i);setBankModal(false);}}>Ativar</button>}
                      {renamingBank?.idx===i
                        ? <button style={{...btn(),padding:'4px 10px',fontSize:11}} onClick={renameBank}>OK</button>
                        : <button style={{...btn('var(--text-3)'),padding:'4px 10px',fontSize:11}} onClick={()=>setRenamingBank({idx:i,name:b.name})}>✏️</button>
                      }
                      <button style={{...btn(),padding:'4px 10px',fontSize:11}} onClick={()=>duplicateBank(i)}>⊕ Duplicar</button>
                      {bankState.banks.length>1&&<button style={{...btn('var(--red,#e74c3c)'),padding:'4px 10px',fontSize:11}} onClick={()=>deleteBank(i)}>🗑</button>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {/* Create new */}
            <div>
              <div style={{fontSize:12,fontWeight:700,marginBottom:8,color:'var(--text-2)'}}>Criar novo pad</div>
              <div style={{display:'flex',gap:8}}>
                <input style={{...inp,flex:1}} placeholder={`Pad ${bankState.banks.length+1}`} value={newBankName} onChange={e=>setNewBankName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&createBank()}/>
                <button style={btn()} onClick={createBank}>+ Criar</button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* ── MAIN CONTAINER ── */}
      <div style={dj.outer}>

        {/* TOPBAR */}
        <div style={dj.topbar}>
          <span style={{fontFamily:"'Orbitron',sans-serif",fontWeight:900,fontSize:13,letterSpacing:4,color:'#00e5ff',flexShrink:0}}>DJ<span style={{color:'#ff2d78'}}>STUDIO</span></span>

          {/* View tabs */}
          <div style={{display:'flex',gap:4}}>
            {[['pads','⬛ PADS'],['mixer','🎚 MIXER'],['studio','🎞 STUDIO']].map(([v,lbl])=>(
              <button key={v} style={dj.tab(view===v)} onClick={()=>setView(v)}>{lbl}</button>
            ))}
          </div>

          {/* BANK SWITCHER */}
          <div style={{display:'flex',gap:4,alignItems:'center',marginLeft:8,flexWrap:'wrap'}}>
            <span style={{fontSize:8,color:'#505060',fontFamily:"'Orbitron',sans-serif",letterSpacing:1,flexShrink:0}}>PADS</span>
            {bankState.banks.map((b,i)=>(
              <button key={b.id} style={dj.bankBtn(i===bankState.activeBank,BANK_COLORS[i%8])} onClick={()=>switchBank(i)} title={b.name}>
                {b.name.length>10?b.name.slice(0,9)+'…':b.name}
              </button>
            ))}
            <button style={{...dj.bankBtn(false,'#505060'),fontSize:12,padding:'3px 8px'}} onClick={()=>setBankModal(true)} title="Gerenciar Pads">⊕</button>
          </div>

          <div style={{marginLeft:'auto',display:'flex',gap:6,alignItems:'center'}}>
            {isRecording&&<span style={{fontFamily:"'Orbitron',sans-serif",fontSize:9,color:'#ff3333',letterSpacing:2,animation:'pulse 1s infinite'}}>⏺ {recFmt(recTime)}</span>}
            {layout==='pads'&&<div style={{display:'flex',gap:3}}>
              {['4x8','4x4','2x8'].map(l=><button key={l} style={dj.tab(layout===l)} onClick={()=>setLayout(l)}>{l}</button>)}
            </div>}
          </div>
        </div>

        {/* BODY */}
        <div style={{display:'flex',flex:1,overflow:'hidden'}}>

          {/* SIDEBAR */}
          <div style={dj.sidebar}>
            <div style={{padding:'7px 10px 4px',fontSize:8,letterSpacing:2,color:'#505060',fontFamily:"'Orbitron',sans-serif",borderBottom:'1px solid #1e1e2e'}}>🎵 SONS</div>
            <div style={{display:'flex',flexWrap:'wrap',padding:5,borderBottom:'1px solid #1e1e2e'}}>
              {catKeys.map(c=><button key={c} style={dj.catBtn(c===currentCat)} onClick={()=>setCurrentCat(c)}>{c}</button>)}
            </div>
            <div style={{flex:1,overflowY:'auto',padding:4}}>
              {catItems.length===0&&currentCat==='📂 Meus Sons'&&(
                <div style={{padding:10,fontSize:9,color:'#404050',textAlign:'center',lineHeight:1.6}}>
                  Use "+ SOM" abaixo para fazer upload de MP3/WAV.{'\n'}Após upload, os sons aparecem aqui.
                </div>
              )}
              {catItems.map((s,i)=>(
                <div key={i} style={dj.sndItem}>
                  <span style={{fontSize:12,flexShrink:0}}>{s.i}</span>
                  <span style={{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:'#c8d0e0'}}>{s.n}</span>
                  <button style={{...dj.djBtn('#505060'),fontSize:7,padding:'2px 4px'}} onClick={()=>previewSound(s)}>▶</button>
                  <button style={{...dj.djBtn('#00ff9d'),fontSize:7,padding:'2px 4px'}} onClick={()=>setAssignModal(s)}>PAD</button>
                </div>
              ))}
            </div>
            <div style={{padding:7,borderTop:'1px solid #1e1e2e',display:'flex',flexDirection:'column',gap:5}}>
              <label style={{...dj.djBtn('#00ff9d'),textAlign:'center',cursor:'pointer'}}>
                + SOM (MP3/WAV)
                <input type="file" accept="audio/*" multiple style={{display:'none'}} onChange={uploadSounds}/>
              </label>
              <div style={{display:'flex',gap:4}}>
                <button style={{...dj.djBtn('#505060'),flex:1,fontSize:7}} onClick={clearAllPads}>LIMPAR</button>
                <button style={{...dj.djBtn('#ffe000'),flex:1,fontSize:7}} onClick={exportConfig}>EXPORT</button>
                <label style={{...dj.djBtn('#ff2d78'),flex:1,fontSize:7,textAlign:'center',cursor:'pointer'}}>
                  IMPORT<input type="file" accept=".json" style={{display:'none'}} onChange={importConfig}/>
                </label>
              </div>
            </div>
          </div>

          {/* CENTER */}
          <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>

            {/* ── PADS ── */}
            {view==='pads'&&(
              <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',padding:10,gap:8}}>
                <div style={{display:'flex',gap:8,alignItems:'center',flexShrink:0,flexWrap:'wrap'}}>
                  <span style={{fontSize:9,color:'#505060'}}>VOL</span>
                  <input type="range" min={0} max={100} value={padVol} onChange={e=>setPadVol(Number(e.target.value))} style={{width:70,accentColor:'#00e5ff'}}/>
                  <span style={{fontSize:9,color:'#00e5ff',minWidth:28}}>{padVol}%</span>
                  <div style={{marginLeft:8,display:'flex',gap:3}}>
                    {['4x8','4x4','2x8'].map(l=><button key={l} style={dj.tab(layout===l)} onClick={()=>setLayout(l)}>{l}</button>)}
                  </div>
                  <div style={{marginLeft:'auto',fontSize:9,color:'#505060',fontFamily:"'Orbitron',sans-serif",letterSpacing:1}}>
                    {activeBank.name} · {padState.filter(p=>p.sound).length}/{TOTAL_PADS} pads
                  </div>
                </div>
                <div style={{flex:1,display:'grid',gridTemplateColumns:`repeat(${gridCols},1fr)`,gap:7,alignContent:'start',overflowY:'auto'}}>
                  {padState.map((p,i)=>(
                    <div key={i} style={dj.pad(i,!p.sound,flashIdx===i)}
                      onClick={()=>triggerPad(i)}
                      onDoubleClick={()=>setPadCfgModal(i)}
                      title={`PAD ${i+1}${p.label?': '+p.label:' (vazio)'} | Duplo clique = opções`}>
                      <span style={{position:'absolute',top:3,left:5,fontSize:7,opacity:.4,fontFamily:"'Orbitron',sans-serif"}}>{String(i+1).padStart(2,'0')}</span>
                      <span style={{position:'absolute',top:3,right:5,fontSize:6,opacity:.35,color:'#ffe000',fontFamily:"'Orbitron',sans-serif"}}>{KEY_LABELS[i]}</span>
                      <span style={{fontSize:layout==='2x8'?11:15}}>{p.icon||(p.sound?'🎵':'＋')}</span>
                      <span style={{fontFamily:"'Orbitron',sans-serif",fontSize:6,fontWeight:700,textAlign:'center',lineHeight:1.2,padding:'0 3px',wordBreak:'break-word',textShadow:'0 1px 4px #0008',color:!p.sound?'#2a2a3a':'inherit'}}>
                        {p.label||''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── MIXER ── */}
            {view==='mixer'&&(
              <div style={{flex:1,overflow:'auto',padding:12,display:'flex',flexDirection:'column',gap:10}}>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                  {[{lbl:'FAIXA A',url:ytUrlA,setUrl:setYtUrlA,ytId:ytIdA,load:()=>{const id=extractYTId(ytUrlA);if(id)setYtIdA(id);else showToast('Link inválido');}},
                    {lbl:'FAIXA B',url:ytUrlB,setUrl:setYtUrlB,ytId:ytIdB,load:()=>{const id=extractYTId(ytUrlB);if(id)setYtIdB(id);else showToast('Link inválido');}}
                  ].map((tr,ti)=>(
                    <div key={ti} style={{background:'#0f0f18',border:'1px solid #1e1e2e',borderRadius:8,padding:10}}>
                      <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:8,letterSpacing:2,color:'#505060',marginBottom:8}}>▶ {tr.lbl}</div>
                      <div style={{display:'flex',gap:6,marginBottom:8}}>
                        <input style={dj.inp2} placeholder="Cole link YouTube..." value={tr.url} onChange={e=>tr.setUrl(e.target.value)} onKeyDown={e=>e.key==='Enter'&&tr.load()}/>
                        <button style={dj.djBtn()} onClick={tr.load}>LOAD</button>
                      </div>
                      <div style={{width:'100%',aspectRatio:'16/9',background:'#000',borderRadius:6,overflow:'hidden',border:'1px solid #1e1e2e'}}>
                        {tr.ytId?<iframe src={`https://www.youtube.com/embed/${tr.ytId}?autoplay=1&controls=1`} style={{width:'100%',height:'100%',border:'none'}} allow="autoplay;encrypted-media" allowFullScreen/>
                          :<div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',color:'#303040',fontSize:10,letterSpacing:2}}>▶ AGUARDANDO</div>}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{background:'#0f0f18',border:'1px solid #1e1e2e',borderRadius:8,padding:12}}>
                  <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:8,letterSpacing:2,color:'#505060',marginBottom:8}}>🎙️ GRAVAR ÁUDIO</div>
                  <div style={{display:'flex',gap:10,alignItems:'center'}}>
                    <span style={{fontFamily:"'Orbitron',sans-serif",fontSize:18,color:'#ff2d78',letterSpacing:4,minWidth:60}}>{recFmt(recTime)}</span>
                    <div style={{flex:1,height:10,background:'#08080f',border:'1px solid #1e1e2e',borderRadius:2,overflow:'hidden'}}>
                      <div style={{height:'100%',background:'linear-gradient(90deg,#00ff9d,#ffe000,#ff3333)',width:micLevel+'%',transition:'width .05s'}}/>
                    </div>
                    <button style={{...dj.djBtn(isRecording?'#ff3333':'#00ff9d'),minWidth:80}} onClick={toggleRec}>{isRecording?'⏹ PARAR':'⏺ GRAVAR'}</button>
                  </div>
                  <div style={{fontSize:9,color:'#404050',marginTop:6}}>Grava mic → salva em "Meus Sons" → atribua a um pad</div>
                </div>
              </div>
            )}

            {/* ── STUDIO ── */}
            {view==='studio'&&(
              <div style={{flex:1,display:'flex',flexDirection:'column',padding:10,gap:8,overflow:'hidden'}}>
                <div style={{display:'flex',gap:6,alignItems:'center',flexShrink:0,flexWrap:'wrap'}}>
                  <button style={dj.djBtn(isRecording?'#ff3333':'#00ff9d')} onClick={toggleRec}>{isRecording?'⏹ STOP':'⏺ REC'}</button>
                  <button style={dj.djBtn(isPlaying?'#ffe000':'#00e5ff')} onClick={togglePlay}>{isPlaying?'⏸ PAUSE':'▶ PLAY'}</button>
                  <button style={dj.djBtn('#ff2d78')} onClick={stopPlayback}>⏹</button>
                  <span style={{fontSize:9,color:'#505060'}}>BPM</span>
                  <input type="number" value={bpm} min={40} max={300} onChange={e=>setBpmState(Number(e.target.value)||120)} style={{width:50,background:'#0f0f18',border:'1px solid #252535',color:'#00e5ff',fontFamily:"'Orbitron',sans-serif",fontSize:11,padding:'3px 6px',borderRadius:4,outline:'none'}}/>
                  <span style={{fontSize:9,color:'#505060',marginLeft:4}}>ZOOM</span>
                  <input type="range" min={30} max={300} value={zoom} onChange={e=>setZoom(Number(e.target.value))} style={{width:70,accentColor:'#00e5ff'}}/>
                  <div style={{marginLeft:'auto',display:'flex',gap:4}}>
                    <button style={dj.djBtn('#00ff9d')} onClick={()=>addTrack('Trilha '+(tracks.length+1))}>+ TRILHA</button>
                    <label style={{...dj.djBtn('#00e5ff'),cursor:'pointer'}}>+ AUDIO<input type="file" accept="audio/*" style={{display:'none'}} onChange={importAudioToStudio}/></label>
                  </div>
                </div>
                <div ref={waveformRef} style={{height:40,background:'#0f0f18',border:'1px solid #1e1e2e',borderRadius:6,display:'flex',alignItems:'center',padding:'0 8px',gap:2,flexShrink:0,overflow:'hidden'}}>
                  <span style={{fontSize:8,color:'#505060',letterSpacing:2,marginRight:6,flexShrink:0}}>IN</span>
                  {Array.from({length:40},(_,i)=><div key={i} style={{flex:1,height:4,background:'#00e5ff',opacity:.5,borderRadius:1,transition:'height .05s'}}/>)}
                </div>
                <div style={{flex:1,overflow:'auto',display:'flex',flexDirection:'column',gap:4}}>
                  {tracks.length===0&&<div style={{textAlign:'center',color:'#303040',fontSize:11,letterSpacing:2,padding:'40px 0'}}>Clique em "+ TRILHA" para começar</div>}
                  {tracks.map(tr=>(
                    <div key={tr.id} style={{display:'flex',height:52,flexShrink:0}}>
                      <div style={{width:110,flexShrink:0,background:'#0f0f18',border:'1px solid #1e1e2e',borderRadius:'6px 0 0 6px',padding:'6px 8px',display:'flex',flexDirection:'column',justifyContent:'space-between'}}>
                        <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:8,color:'#c8d0e0',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{tr.name}</div>
                        <div style={{display:'flex',gap:3}}>
                          {['M','S','✕'].map((lbl,li)=>(
                            <button key={li} onClick={()=>{
                              if(li===0)setTracks(t=>t.map(x=>x.id===tr.id?{...x,muted:!x.muted}:x));
                              else if(li===1)setTracks(t=>t.map(x=>x.id===tr.id?{...x,solo:!x.solo}:x));
                              else setTracks(t=>t.filter(x=>x.id!==tr.id));
                            }} style={{background:'transparent',border:`1px solid ${li===2?'#ff3333':li===0&&tr.muted?'#ff3333':li===1&&tr.solo?'#ffe000':'#252535'}`,color:li===2?'#ff3333':li===0&&tr.muted?'#ff3333':li===1&&tr.solo?'#ffe000':'#505060',fontSize:7,padding:'1px 4px',borderRadius:2,cursor:'pointer'}}>
                              {lbl}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div style={{flex:1,background:'#0f0f18',border:'1px solid #1e1e2e',borderLeft:'none',borderRadius:'0 6px 6px 0',position:'relative',cursor:'crosshair',overflow:'hidden'}}
                        onClick={e=>{const rect=e.currentTarget.getBoundingClientRect();const frac=(e.clientX-rect.left)/rect.width;setClips(c=>[...c,{id:Date.now(),trackId:tr.id,startFrac:frac,durFrac:0.05,label:'Clip',color:tr.color}]);}}>
                        <div style={{position:'absolute',top:0,bottom:0,left:playheadPx,width:2,background:'#ffe000',zIndex:5,boxShadow:'0 0 6px #ffe000',pointerEvents:'none'}}/>
                        {clips.filter(c=>c.trackId===tr.id).map(cl=>(
                          <div key={cl.id} style={{position:'absolute',top:4,height:'calc(100% - 8px)',left:(cl.startFrac*100)+'%',width:Math.max(cl.durFrac*100,4)+'%',background:cl.color+'33',border:`1px solid ${cl.color}`,borderRadius:4,display:'flex',alignItems:'center',padding:'0 6px',fontSize:8,color:cl.color,overflow:'hidden',whiteSpace:'nowrap',cursor:'grab',fontFamily:"'Orbitron',sans-serif"}}
                            onContextMenu={e=>{e.preventDefault();if(window.confirm('Remover?'))setClips(c=>c.filter(x=>x.id!==cl.id));}}>
                            {cl.label}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState("home");
  const market = useMarketData();
  const meta = PAGE_META[page]||PAGE_META.home;

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
      case "professional": return <ProfessionalPage/>;
      case "dj":            return <DJStudioPage/>;
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
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:6}}>
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








