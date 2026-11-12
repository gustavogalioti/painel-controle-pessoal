// Tela do Pedro: cena 3D em tela cheia + chat integrado (carregada com React.lazy pelo App).
// Se o WebGL falhar, cai pra foto do Pedro + chat (nunca tela branca).
import { useEffect, useRef, useState, useCallback } from "react";
import { PedroScene } from "./PedroScene.js";
import { detectCall } from "./names.js";

const ACTION_RE = /(\*[^*\n]+\*)/g;
function renderText(text) {
  return String(text || "").split(ACTION_RE).map((p, i) => (p.startsWith("*") && p.endsWith("*") && p.length > 2 ? <em key={i} style={{opacity:0.85}}>{p.slice(1, -1)}</em> : <span key={i}>{p}</span>));
}
function webglOk() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
}

const SAFE_B = "env(safe-area-inset-bottom, 0px)";
const roundBtn = { width:44, height:44, borderRadius:"50%", border:"none", background:"rgba(20,16,12,0.55)", color:"#fff", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, backdropFilter:"blur(6px)" };

export default function PedroScreen({ useKV, onBack, onOpenAdmin, notifPerm, onEnableNotif }) {
  const [messages, setMessages] = useKV("pedro_chat_v1", []);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState({ loading: true });
  const [bubble, setBubble] = useState(null);
  const [viewH, setViewH] = useState(() => (typeof window !== "undefined" ? (window.visualViewport?.height || window.innerHeight) : 700));
  const [engine, setEngine] = useState(null);
  const q = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
  const debug = q.has("pedrodebug");

  const canvasRef = useRef(null), sceneRef = useRef(null), bubbleRef = useRef(null), dockRef = useRef(null), listRef = useRef(null), bubbleTimer = useRef(null);

  // ---- cena 3D
  useEffect(() => {
    let dead = false, scene = null;
    (async () => {
      if (!webglOk()) { setStatus({ fallback: true }); return; }
      try {
        scene = new PedroScene({
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
        sceneRef.current = scene; scene.start();
        setStatus((o) => ({ ...o, loading: false }));
      } catch (e) {
        console.error("Pedro 3D indisponível:", e);
        try { scene?.dispose(); } catch {}
        if (!dead) setStatus({ fallback: true });
      }
    })();
    const ro = new ResizeObserver(() => sceneRef.current?.resize());
    if (canvasRef.current) ro.observe(canvasRef.current);
    return () => { dead = true; ro.disconnect(); sceneRef.current = null; scene?.dispose(); clearTimeout(bubbleTimer.current); };
  }, []);

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

  const say = useCallback((text) => {
    setBubble(text); clearTimeout(bubbleTimer.current);
    bubbleTimer.current = setTimeout(() => setBubble(null), Math.min(12000, 3500 + text.length * 55));
  }, []);

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

  return (
    <div style={{position:"fixed",left:0,top:0,width:"100%",height:viewH,zIndex:1500,background:"#1b1511",overflow:"hidden",fontFamily:"inherit"}}>
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

      {/* topo */}
      <div style={{position:"absolute",left:0,right:0,top:0,display:"flex",justifyContent:"space-between",alignItems:"center",padding:"max(10px, env(safe-area-inset-top, 0px)) 12px 0",zIndex:3,pointerEvents:"none"}}>
        <button onClick={onBack} title="Voltar ao painel" aria-label="Voltar ao painel" style={{...roundBtn,pointerEvents:"auto"}}>←</button>
        <div style={{display:"flex",gap:8,pointerEvents:"auto"}}>
          {notifPerm === "default" && <button onClick={onEnableNotif} title="Ativar notificações do Pedro" aria-label="Ativar notificações" style={roundBtn}>🔔</button>}
          <button onClick={onOpenAdmin} title="Memória do Pedro" aria-label="Memória do Pedro" style={roundBtn}>⚙️</button>
        </div>
      </div>
      {debug && <div style={{position:"absolute",left:12,top:64,zIndex:3,color:"#fff",fontSize:11,background:"rgba(0,0,0,0.5)",padding:"3px 7px",borderRadius:6}}>
        {status.fps ? `${status.fps.toFixed(0)} fps` : "…"} · nível {status.level ?? "-"} · {status.source || ""} · {engine || "chat?"}
      </div>}

      {/* chat */}
      <div ref={dockRef} style={{position:"absolute",left:0,right:0,bottom:0,zIndex:3,padding:`8px 10px calc(10px + ${SAFE_B})`,background:"linear-gradient(transparent, rgba(24,18,12,0.55) 35%)",display:"flex",flexDirection:"column",gap:8}}>
        {expanded && (
          <div ref={listRef} style={{maxHeight:"38vh",overflowY:"auto",display:"flex",flexDirection:"column",gap:6,padding:"2px 2px"}}>
            {messages.length === 0 && <div style={{color:"rgba(255,255,255,0.8)",fontSize:12,textAlign:"center",padding:8}}>Toque no Pedro pra dizer oi, ou chame ele: "Pedruxo!" 🐾</div>}
            {messages.map((m, i) => (
              <div key={i} style={{alignSelf:m.from === "pedro" ? "flex-start" : "flex-end",background:m.from === "pedro" ? "rgba(255,255,255,0.94)" : "var(--accent, #2563eb)",color:m.from === "pedro" ? "#3a2a1c" : "#fff",borderRadius:14,padding:"8px 12px",fontSize:14,maxWidth:"86%",whiteSpace:"pre-wrap",lineHeight:1.35}}>{renderText(m.text)}</div>
            ))}
          </div>
        )}
        {thinking && <div style={{color:"#fff",fontSize:12,textShadow:"0 1px 3px rgba(0,0,0,0.6)"}}>Pedro está digitando…</div>}
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <button onClick={() => setExpanded((v) => !v)} title={expanded ? "Esconder conversa" : "Ver conversa"} aria-label="Alternar histórico da conversa" style={{...roundBtn,flexShrink:0}}>{expanded ? "⌄" : "💬"}</button>
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} placeholder="Fala com o Pedro…" enterKeyHint="send"
            style={{flex:1,minWidth:0,height:44,borderRadius:22,border:"none",padding:"0 16px",fontSize:16,background:"rgba(255,255,255,0.95)",color:"#3a2a1c",outline:"none"}}/>
          <button onClick={send} disabled={thinking || !input.trim()} aria-label="Enviar" style={{...roundBtn,background:"var(--accent, #2563eb)",opacity:(thinking || !input.trim()) ? 0.5 : 1,flexShrink:0}}>➤</button>
        </div>
      </div>
    </div>
  );
}
