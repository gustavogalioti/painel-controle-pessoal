export const config = { runtime: "edge" };

// Indicadores macro do Banco Central (SGS) — API pública, sem chave.
//   432    Meta Selic definida pelo Copom (% a.a.)
//   13522  IPCA acumulado em 12 meses (%)
//   433    IPCA variação mensal (%) -> acumulamos o ano corrente a partir dele
// Esses dados mudam no máximo 1x/mês (IPCA) ou em 8 reuniões/ano (Selic),
// então o CDN guarda a resposta por 6h: poucas idas ao BCB, mesmo com vários aparelhos.

const bcb = async (code, n) => {
  const r = await fetch(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados/ultimos/${n}?formato=json`, {
    headers: { Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`BCB ${code}: HTTP ${r.status}`);
  const arr = await r.json();
  if (!Array.isArray(arr)) throw new Error(`BCB ${code}: formato inesperado`);
  return arr
    .map(p => ({ date: p.data, value: parseFloat(String(p.valor).replace(",", ".")) }))
    .filter(p => p.date && Number.isFinite(p.value));
};

const parseBR = (s) => { const [d, m, y] = s.split("/").map(Number); return new Date(y, m - 1, d); };
const ym = (s) => { const d = parseBR(s); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

export default async function handler() {
  const [selicR, ipca12R, ipcaMR] = await Promise.allSettled([bcb(432, 10), bcb(13522, 2), bcb(433, 12)]);
  const out = { selic: null, ipca12m: null, ipcaAno: null, updated: new Date().toISOString() };

  if (selicR.status === "fulfilled" && selicR.value.length) {
    // A série 432 traz datas à frente (até a próxima reunião) — pegamos o último ponto que já vigora.
    const end = new Date(); end.setHours(23, 59, 59, 999);
    const vigente = selicR.value.filter(p => parseBR(p.date) <= end);
    const p = (vigente.length ? vigente : selicR.value).slice(-1)[0];
    out.selic = { value: p.value, asOf: p.date };
  }

  if (ipca12R.status === "fulfilled" && ipca12R.value.length) {
    const p = ipca12R.value.slice(-1)[0];
    out.ipca12m = { value: p.value, ref: ym(p.date) };
  }

  if (ipcaMR.status === "fulfilled" && ipcaMR.value.length) {
    const last = ipcaMR.value.slice(-1)[0];
    const year = parseBR(last.date).getFullYear();
    const months = ipcaMR.value.filter(p => parseBR(p.date).getFullYear() === year);
    const acc = (months.reduce((a, p) => a * (1 + p.value / 100), 1) - 1) * 100;
    out.ipcaAno = { value: acc, ref: ym(last.date) };
  }

  const ok = out.selic || out.ipca12m || out.ipcaAno;
  const why = (r) => r.status === "rejected" ? String(r.reason?.message || r.reason) : null;
  const detail = { selic: why(selicR), ipca12m: why(ipca12R), ipcaAno: why(ipcaMR) };
  return new Response(JSON.stringify(ok ? out : { error: "BCB indisponível", detail }), {
    status: ok ? 200 : 502,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": ok ? "public, s-maxage=21600, stale-while-revalidate=86400" : "no-store",
    },
  });
}
