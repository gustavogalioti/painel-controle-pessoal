export const config = { runtime: "edge" };

const BRAPI = "4NkivGqSUVTRj1JX3TZSZ5";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET",
  "Content-Type": "application/json",
};

export default async function handler(req) {
  try {
    const [brapiMain, brapiIdx, cg, aw] = await Promise.allSettled([
      fetch(`https://brapi.dev/api/quote/IBOV,USDBRL%3DX,EURBRL%3DX?token=${BRAPI}`).then(r => r.json()),
      fetch(`https://brapi.dev/api/quote/%5EGSPC,%5EIXIC,%5EDJI,%5EVIX?token=${BRAPI}`).then(r => r.json()),
      fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true").then(r => r.json()),
      fetch("https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL,XAU-USD,BRENT-USD").then(r => r.json()),
    ]);

    const result = {
      brapi_main: brapiMain.status === "fulfilled" ? brapiMain.value : null,
      brapi_idx:  brapiIdx.status  === "fulfilled" ? brapiIdx.value  : null,
      coingecko:  cg.status        === "fulfilled" ? cg.value        : null,
      awesome:    aw.status        === "fulfilled" ? aw.value        : null,
    };

    return new Response(JSON.stringify(result), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
