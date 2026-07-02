export const config = { runtime: "edge" };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
};

const SYMBOLS = {
  // Américas
  americas: [
    { s:"^BVSP",   n:"Ibovespa",    flag:"🇧🇷" },
    { s:"^GSPC",   n:"S&P 500",     flag:"🇺🇸" },
    { s:"^IXIC",   n:"Nasdaq",      flag:"🇺🇸" },
    { s:"^DJI",    n:"Dow Jones",   flag:"🇺🇸" },
    { s:"^RUT",    n:"Russell 2000",flag:"🇺🇸" },
    { s:"^VIX",    n:"S&P VIX",     flag:"🇺🇸" },
    { s:"^GSPTSE", n:"Toronto",     flag:"🇨🇦" },
    { s:"^MXX",    n:"México",      flag:"🇲🇽" },
  ],
  // Europa
  europa: [
    { s:"^STOXX50E",n:"Euro Stoxx 50",flag:"🇪🇺" },
    { s:"^FTSE",    n:"Inglaterra",   flag:"🇬🇧" },
    { s:"^FCHI",    n:"França",       flag:"🇫🇷" },
    { s:"^GDAXI",   n:"Alemanha",     flag:"🇩🇪" },
    { s:"^AEX",     n:"Holanda",      flag:"🇳🇱" },
    { s:"^IBEX",    n:"Espanha",      flag:"🇪🇸" },
    { s:"^FTSEMIB", n:"Itália",       flag:"🇮🇹" },
    { s:"^SSMI",    n:"Suíça",        flag:"🇨🇭" },
  ],
  // Ásia
  asia: [
    { s:"^N225",  n:"Japão (Nikkei)",  flag:"🇯🇵" },
    { s:"^HSI",   n:"Hong Kong",       flag:"🇭🇰" },
    { s:"000001.SS",n:"China (Xangai)",flag:"🇨🇳" },
    { s:"^STI",   n:"Singapura",       flag:"🇸🇬" },
    { s:"^AXJO",  n:"Austrália",       flag:"🇦🇺" },
    { s:"^KS11",  n:"Coreia do Sul",   flag:"🇰🇷" },
    { s:"^SENSEX",n:"Índia",           flag:"🇮🇳" },
  ],
  // Futuros
  futuros: [
    { s:"ES=F",  n:"S&P 500 Fut",    flag:"🇺🇸" },
    { s:"NQ=F",  n:"Nasdaq Fut",     flag:"🇺🇸" },
    { s:"YM=F",  n:"Dow Jones Fut",  flag:"🇺🇸" },
    { s:"WIN=F", n:"Ibovespa Fut",   flag:"🇧🇷" },
    { s:"GC=F",  n:"Ouro Fut",       flag:"🟡" },
    { s:"SI=F",  n:"Prata Fut",      flag:"⚪" },
    { s:"CL=F",  n:"Petróleo WTI",   flag:"🛢" },
    { s:"BZ=F",  n:"Petróleo Brent", flag:"🛢" },
  ],
  // Câmbio
  cambio: [
    { s:"USDBRL=X",  n:"USD/BRL",  flag:"🇺🇸" },
    { s:"EURBRL=X",  n:"EUR/BRL",  flag:"🇪🇺" },
    { s:"GBPBRL=X",  n:"GBP/BRL",  flag:"🇬🇧" },
    { s:"JPYBRL=X",  n:"JPY/BRL",  flag:"🇯🇵" },
    { s:"EURUSD=X",  n:"EUR/USD",  flag:"🇪🇺" },
    { s:"GBPUSD=X",  n:"GBP/USD",  flag:"🇬🇧" },
    { s:"USDJPY=X",  n:"USD/JPY",  flag:"🇯🇵" },
    { s:"USDCNY=X",  n:"USD/CNY",  flag:"🇨🇳" },
    { s:"USDARS=X",  n:"USD/ARS",  flag:"🇦🇷" },
    { s:"USDCHF=X",  n:"USD/CHF",  flag:"🇨🇭" },
    { s:"USDCAD=X",  n:"USD/CAD",  flag:"🇨🇦" },
    { s:"USDMXN=X",  n:"USD/MXN",  flag:"🇲🇽" },
  ],
  // Commodities
  commodities: [
    { s:"GC=F",  n:"Ouro",          flag:"🟡" },
    { s:"SI=F",  n:"Prata",         flag:"⚪" },
    { s:"HG=F",  n:"Cobre",         flag:"🟠" },
    { s:"CL=F",  n:"Petróleo WTI",  flag:"🛢" },
    { s:"BZ=F",  n:"Petróleo Brent",flag:"🛢" },
    { s:"NG=F",  n:"Gás Natural",   flag:"🔥" },
    { s:"ZS=F",  n:"Soja",          flag:"🌱" },
    { s:"ZC=F",  n:"Milho",         flag:"🌽" },
    { s:"ZW=F",  n:"Trigo",         flag:"🌾" },
    { s:"KC=F",  n:"Café",          flag:"☕" },
  ],
  // Cripto
  cripto: [
    { s:"BTC-USD",  n:"Bitcoin",  flag:"₿" },
    { s:"ETH-USD",  n:"Ethereum", flag:"Ξ" },
    { s:"BNB-USD",  n:"BNB",      flag:"🔶" },
    { s:"SOL-USD",  n:"Solana",   flag:"◎" },
    { s:"XRP-USD",  n:"XRP",      flag:"✕" },
    { s:"ADA-USD",  n:"Cardano",  flag:"₳" },
    { s:"DOGE-USD", n:"Dogecoin", flag:"Ð" },
    { s:"AVAX-USD", n:"Avalanche",flag:"🔺" },
  ],
};

