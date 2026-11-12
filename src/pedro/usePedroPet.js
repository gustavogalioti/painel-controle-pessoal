// Estado do Pedro no front (Fase 4): o SERVIDOR é o dono (pedro_pet_v1). Aqui só mantemos um espelho:
// - sincroniza ao abrir e a cada minuto (o servidor faz o catch-up da vida enquanto o app esteve fechado);
// - cuidados são aplicados de forma OTIMISTA (mesmas funções puras do servidor) e confirmados por POST;
// - sem servidor (stand by/offline) continua funcionando localmente.
import { useState, useRef, useCallback, useEffect } from "react";
import { normalizePet, applyEvent, comprar, gastarPetisco, vestir } from "./pet-state.js";

async function call(action, body) {
  const r = await fetch(`/api/pedro?action=${action}`, body !== undefined ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  return r.json();
}

export function usePedroPet() {
  const [pet, setPetState] = useState(() => normalizePet(null));
  const [diario, setDiario] = useState({ nao_lidos: 0, entradas: [] });
  const [synced, setSynced] = useState(false);
  const petRef = useRef(pet), inflight = useRef(0), firstSync = useRef(null);
  const setPet = useCallback((p) => { petRef.current = p; setPetState(p); }, []);

  const sync = useCallback(async () => {
    try {
      const d = await call("pet_state");
      if (d && d.pet && !d.standby) {
        if (inflight.current === 0) setPet(normalizePet(d.pet));
        if (d.diario) setDiario(d.diario);
        setSynced(true);
        return d;
      }
    } catch { /* offline: segue com o espelho local */ }
    return null;
  }, [setPet]);

  useEffect(() => {
    firstSync.current = sync();
    const id = setInterval(sync, 60000);
    return () => clearInterval(id);
  }, [sync]);

  const push = useCallback(async (body) => {
    inflight.current++;
    try {
      const d = await call("pet_update", body);
      if (d && d.pet && inflight.current === 1) setPet(normalizePet(d.pet)); // só a última resposta manda (sem "pulos")
      return d;
    } catch { return null; } finally { inflight.current--; }
  }, [setPet]);

  const event = useCallback((ev) => { const r = applyEvent(petRef.current, ev); setPet(r.pet); push({ ev }); return r.moedas; }, [setPet, push]);
  const buy = useCallback((id) => { const r = comprar(petRef.current, id); if (r.ok) { setPet(r.pet); push({ op: "comprar", item: id }); } return r; }, [setPet, push]);
  const wear = useCallback((id) => { setPet(vestir(petRef.current, id)); push({ op: "vestir", item: id || null }); }, [setPet, push]);
  const spendCookie = useCallback(() => { const r = gastarPetisco(petRef.current); if (r.ok) { setPet(r.pet); push({ op: "gastar_petisco" }); } return r.ok; }, [setPet, push]);
  const refundCookie = useCallback(() => { const p = petRef.current; setPet({ ...p, inventario: { ...p.inventario, petiscos: p.inventario.petiscos + 1 } }); push({ op: "devolver_petisco" }); }, [setPet, push]);
  const markTold = useCallback((id) => { const p = petRef.current; setPet({ ...p, contar: (p.contar || []).map((c) => (c.id === id ? { ...c, contada: true } : c)) }); push({ op: "contar_ok", id }); }, [setPet, push]);
  const config = useCallback((patch) => {
    const p = petRef.current;
    setPet({ ...p, config: { ...p.config, ...patch, push: { ...p.config.push, ...(patch.push || {}) } } });
    push({ op: "config", config: patch });
  }, [setPet, push]);

  const readDiary = useCallback(async () => { setDiario((d) => ({ ...d, nao_lidos: 0, entradas: d.entradas.map((e) => ({ ...e, lido: true })) })); try { await call("diary_read", { ids: "todos" }); } catch {} }, []);
  const react = useCallback(async (id) => {
    setDiario((d) => ({ ...d, entradas: d.entradas.map((e) => (e.id === id ? { ...e, reacao: true } : e)) }));
    try { await call("diary_react", { id }); sync(); } catch {}
  }, [sync]);
  const loadDiary = useCallback(async () => { try { const d = await call("diary?limit=120"); if (d?.entradas) setDiario(d); } catch {} }, []);

  return { pet, petRef, diario, synced, firstSync, sync, event, buy, wear, spendCookie, refundCookie, markTold, config, readDiary, react, loadDiary };
}
