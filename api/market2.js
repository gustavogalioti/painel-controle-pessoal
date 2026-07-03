export const config = { runtime: "edge" };

const BRAPI = "4NkivGqSUVTRj1JX3TZSZ5";
const CORS  = { "Access-Control-Allow-Origin":"*","Content-Type":"application/json" };

const brapi = (symbols) =>
  fetch(`https://brapi.dev/api/quote/${symbols.map(encodeURIComponent).join(",")}?token=${BRAPI}`)
    .then(r=>r.json()).catch(()=>null);

const er = () =>
  fetch("https://open.er-api.com/v6/latest/USD").then(r=>r.json()).catch(()=>null);

const cg = (ids) =>
  fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd,brl&include_24hr_change=true`)
    .then(r=>r.json()).catch(()=>null);

function makeItem(flag, name, price, chg, pct, time) {
  const up = pct != null ? pct >= 0 : null;
  const fmt = (v, dec) => v != null ? Number(v).toLocaleString("pt-BR",{minimumFractionDigits:dec,maximumFractionDigits:dec}) : "--";
  return {
    flag, name,
    price: price != null ? fmt(price, price < 10 ? 4 : price < 1000 ? 2 : 0) : "--",
    chg:   chg   != null ? (chg>=0?"+":"")+fmt(chg, Math.abs(chg)<10?2:0) : "--",
    pct:   pct   != null ? (pct>=0?"+":"")+Number(pct).toFixed(2)+"%" : "--",
    up,
    time:  time  || "--",
  };
}

function fromBrapi(results, symbol, flag, name) {
  const q = (results || []).find(r => r.symbol?.toUpperCase() === symbol.toUpperCase().replace("%5E","^").replace("%3D","=").replace("%3A",":"));
  if (!q) return makeItem(flag, name, null, null, null, null);
  return makeItem(flag, name,
    q.regularMarketPrice,
    q.regularMarketChange,
    q.regularMarketChangePercent,
    q.regularMarketTime ? new Date(q.regularMarketTime*1000).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}) : null
  );
}

export default async function handler(req) {
  if (req.method==="OPTIONS") return new Response(null,{headers:CORS});
  try {
    // Fetch all in parallel
    const [
      brapiAmericas, brapiEuropa, brapiAsia, brapiFuturos,
      brapicambio, brapiComm, brapiComm2,
      cgData, erData
    ] = await Promise.all([
      brapi(["^BVSP","^GSPC","^IXIC","^DJI","^RUT","^VIX","^GSPTSE","^MXX"]),
      brapi(["^STOXX50E","^FTSE","^FCHI","^GDAXI","^AEX","^IBEX","^FTSEMIB","^SSMI"]),
      brapi(["^N225","^HSI","^KS11","^SENSEX","^AXJO","^STI"]),
      brapi(["ES=F","NQ=F","YM=F","GC=F","SI=F","CL=F","BZ=F"]),
      brapi(["USDBRL=X","EURBRL=X","GBPBRL=X","JPYBRL=X","EURUSD=X","GBPUSD=X","USDJPY=X","USDCNY=X","USDARS=X","USDCHF=X","USDCAD=X","USDMXN=X"]),
      brapi(["GC=F","SI=F","CL=F","BZ=F","HG=F","NG=F"]),
      brapi(["ZS=F","ZC=F","ZW=F"]),
      cg("bitcoin,ethereum,binancecoin,solana,ripple,cardano,dogecoin,avalanche-2"),
      er(),
    ]);

    const ra = brapiAmericas?.results || [];
    const re = brapiEuropa?.results   || [];
    const ri = brapiAsia?.results     || [];
    const rf = brapiFuturos?.results  || [];
    const rc = brapicambio?.results   || [];
    const rm = brapiComm?.results     || [];
    const rm2= brapiComm2?.results    || [];

    const fb = (res, sym, flag, name) => fromBrapi(res, sym, flag, name);

    const americas = [
      fb(ra,"^BVSP",   "🇧🇷","Ibovespa"),
      fb(ra,"^GSPC",   "🇺🇸","S&P 500"),
      fb(ra,"^IXIC",   "🇺🇸","Nasdaq"),
      fb(ra,"^DJI",    "🇺🇸","Dow Jones"),
      fb(ra,"^RUT",    "🇺🇸","Russell 2000"),
      fb(ra,"^VIX",    "🇺🇸","S&P VIX"),
      fb(ra,"^GSPTSE", "🇨🇦","Toronto"),
      fb(ra,"^MXX",    "🇲🇽","México"),
    ];

    const europa = [
      fb(re,"^STOXX50E","🇪🇺","Euro Stoxx 50"),
      fb(re,"^FTSE",    "🇬🇧","Inglaterra"),
      fb(re,"^FCHI",    "🇫🇷","França"),
      fb(re,"^GDAXI",   "🇩🇪","Alemanha"),
      fb(re,"^AEX",     "🇳🇱","Holanda"),
      fb(re,"^IBEX",    "🇪🇸","Espanha"),
      fb(re,"^FTSEMIB", "🇮🇹","Itália"),
      fb(re,"^SSMI",    "🇨🇭","Suíça"),
    ];

    const asia = [
      fb(ri,"^N225",   "🇯🇵","Japão (Nikkei)"),
      fb(ri,"^HSI",    "🇭🇰","Hong Kong"),
      fb(ri,"^KS11",   "🇰🇷","Coreia do Sul"),
      fb(ri,"^SENSEX", "🇮🇳","Índia"),
      fb(ri,"^AXJO",   "🇦🇺","Austrália"),
      fb(ri,"^STI",    "🇸🇬","Singapura"),
    ];

    const futuros = [
      fb(rf,"ES=F","🇺🇸","S&P 500 Fut"),
      fb(rf,"NQ=F","🇺🇸","Nasdaq Fut"),
      fb(rf,"YM=F","🇺🇸","Dow Fut"),
      fb(rf,"GC=F","🟡","Ouro Fut"),
      fb(rf,"SI=F","⚪","Prata Fut"),
      fb(rf,"CL=F","🛢","Petróleo WTI"),
      fb(rf,"BZ=F","🛢","Petróleo Brent"),
    ];

    const cambio = [
      fb(rc,"USDBRL=X","🇺🇸","USD/BRL"),
      fb(rc,"EURBRL=X","🇪🇺","EUR/BRL"),
      fb(rc,"GBPBRL=X","🇬🇧","GBP/BRL"),
      fb(rc,"JPYBRL=X","🇯🇵","JPY/BRL"),
      fb(rc,"EURUSD=X","🇪🇺","EUR/USD"),
      fb(rc,"GBPUSD=X","🇬🇧","GBP/USD"),
      fb(rc,"USDJPY=X","🇯🇵","USD/JPY"),
      fb(rc,"USDCNY=X","🇨🇳","USD/CNY"),
      fb(rc,"USDARS=X","🇦🇷","USD/ARS"),
      fb(rc,"USDCHF=X","🇨🇭","USD/CHF"),
      fb(rc,"USDCAD=X","🇨🇦","USD/CAD"),
      fb(rc,"USDMXN=X","🇲🇽","USD/MXN"),
    ];

    const commodities = [
      fb(rm,"GC=F","🟡","Ouro"),
      fb(rm,"SI=F","⚪","Prata"),
      fb(rm,"CL=F","🛢","Petróleo WTI"),
      fb(rm,"BZ=F","🛢","Petróleo Brent"),
      fb(rm,"HG=F","🟠","Cobre"),
      fb(rm,"NG=F","🔥","Gás Natural"),
      fb([...rm2],"ZS=F","🌱","Soja"),
      fb([...rm2],"ZC=F","🌽","Milho"),
      fb([...rm2],"ZW=F","🌾","Trigo"),
    ];

    // Cripto via CoinGecko
    const cgList = [
      {id:"bitcoin",       flag:"₿", name:"Bitcoin"},
      {id:"ethereum",      flag:"Ξ", name:"Ethereum"},
      {id:"binancecoin",   flag:"🔶",name:"BNB"},
      {id:"solana",        flag:"◎", name:"Solana"},
      {id:"ripple",        flag:"✕", name:"XRP"},
      {id:"cardano",       flag:"₳", name:"Cardano"},
      {id:"dogecoin",      flag:"Ð", name:"Dogecoin"},
      {id:"avalanche-2",   flag:"🔺",name:"Avalanche"},
    ];
    const cripto = cgList.map(({id,flag,name}) => {
      const d = cgData?.[id];
      return makeItem(flag, name, d?.usd||null, null, d?.usd_24h_change||null, null);
    });

    return new Response(JSON.stringify({americas,europa,asia,futuros,cambio,commodities,cripto,ts:Date.now()}),{headers:CORS});
  } catch(e) {
    return new Response(JSON.stringify({error:e.message}),{status:500,headers:CORS});
  }
}
