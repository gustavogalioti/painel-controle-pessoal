export const config = { runtime: "edge" };

const CORS = { "Access-Control-Allow-Origin":"*","Content-Type":"application/json" };

// Brapi — funciona com ações BR e câmbio
const brapi = (syms) =>
  fetch(`https://brapi.dev/api/quote/${syms.join(",")}?token=4NkivGqSUVTRj1JX3TZSZ5`)
    .then(r=>r.json()).catch(()=>({results:[]}));

// CoinGecko — cripto
const cg = () =>
  fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,binancecoin,solana,ripple,cardano,dogecoin,avalanche-2&vs_currencies=usd,brl&include_24hr_change=true")
    .then(r=>r.json()).catch(()=>({}));

// ExchangeRate — câmbio USD base
const er = () =>
  fetch("https://open.er-api.com/v6/latest/USD")
    .then(r=>r.json()).catch(()=>null);

function item(flag, name, price, chg, pct, time) {
  const up = pct!=null ? pct>=0 : null;
  const f  = (v,d) => v!=null ? Number(v).toLocaleString("pt-BR",{minimumFractionDigits:d,maximumFractionDigits:d}) : "--";
  return {
    flag, name,
    price: price!=null ? f(price, price<1?4:price<10?4:price<1000?2:0) : "--",
    chg:   chg!=null   ? (chg>=0?"+":"")+f(chg, Math.abs(chg)<10?2:0)   : "--",
    pct:   pct!=null   ? (pct>=0?"+":"")+Number(pct).toFixed(2)+"%"      : "--",
    up, time: time||"--",
  };
}

function fromBrapi(results, sym, flag, name) {
  const q = (results||[]).find(r => r.symbol?.toUpperCase()===sym.toUpperCase());
  if (!q) return item(flag,name,null,null,null,null);
  return item(flag,name,
    q.regularMarketPrice,
    q.regularMarketChange,
    q.regularMarketChangePercent,
    q.regularMarketTime ? new Date(q.regularMarketTime*1000).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}) : null
  );
}

function fromER(rates, from, to, flag, name) {
  if (!rates) return item(flag,name,null,null,null,null);
  const r = rates[to];
  if (!r) return item(flag,name,null,null,null,null);
  return item(flag,name, 1/r, null, null, null);
}

export default async function handler(req) {
  if (req.method==="OPTIONS") return new Response(null,{headers:CORS});
  try {
    // Fetch apenas o que funciona no Edge Vercel
    const [brapiData, cgData, erData] = await Promise.all([
      brapi(["USDBRL=X","EURBRL=X","GBPBRL=X","JPYBRL=X",
             "EURUSD=X","GBPUSD=X","USDJPY=X","USDCNY=X",
             "USDARS=X","USDCHF=X","USDCAD=X","USDMXN=X",
             "GC=F","SI=F","CL=F","BZ=F","HG=F","NG=F",
             "ZS=F","ZC=F","ZW=F","ES=F","NQ=F","YM=F","GC=F","SI=F"]),
      cg(),
      er(),
    ]);

    const br = brapiData?.results || [];
    const fb = (s,f,n) => fromBrapi(br,s,f,n);

    const cambio = [
      fb("USDBRL=X","🇺🇸","USD/BRL"), fb("EURBRL=X","🇪🇺","EUR/BRL"),
      fb("GBPBRL=X","🇬🇧","GBP/BRL"), fb("JPYBRL=X","🇯🇵","JPY/BRL"),
      fb("EURUSD=X","🇪🇺","EUR/USD"), fb("GBPUSD=X","🇬🇧","GBP/USD"),
      fb("USDJPY=X","🇯🇵","USD/JPY"), fb("USDCNY=X","🇨🇳","USD/CNY"),
      fb("USDARS=X","🇦🇷","USD/ARS"), fb("USDCHF=X","🇨🇭","USD/CHF"),
      fb("USDCAD=X","🇨🇦","USD/CAD"), fb("USDMXN=X","🇲🇽","USD/MXN"),
    ];

    const commodities = [
      fb("GC=F","🟡","Ouro"),       fb("SI=F","⚪","Prata"),
      fb("CL=F","🛢","Petróleo WTI"),fb("BZ=F","🛢","Petróleo Brent"),
      fb("HG=F","🟠","Cobre"),      fb("NG=F","🔥","Gás Natural"),
      fb("ZS=F","🌱","Soja"),       fb("ZC=F","🌽","Milho"),
      fb("ZW=F","🌾","Trigo"),
    ];

    const futuros = [
      fb("ES=F","🇺🇸","S&P 500 Fut"), fb("NQ=F","🇺🇸","Nasdaq Fut"),
      fb("YM=F","🇺🇸","Dow Fut"),
    ];

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
      return item(flag,name, d?.usd||null, null, d?.usd_24h_change||null, null);
    });

    return new Response(JSON.stringify({
      cambio, commodities, futuros, cripto,
      // Índices mundiais virão do TradingView widget no frontend
      americas:[], europa:[], asia:[],
      ts: Date.now()
    }),{headers:CORS});

  } catch(e) {
    return new Response(JSON.stringify({error:e.message}),{status:500,headers:CORS});
  }
}
