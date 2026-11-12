// Tela do Pedro: cena 3D em tela cheia + cuidados (barras, bandeja de brinquedos/comida, loja) + chat integrado
// (carregada com React.lazy pelo App). Se o WebGL falhar, cai pra foto do Pedro + chat (nunca tela branca).
import { useEffect, useRef, useState, useCallback } from "react";
import { PedroScene } from "./PedroScene.js";
import { detectCall } from "./names.js";
import { CATALOGO } from "./pet-state.js";
import { usePedroPet } from "./usePedroPet.js";
import DiaryPanel from "./ui/DiaryPanel.jsx";
import { unlockAudio, jingle, setSoundEnabled } from "./audio.js";

const ACTION_RE = /(\*[^*\n]+\*)/g;
function renderText(text) {
  return String(text || "").split(ACTION_RE).map((p, i) => (p.startsWith("*") && p.endsWith("*") && p.length > 2 ? <em key={i} style={{opacity:0.85}}>{p.slice(1, -1)}</em> : <span key={i}>{p}</span>));
}
function webglOk() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
}

const SAFE_B = "env(safe-area-inset-bottom, 0px)";
const roundBtn = { width:44, height:44, borderRadius:"50%", border:"none", background:"rgba(20,16,12,0.55)", color:"#fff", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, backdropFilter:"blur(6px)", padding:0 };
const BARS = [["fome", "🍗", "Fome"], ["sede", "💧", "Sede"], ["energia", "⚡", "Energia"], ["diversao", "🎾", "Diversão"], ["afeto", "💛", "Carinho"], ["higiene", "🫧", "Higiene"]];
const TOYS = ["bolinha", "ratinho", "pena"];
const TRAY = [
  { id: "bolinha", emoji: "🎾", label: "Bolinha" }, { id: "ratinho", emoji: "🐭", label: "Ratinho" }, { id: "pena", emoji: "🪶", label: "Pena" },
  { id: "comida", emoji: "🍗", label: "Comida" }, { id: "petisco", emoji: "🍪", label: "Petisco" },
];

