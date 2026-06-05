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
  const [active, setActive] = useState("diary");
  const tabs = [
    {id:"diary",     label:"📓 Diário",    color:"var(--accent)"},
    {id:"ideas",     label:"💡 Ideias",    color:"var(--purple)"},
    {id:"reminders", label:"🔔 Lembretes", color:"var(--yellow)"},
  ];
  return (
    <div>
      <div style={{display:"flex",gap:8,marginBottom:24}}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setActive(t.id)}
            style={{background:active===t.id?t.color:"var(--bg-card)",border:`1px solid ${active===t.id?t.color:"var(--border)"}`,borderRadius:24,padding:"10px 24px",color:active===t.id?t.id==="reminders"?"#000":"#fff":"var(--text-2)",fontSize:14,fontWeight:700,cursor:"pointer",transition:"all .2s"}}>
            {t.label}
          </button>
        ))}
      </div>
      <div style={{animation:"fadeIn .2s ease"}}>
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
  const [lists, setLists] = useState(()=>S.get("lists",[]));
  const [modal, setModal] = useState(false);
  const [detail, setDetail] = useState(null);
  const [form, setForm]   = useState({title:"",text:""});
  const [addText, setAddText] = useState("");

  const save = n=>{ setLists(n); S.set("lists",n); };
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
    const saved=localStorage.getItem(storKey);
    if(saved){ const img=new Image(); img.onload=()=>ctx.drawImage(img,0,0); img.src=saved; }
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
    localStorage.setItem(storKey, canvasRef.current.toDataURL());
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
