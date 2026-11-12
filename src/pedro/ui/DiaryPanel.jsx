// Diário do Pedro — linha do tempo por dia, com ícone do evento, 💛 (vira afeto + memória) e copiar uma entrada.
import { useEffect } from "react";

const ICONE = { dormir: "😴", descansar_janela: "🪟", comer: "🍗", beber: "💧", limpar: "🫧", amassar: "🧶", brincar: "🏃", explorar: "🐾", arranhar: "🪵", esconder: "📦", sentar: "🐱", tomar_sol: "☀️", passear: "🌿", cacar: "🦋", cheirar: "🌸", observar_passaro: "🐦" };
function icone(e) {
  if (e.ev?.descoberta) return "🔍"; if (e.ev?.chuva) return "🌧️"; if (e.ev?.borboleta) return "🦋"; if (e.ev?.visita) return "🐦";
  if (e.ev?.achado) return "🎁"; if (e.ev?.passarinho) return "🐦"; if (e.ev?.sonho != null) return "💭"; if (e.ev?.derrubou) return "🫢";
  if (e.tipo === "resumo") return "📝";
  return ICONE[e.evento] || "🐾";
}
const fmtHora = (iso) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
const diaKey = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));
function diaLabel(key) {
  const hoje = diaKey(new Date().toISOString()), ontem = diaKey(new Date(Date.now() - 86400000).toISOString());
  if (key === hoje) return "Hoje"; if (key === ontem) return "Ontem";
  const [, m, d] = key.split("-"); return `${d}/${m}`;
}

export default function DiaryPanel({ diario, onClose, onReact, onOpened }) {
  useEffect(() => { onOpened?.(); }, []);
  const grupos = [];
  for (const e of diario.entradas) { const k = diaKey(e.quando); const g = grupos.at(-1); if (g && g.k === k) g.itens.push(e); else grupos.push({ k, itens: [e] }); }
  const copiar = async (e) => { try { await navigator.clipboard.writeText(`🐾 Diário do Pedro (${diaLabel(diaKey(e.quando))}, ${fmtHora(e.quando)})\n${e.texto}`); } catch {} };

  return (
    <div onClick={onClose} style={{position:"absolute",inset:0,zIndex:6,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
      <div onClick={(e) => e.stopPropagation()} style={{width:"100%",maxWidth:480,maxHeight:"82%",display:"flex",flexDirection:"column",background:"#fff8ec",color:"#3a2a1c",borderRadius:"20px 20px 0 0",boxShadow:"0 -6px 30px rgba(0,0,0,0.35)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 16px 8px"}}>
          <div style={{fontWeight:800,fontSize:16}}>Diário do Pedro 📖</div>
          <button onClick={onClose} aria-label="Fechar diário" style={{width:44,height:44,borderRadius:22,border:"none",background:"#e8d8bf",cursor:"pointer",fontSize:16}}>✕</button>
        </div>
        <div style={{overflowY:"auto",padding:"0 16px calc(16px + env(safe-area-inset-bottom, 0px))"}}>
          {grupos.length === 0 && <div style={{opacity:0.7,fontSize:14,padding:"20px 0",textAlign:"center",lineHeight:1.5}}>Ainda não tem nada por aqui. Daqui a pouco o Pedro conta o que andou aprontando 🐾</div>}
          {grupos.map((g) => (
            <div key={g.k} style={{marginBottom:14}}>
              <div style={{fontSize:12,fontWeight:800,letterSpacing:1,opacity:0.6,margin:"6px 0"}}>{diaLabel(g.k).toUpperCase()}</div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {g.itens.map((e) => (
                  <div key={e.id} style={{display:"flex",gap:10,background:e.marcante ? "#fff" : "#fffdf8",border:`1px solid ${e.marcante ? "#f0c98a" : "#ecd9b9"}`,borderRadius:14,padding:"10px 12px"}}>
                    <div style={{fontSize:24,lineHeight:1.1}}>{icone(e)}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:14,lineHeight:1.4}}>{e.texto}</div>
                      <div style={{display:"flex",alignItems:"center",gap:6,marginTop:6,fontSize:11,opacity:0.8}}>
                        <span>{fmtHora(e.quando)}{!e.lido ? " · novo" : ""}</span>
                        <span style={{flex:1}}/>
                        <button onClick={() => copiar(e)} title="Copiar" aria-label="Copiar entrada" style={{minWidth:44,minHeight:36,border:"none",background:"transparent",cursor:"pointer",fontSize:15}}>📋</button>
                        <button onClick={() => !e.reacao && onReact(e.id)} title="Gostei" aria-label="Gostei" style={{minWidth:44,minHeight:36,border:"none",background:e.reacao ? "#ffe3ea" : "transparent",borderRadius:12,cursor:e.reacao ? "default" : "pointer",fontSize:16}}>{e.reacao ? "💛" : "🤍"}</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