export default function PedroScreen({ useKV, onBack, onOpenAdmin, notifPerm, onEnableNotif, abrirMsg = null }) {
  const [messages, setMessages] = useKV("pedro_chat_v1", []);
  // Fase 4: o SERVIDOR é o dono do estado (vida com o app fechado, diário, push); aqui é só um espelho com cuidados otimistas
  const P = usePedroPet();
  const { pet, petRef, diario } = P;
  const [diarioAberto, setDiarioAberto] = useState(false);

  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState({ loading: true });
  const [bubble, setBubble] = useState(null);
  const [shop, setShop] = useState(false);
  const [gain, setGain] = useState(null);
  const [ghost, setGhost] = useState(null);
  const [viewH, setViewH] = useState(() => (typeof window !== "undefined" ? (window.visualViewport?.height || window.innerHeight) : 700));
  const [engine, setEngine] = useState(null);
  const q = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
  const debug = q.has("pedrodebug");

  const canvasRef = useRef(null), sceneRef = useRef(null), bubbleRef = useRef(null), dockRef = useRef(null), listRef = useRef(null), bubbleTimer = useRef(null), gainTimer = useRef(null), dragRef = useRef(null);

  const say = useCallback((text) => {
    setBubble(text); clearTimeout(bubbleTimer.current);
    bubbleTimer.current = setTimeout(() => setBubble(null), Math.min(12000, 3500 + text.length * 55));
  }, []);

  // ---- eventos de cuidado vindos da cena (otimista + confirmação do servidor)
  const evRef = useRef(null);
  evRef.current = (ev) => {
    if (ev.type === "fala") { say(ev.text); return; }
    if (ev.type === "recusa") { if (ev.devolve) P.refundCookie(); return; }
    if (ev.type === "cancelado") return;
    const moedas = P.event(ev);
    if (moedas > 0) { setGain({ n: moedas, k: Date.now() }); jingle(); clearTimeout(gainTimer.current); gainTimer.current = setTimeout(() => setGain(null), 1800); }
  };
  const onPetEvent = useCallback((ev) => evRef.current(ev), []);

  // ---- cena 3D
  useEffect(() => {
    let dead = false, scene = null;
    (async () => {
      if (!webglOk()) { setStatus({ fallback: true }); return; }
      try {
        await Promise.race([P.firstSync.current, new Promise((r) => setTimeout(r, 4000))]); // nasce onde o servidor diz que ele está
        if (dead) return;
        const cur = petRef.current;
        scene = new PedroScene({
          initial: cur.atividade ? { poi: cur.local?.poi, tipo: cur.atividade.tipo, ate: cur.atividade.ate } : null,
          canvas: canvasRef.current, debug, forceLevel: q.get("pedronivel") != null ? parseInt(q.get("pedronivel"), 10) : null,
          hourOverride: q.get("pedrohora") ? parseFloat(q.get("pedrohora")) : null,
          onFrame: (s) => {
            const el = bubbleRef.current; if (!el) return;
            const p = s.headScreen();
            el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`;
          },
          onStatus: (st) => { if (st.error) setStatus({ fallback: true }); else setStatus((o) => ({ ...o, ...st })); },
        });
        await scene.init();
        if (dead) { scene.dispose(); return; }
        sceneRef.current = scene; if (debug) window.__pedroScene = scene; // debug: inspeção no console
        scene.setNeeds(petRef.current.necessidades); scene.setConfig(petRef.current.config); scene.setOutfit(petRef.current.inventario.vestindo);
        scene.onPetEvent = onPetEvent;
        scene.start();
        setStatus((o) => ({ ...o, loading: false }));
      } catch (e) {
        console.error("Pedro 3D indisponível:", e);
        try { scene?.dispose(); } catch {}
        if (!dead) setStatus({ fallback: true });
      }
    })();
    const ro = new ResizeObserver(() => sceneRef.current?.resize());
    if (canvasRef.current) ro.observe(canvasRef.current);
    return () => { dead = true; ro.disconnect(); sceneRef.current = null; scene?.dispose(); clearTimeout(bubbleTimer.current); clearTimeout(gainTimer.current); };
  }, []);

  // o handler muda quando o save muda; a cena sempre chama a versão mais recente
  useEffect(() => { if (sceneRef.current) sceneRef.current.onPetEvent = onPetEvent; }, [onPetEvent, status.loading]);
  useEffect(() => { sceneRef.current?.setNeeds(pet.necessidades); }, [pet.necessidades, status.loading]);
  useEffect(() => { sceneRef.current?.setConfig(pet.config); setSoundEnabled(pet.config.som !== false); }, [pet.config, status.loading]);
  useEffect(() => { sceneRef.current?.setOutfit(pet.inventario.vestindo); }, [pet.inventario.vestindo, status.loading]);

  // ---- altura útil (teclado do celular) e espaço do chat
  useEffect(() => {
    const vv = window.visualViewport; if (!vv) return;
    const on = () => setViewH(vv.height);
    vv.addEventListener("resize", on); on();
    return () => vv.removeEventListener("resize", on);
  }, []);
  useEffect(() => {
    const el = dockRef.current; if (!el) return;
    const ro = new ResizeObserver(() => sceneRef.current?.setInset(el.getBoundingClientRect().height));
    ro.observe(el); sceneRef.current?.setInset(el.getBoundingClientRect().height);
    return () => ro.disconnect();
  }, [status.loading, expanded]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [messages, expanded, thinking]);

  // ---- bandeja: arrastar brinquedos/comida/petisco pra dentro da cena (ou tocar)
  const onTrayDown = (item) => (e) => {
    unlockAudio(); e.preventDefault(); e.currentTarget.setPointerCapture?.(e.pointerId);
    if (item.id === "petisco" && pet.inventario.petiscos < 1) { say("Sem petiscos! Dá pra comprar na lojinha 🛍️"); return; }
    dragRef.current = { item, sx: e.clientX, sy: e.clientY, moved: false };
    setGhost({ emoji: item.emoji, x: e.clientX, y: e.clientY });
  };
  const onTrayMove = (e) => {
    const d = dragRef.current; if (!d) return;
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 8) d.moved = true;
    setGhost({ emoji: d.item.emoji, x: e.clientX, y: e.clientY });
    const dockTop = dockRef.current?.getBoundingClientRect().top ?? 1e9;
    if (d.moved && TOYS.includes(d.item.id)) sceneRef.current?.dragToy(d.item.id, e.clientX, e.clientY < dockTop ? e.clientY : -1);
  };
  const onTrayUp = (e) => {
    const d = dragRef.current; dragRef.current = null; setGhost(null);
    const sc = sceneRef.current; if (!d || !sc) return;
    const id = d.item.id, dockTop = dockRef.current?.getBoundingClientRect().top ?? 1e9;
    const inScene = e.clientY < dockTop;
    if (TOYS.includes(id)) { if (d.moved) sc.dropToy(id, e.clientX, inScene ? e.clientY : -1); else sc.tapToy(id); return; }
    if (id === "comida") { if (!d.moved || inScene) sc.feed("comida"); return; }
    if (id === "petisco") {
      if (d.moved && !inScene) return;
      if (!P.spendCookie()) return;
      const fp = d.moved ? sc._floorPoint(e.clientX, e.clientY) : null;
      const base = sc.actor.position;
      sc.eatCookie(fp || { x: base.x, z: base.z + 0.5 });
    }
  };

  // ---- loja
  const comprarItem = (id) => { const r = P.buy(id); if (r.ok) jingle(); else say(r.motivo === "sem_biscoitos" ? "Faltam biscoitos! Cuida de mim que eles aparecem 🍪" : "Esse já é meu! 😸"); };
  const toggleVestir = () => P.wear(pet.inventario.vestindo ? null : "roupinha");
  const toggleCfg = (k) => P.config({ [k]: !(petRef.current.config[k] !== false) });
  const togglePush = () => P.config({ push: { ligado: !petRef.current.config.push.ligado } });

  // ---- diário
  const abrirDiario = () => { unlockAudio(); setDiarioAberto(true); P.loadDiary(); };

  // novidades ao abrir: push que abriu o app (abrirMsg) ou entradas novas do diário
  const avisouRef = useRef(false);
  useEffect(() => {
    if (avisouRef.current || status.loading || !P.synced) return;
    avisouRef.current = true;
    if (abrirMsg) { say(abrirMsg); return; }
    if (diario.nao_lidos > 0) {
      const ultima = diario.entradas.find((e) => !e.lido && e.marcante) || diario.entradas.find((e) => !e.lido);
      say(ultima ? `Enquanto você não tava: ${ultima.texto} 📖` : "Tenho novidades no diário! 📖");
    }
  }, [status.loading, P.synced, diario, abrirMsg, say]);

  // ---- chat
  const send = async () => {
    const text = input.trim(); if (!text || thinking) return;
    const history = messages.slice(-12).map((m) => ({ from: m.from, text: m.text, at: m.at }));
    setMessages((prev) => [...prev, { from: "user", text, at: Date.now() }].slice(-60));
    setInput(""); setThinking(true);
    if (detectCall(text).called) sceneRef.current?.callPedro(); // otimista: vem antes da resposta chegar
    let reply;
    try {
      const r = await fetch("/api/pedro?action=chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text, history }) });
      const d = await r.json();
      setEngine(d.engine || null);
      reply = d.reply || "🐾";
    } catch { reply = "Escorreguei em algum lugar por aqui... tenta de novo? 😹"; }
    setMessages((prev) => [...prev, { from: "pedro", text: reply, at: Date.now() }].slice(-60));
    say(reply); setThinking(false);
  };

  const lastPedro = [...messages].reverse().find((m) => m.from === "pedro");
  const nec = pet.necessidades, inv = pet.inventario, somOn = pet.config.som !== false, vibOn = pet.config.vibracao !== false;

  return (
    <div style={{position:"fixed",left:0,top:0,width:"100%",height:viewH,zIndex:1500,background:"#1b1511",overflow:"hidden",fontFamily:"inherit",userSelect:"none",WebkitUserSelect:"none"}}>
      {status.fallback ? (
        <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:14,background:"linear-gradient(#f3e3c8,#d9b98a)",paddingBottom:140}}>
          <img src="/pedro-avatar.jpg" alt="Pedro" style={{width:"min(60vw,260px)",height:"min(60vw,260px)",borderRadius:"50%",objectFit:"cover",boxShadow:"0 8px 30px rgba(0,0,0,0.3)"}}/>
          <div style={{color:"#4a3524",fontSize:13,textAlign:"center",maxWidth:300,lineHeight:1.5}}>O mundo 3D do Pedro não abriu neste aparelho, mas ele continua aqui pra conversar 🐾</div>
          {lastPedro && <div style={{background:"#fff",color:"#3a2a1c",borderRadius:16,padding:"10px 14px",maxWidth:300,fontSize:14,boxShadow:"0 2px 10px rgba(0,0,0,0.15)"}}>{renderText(lastPedro.text)}</div>}
        </div>
      ) : (
        <>
          <canvas ref={canvasRef} style={{position:"absolute",inset:0,width:"100%",height:"100%",display:"block"}}/>
          {status.loading && <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12,background:"#f3e3c8",color:"#4a3524",fontSize:14}}>
            <img src="/pedro-avatar.jpg" alt="" style={{width:84,height:84,borderRadius:"50%",objectFit:"cover"}}/>Acordando o Pedro… 🐾
          </div>}
          <div ref={bubbleRef} style={{position:"absolute",left:0,top:0,pointerEvents:"none",zIndex:2,opacity:bubble?1:0,transition:"opacity .25s"}}>
            {bubble && <div style={{background:"#fff",color:"#3a2a1c",borderRadius:16,padding:"9px 13px",maxWidth:"min(78vw,300px)",fontSize:14,lineHeight:1.35,boxShadow:"0 3px 14px rgba(0,0,0,0.25)",marginBottom:6}}>{renderText(bubble)}</div>}
          </div>
        </>
      )}

      {/* topo: voltar / som / notificações / memória */}
      <div style={{position:"absolute",left:0,right:0,top:0,display:"flex",justifyContent:"space-between",alignItems:"center",padding:"max(10px, env(safe-area-inset-top, 0px)) 12px 0",zIndex:3,pointerEvents:"none"}}>
        <button onClick={onBack} title="Voltar ao painel" aria-label="Voltar ao painel" style={{...roundBtn,pointerEvents:"auto"}}>←</button>
        <div style={{display:"flex",gap:8,pointerEvents:"auto"}}>
          <button onClick={abrirDiario} title="Diário do Pedro" aria-label="Diário do Pedro" style={{...roundBtn,position:"relative"}}>📖
            {diario.nao_lidos > 0 && <span style={{position:"absolute",right:-2,top:-2,minWidth:18,height:18,borderRadius:9,background:"#e0405a",color:"#fff",fontSize:11,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 4px"}}>{diario.nao_lidos > 9 ? "9+" : diario.nao_lidos}</span>}
          </button>
          <button onClick={() => { unlockAudio(); toggleCfg("som"); }} title={somOn ? "Som ligado" : "Som desligado"} aria-label="Alternar som" style={roundBtn}>{somOn ? "🔊" : "🔇"}</button>
          {notifPerm === "default" && <button onClick={onEnableNotif} title="Ativar notificações do Pedro" aria-label="Ativar notificações" style={roundBtn}>🔔</button>}
          <button onClick={onOpenAdmin} title="Memória do Pedro" aria-label="Memória do Pedro" style={roundBtn}>⚙️</button>
        </div>
      </div>

      {/* necessidades (discretas) + biscoitos */}
      <div style={{position:"absolute",left:12,right:12,top:"calc(max(10px, env(safe-area-inset-top, 0px)) + 52px)",zIndex:3,display:"flex",alignItems:"center",gap:6,pointerEvents:"none"}}>
        <div style={{display:"flex",gap:6,flex:1,minWidth:0,background:"rgba(20,16,12,0.4)",borderRadius:12,padding:"5px 8px",backdropFilter:"blur(4px)"}}>
          {BARS.map(([k, emoji, nome]) => (
            <div key={k} title={`${nome}: ${Math.round(nec[k])}`} style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
              <span style={{fontSize:12,lineHeight:1}}>{emoji}</span>
              <div style={{width:"100%",height:4,borderRadius:2,background:"rgba(255,255,255,0.22)",overflow:"hidden"}}>
                <div style={{width:`${nec[k]}%`,height:"100%",background:nec[k] < 35 ? "#f0a850" : "#7fd68a",transition:"width .6s"}}/>
              </div>
            </div>
          ))}
        </div>
        <div style={{position:"relative",background:"rgba(20,16,12,0.5)",color:"#fff",borderRadius:12,padding:"5px 10px",fontSize:13,fontWeight:700,whiteSpace:"nowrap"}}>
          🍪 {inv.moedas}
          {gain && <span key={gain.k} style={{position:"absolute",right:4,top:"100%",color:"#ffd36b",fontWeight:800,fontSize:14,animation:"pedroGain 1.6s ease-out forwards"}}>+{gain.n} 🍪</span>}
        </div>
      </div>
      <style>{`@keyframes pedroGain{0%{opacity:0;transform:translateY(0)}15%{opacity:1}100%{opacity:0;transform:translateY(24px)}}@media (prefers-reduced-motion: reduce){@keyframes pedroGain{0%,100%{opacity:1}}}`}</style>
      {debug && <div style={{position:"absolute",left:12,top:"calc(max(10px, env(safe-area-inset-top, 0px)) + 96px)",zIndex:3,color:"#fff",fontSize:11,background:"rgba(0,0,0,0.5)",padding:"3px 7px",borderRadius:6}}>
        {status.fps ? `${status.fps.toFixed(0)} fps` : "…"} · nível {status.level ?? "-"} · {status.source || ""} · {engine || "chat?"} · {pet.humor}
      </div>}

      {/* loja */}
      {shop && (
        <div onClick={() => setShop(false)} style={{position:"absolute",inset:0,zIndex:6,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
          <div onClick={(e) => e.stopPropagation()} style={{width:"100%",maxWidth:460,background:"#fff8ec",color:"#3a2a1c",borderRadius:"20px 20px 0 0",padding:"16px 16px calc(16px + env(safe-area-inset-bottom, 0px))",boxShadow:"0 -6px 30px rgba(0,0,0,0.35)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div style={{fontWeight:800,fontSize:16}}>Lojinha do Pedro 🛍️</div>
              <div style={{fontWeight:700}}>🍪 {inv.moedas}</div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {Object.values(CATALOGO).map((it) => {
                const tem = inv.desbloqueados.includes(it.id);
                return (
                  <div key={it.id} style={{display:"flex",alignItems:"center",gap:10,background:"#fff",borderRadius:12,padding:"10px 12px",border:"1px solid #ecd9b9"}}>
                    <div style={{fontSize:26}}>{it.emoji}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:14,fontWeight:700}}>{it.nome}</div>
                      <div style={{fontSize:12,opacity:0.7}}>{it.tipo === "consumivel" ? `Você tem ${inv.petiscos}` : tem ? "Já é do Pedro" : "Roupinha"}</div>
                    </div>
                    {it.tipo === "vestir" && tem
                      ? <button onClick={toggleVestir} style={{minHeight:44,padding:"0 14px",borderRadius:12,border:"none",background:inv.vestindo ? "#e8d8bf" : "#2563eb",color:inv.vestindo ? "#3a2a1c" : "#fff",fontWeight:700,cursor:"pointer"}}>{inv.vestindo ? "Tirar" : "Vestir"}</button>
                      : <button onClick={() => comprarItem(it.id)} disabled={inv.moedas < it.preco} style={{minHeight:44,padding:"0 14px",borderRadius:12,border:"none",background:"#d97706",color:"#fff",fontWeight:700,cursor:"pointer",opacity:inv.moedas < it.preco ? 0.45 : 1}}>🍪 {it.preco}</button>}
                  </div>
                );
              })}
              {inv.presentes.length > 0 && <div style={{fontSize:13,background:"#fff",border:"1px dashed #ecd9b9",borderRadius:12,padding:"8px 12px"}}>🎁 Presentes do Pedro: {inv.presentes.slice(-5).map((g) => g.nome).join(" · ")}</div>}
              <label style={{display:"flex",alignItems:"center",gap:10,fontSize:14,minHeight:44}}>
                <input type="checkbox" checked={vibOn} onChange={() => toggleCfg("vibracao")} style={{width:20,height:20}}/> Vibração leve nos carinhos
              </label>
              <label style={{display:"flex",alignItems:"center",gap:10,fontSize:14,minHeight:44}}>
                <input type="checkbox" checked={pet.config.push.ligado} onChange={togglePush} style={{width:20,height:20}}/> <span>Avisos do Pedro no celular <span style={{opacity:0.65}}>(até {pet.config.push.max}/dia, sem incomodar das {pet.config.push.silencioDe}h às {pet.config.push.silencioAte}h)</span></span>
              </label>
            </div>
            <button onClick={() => setShop(false)} style={{marginTop:10,width:"100%",minHeight:44,borderRadius:12,border:"none",background:"#e8d8bf",color:"#3a2a1c",fontWeight:700,cursor:"pointer"}}>Fechar</button>
          </div>
        </div>
      )}

      {diarioAberto && <DiaryPanel diario={diario} onClose={() => setDiarioAberto(false)} onReact={P.react} onOpened={() => setTimeout(P.readDiary, 1500)}/>}

      {/* emoji que acompanha o dedo durante o arrasto da bandeja */}
      {ghost && <div style={{position:"fixed",left:ghost.x,top:ghost.y,transform:"translate(-50%,-130%)",fontSize:34,zIndex:9,pointerEvents:"none",filter:"drop-shadow(0 3px 4px rgba(0,0,0,0.4))"}}>{ghost.emoji}</div>}

      {/* dock: bandeja + chat */}
      <div ref={dockRef} style={{position:"absolute",left:0,right:0,bottom:0,zIndex:3,padding:`8px 10px calc(10px + ${SAFE_B})`,background:"linear-gradient(transparent, rgba(24,18,12,0.55) 35%)",display:"flex",flexDirection:"column",gap:8}}>
        {expanded && (
          <div ref={listRef} style={{maxHeight:"34vh",overflowY:"auto",display:"flex",flexDirection:"column",gap:6,padding:"2px 2px"}}>
            {messages.length === 0 && <div style={{color:"rgba(255,255,255,0.8)",fontSize:12,textAlign:"center",padding:8}}>Toque no Pedro pra dizer oi, faça carinho arrastando devagar, ou chame ele: "Pedruxo!" 🐾</div>}
            {messages.map((m, i) => (
              <div key={i} style={{alignSelf:m.from === "pedro" ? "flex-start" : "flex-end",background:m.from === "pedro" ? "rgba(255,255,255,0.94)" : "var(--accent, #2563eb)",color:m.from === "pedro" ? "#3a2a1c" : "#fff",borderRadius:14,padding:"8px 12px",fontSize:14,maxWidth:"86%",whiteSpace:"pre-wrap",lineHeight:1.35}}>{renderText(m.text)}</div>
            ))}
          </div>
        )}
        {thinking && <div style={{color:"#fff",fontSize:12,textShadow:"0 1px 3px rgba(0,0,0,0.6)"}}>Pedro está digitando…</div>}
        <div style={{display:"flex",gap:8,alignItems:"center",justifyContent:"center"}}>
          {TRAY.map((it) => (
            <button key={it.id} title={`${it.label} — arraste pra dentro da sala`} aria-label={it.label}
              onPointerDown={onTrayDown(it)} onPointerMove={onTrayMove} onPointerUp={onTrayUp} onPointerCancel={onTrayUp}
              style={{...roundBtn,width:46,height:46,fontSize:22,position:"relative",touchAction:"none",opacity:it.id === "petisco" && inv.petiscos < 1 ? 0.5 : 1}}>
              {it.emoji}
              {it.id === "petisco" && <span style={{position:"absolute",right:-2,top:-2,minWidth:16,height:16,borderRadius:8,background:"#d97706",color:"#fff",fontSize:10,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 3px"}}>{inv.petiscos}</span>}
            </button>
          ))}
          <button onClick={() => { unlockAudio(); setShop(true); }} title="Lojinha" aria-label="Lojinha" style={{...roundBtn,width:46,height:46,fontSize:22,background:"rgba(217,119,6,0.75)"}}>🛍️</button>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <button onClick={() => setExpanded((v) => !v)} title={expanded ? "Esconder conversa" : "Ver conversa"} aria-label="Alternar histórico da conversa" style={{...roundBtn,flexShrink:0}}>{expanded ? "⌄" : "💬"}</button>
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} placeholder="Fala com o Pedro…" enterKeyHint="send"
            style={{flex:1,minWidth:0,height:44,borderRadius:22,border:"none",padding:"0 16px",fontSize:16,background:"rgba(255,255,255,0.95)",color:"#3a2a1c",outline:"none",userSelect:"text",WebkitUserSelect:"text"}}/>
          <button onClick={send} disabled={thinking || !input.trim()} aria-label="Enviar" style={{...roundBtn,background:"var(--accent, #2563eb)",opacity:(thinking || !input.trim()) ? 0.5 : 1,flexShrink:0}}>➤</button>
        </div>
      </div>
    </div>
  );
}