async function fetchYahoo(symbols) {
  const syms = symbols.map(s=>s.s).join(",");
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(syms)}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketTime,regularMarketPreviousClose`;
  const r = await fetch(url, { headers:{ "User-Agent":"Mozilla/5.0" } });
  const d = await r.json();
  const quotes = d?.quoteResponse?.result || [];
  const map = {};
  quotes.forEach(q => { map[q.symbol] = q; });
  return symbols.map(s => {
    const q = map[s.s] || {};
    const price = q.regularMarketPrice;
    const chg   = q.regularMarketChange;
    const pct   = q.regularMarketChangePercent;
    const prev  = q.regularMarketPreviousClose;
    const fmt   = (v, dec=2) => v != null ? v.toLocaleString("pt-BR",{minimumFractionDigits:dec,maximumFractionDigits:dec}) : "--";
    return {
      symbol: s.s,
      name:   s.n,
      flag:   s.flag,
      price:  price != null ? fmt(price, price < 10 ? 4 : price < 1000 ? 2 : 0) : "--",
      chg:    chg  != null ? (chg>=0?"+":"")+fmt(chg, chg < 10 ? 2 : 0) : "--",
      pct:    pct  != null ? (pct>=0?"+":"")+pct.toFixed(2)+"%" : "--",
      up:     chg  != null ? chg >= 0 : null,
      time:   q.regularMarketTime ? new Date(q.regularMarketTime*1000).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}) : "--",
    };
  });
}

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const [americas, europa, asia, futuros, cambio, commodities, cripto] = await Promise.all([
      fetchYahoo(SYMBOLS.americas),
      fetchYahoo(SYMBOLS.europa),
      fetchYahoo(SYMBOLS.asia),
      fetchYahoo(SYMBOLS.futuros),
      fetchYahoo(SYMBOLS.cambio),
      fetchYahoo(SYMBOLS.commodities),
      fetchYahoo(SYMBOLS.cripto),
    ]);
    return new Response(JSON.stringify({ americas, europa, asia, futuros, cambio, commodities, cripto, ts: Date.now() }), { headers: CORS });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status:500, headers: CORS });
  }
}
