export const config = { runtime: "edge" };

const CORS = { "Access-Control-Allow-Origin":"*","Content-Type":"application/json" };

async function tvScan(tickers) {
  const r = await fetch("https://scanner.tradingview.com/global/scan", {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({
      symbols: { tickers, query: { types:[] } },
      columns: ["close","change","change_abs","volume","description"]
    })
  });
  const d = await r.json();
  return d?.data || [];
}

function makeRow(flag, name, sym, scanData) {
  const row = scanData.find(r => r.s === sym);
  const d   = row?.d || [];
  const price = d[0], pct = d[1], chg = d[2];
  const up = pct != null ? pct >= 0 : null;
  const fmt = (v, dec) => v != null ? Number(v).toLocaleString("pt-BR",{minimumFractionDigits:dec,maximumFractionDigits:dec}) : "--";
  return {
    flag, name,
    price: price != null ? fmt(price, price<1?4:price<10?3:price<1000?2:0) : "--",
    chg:   chg   != null ? (chg>=0?"+":"")+fmt(chg, Math.abs(chg)<10?2:0) : "--",
    pct:   pct   != null ? (pct>=0?"+":"")+Number(pct).toFixed(2)+"%" : "--",
    up,
  };
}

export default async function handler(req) {
  if (req.method==="OPTIONS") return new Response(null,{headers:CORS});
  try {
    const [scanAm, scanEu, scanAs, scanFut, scanFx, scanComm, scanCrypto] = await Promise.all([
      tvScan(["BMFBOVESPA:IBOV","SP:SPX","NASDAQ:NDX","DJ:DJI","INDEX:RTY","CBOE:VIX","TSX:TX60","BMV:IPC"]),
      tvScan(["INDEX:SX5E","LSE:UKX","EURONEXT:PX1","XETR:DAX","EURONEXT:AEX","BME:IBC","MIL:FTSEMIB","SMI:SMI"]),
      tvScan(["TVC:NI225","HSI:HSI","KRX:KOSPI","NSE:NIFTY50","ASX:XJO","SGX:STI"]),
      tvScan(["CME_MINI:ES1!","CME_MINI:NQ1!","CBOT_MINI:YM1!","BMFBOVESPA:WIN1!","COMEX:GC1!","COMEX:SI1!","NYMEX:CL1!","NYMEX:BZ1!"]),
      tvScan(["FX:USDBRL","FX:EURBRL","FX:GBPBRL","FX:EURJPY","FX:EURUSD","FX:GBPUSD","FX:USDJPY","FX:USDCNY","FX:USDARS","FX:USDCHF","FX:USDCAD","FX:USDMXN"]),
      tvScan(["COMEX:GC1!","COMEX:SI1!","NYMEX:CL1!","NYMEX:BZ1!","COMEX:HG1!","NYMEX:NG1!","CBOT:ZS1!","CBOT:ZC1!","CBOT:ZW1!"]),
      tvScan(["BITSTAMP:BTCUSD","BITSTAMP:ETHUSD","BINANCE:BNBUSDT","BINANCE:SOLUSDT","BITSTAMP:XRPUSD","BINANCE:ADAUSDT","BINANCE:DOGEUSDT","BINANCE:AVAXUSDT"]),
    ]);

    const mk = (f,n,s,data) => makeRow(f,n,s,data);

    return new Response(JSON.stringify({
      americas: [
        mk("🇧🇷","Ibovespa",      "BMFBOVESPA:IBOV", scanAm),
        mk("🇺🇸","S&P 500",       "SP:SPX",           scanAm),
        mk("🇺🇸","Nasdaq",         "NASDAQ:NDX",       scanAm),
        mk("🇺🇸","Dow Jones",      "DJ:DJI",           scanAm),
        mk("🇺🇸","Russell 2000",   "INDEX:RTY",        scanAm),
        mk("🇺🇸","S&P VIX",        "CBOE:VIX",         scanAm),
        mk("🇨🇦","Toronto",        "TSX:TX60",         scanAm),
        mk("🇲🇽","México",         "BMV:IPC",          scanAm),
      ],
      europa: [
        mk("🇪🇺","Euro Stoxx 50", "INDEX:SX5E",       scanEu),
        mk("🇬🇧","Inglaterra",     "LSE:UKX",          scanEu),
        mk("🇫🇷","França",         "EURONEXT:PX1",     scanEu),
        mk("🇩🇪","Alemanha",       "XETR:DAX",         scanEu),
        mk("🇳🇱","Holanda",        "EURONEXT:AEX",     scanEu),
        mk("🇪🇸","Espanha",        "BME:IBC",          scanEu),
        mk("🇮🇹","Itália",         "MIL:FTSEMIB",      scanEu),
        mk("🇨🇭","Suíça",          "SMI:SMI",          scanEu),
      ],
      asia: [
        mk("🇯🇵","Japão (Nikkei)", "TVC:NI225",        scanAs),
        mk("🇭🇰","Hong Kong",      "HSI:HSI",          scanAs),
        mk("🇰🇷","Coreia do Sul",  "KRX:KOSPI",        scanAs),
        mk("🇮🇳","Índia",          "NSE:NIFTY50",      scanAs),
        mk("🇦🇺","Austrália",      "ASX:XJO",          scanAs),
        mk("🇸🇬","Singapura",      "SGX:STI",          scanAs),
      ],
      futuros: [
        mk("🇺🇸","S&P 500 Fut",   "CME_MINI:ES1!",    scanFut),
        mk("🇺🇸","Nasdaq Fut",     "CME_MINI:NQ1!",    scanFut),
        mk("🇺🇸","Dow Jones Fut",  "CBOT_MINI:YM1!",   scanFut),
        mk("🇧🇷","Ibovespa Fut",   "BMFBOVESPA:WIN1!", scanFut),
        mk("🟡","Ouro Fut",        "COMEX:GC1!",       scanFut),
        mk("⚪","Prata Fut",       "COMEX:SI1!",       scanFut),
        mk("🛢","Petróleo WTI",    "NYMEX:CL1!",       scanFut),
        mk("🛢","Petróleo Brent",  "NYMEX:BZ1!",       scanFut),
      ],
      cambio: [
        mk("🇺🇸","USD/BRL","FX:USDBRL",scanFx), mk("🇪🇺","EUR/BRL","FX:EURBRL",scanFx),
        mk("🇬🇧","GBP/BRL","FX:GBPBRL",scanFx), mk("🇯🇵","JPY/BRL","FX:EURJPY",scanFx),
        mk("🇪🇺","EUR/USD","FX:EURUSD",scanFx), mk("🇬🇧","GBP/USD","FX:GBPUSD",scanFx),
        mk("🇯🇵","USD/JPY","FX:USDJPY",scanFx), mk("🇨🇳","USD/CNY","FX:USDCNY",scanFx),
        mk("🇦🇷","USD/ARS","FX:USDARS",scanFx), mk("🇨🇭","USD/CHF","FX:USDCHF",scanFx),
        mk("🇨🇦","USD/CAD","FX:USDCAD",scanFx), mk("🇲🇽","USD/MXN","FX:USDMXN",scanFx),
      ],
      commodities: [
        mk("🟡","Ouro",         "COMEX:GC1!", scanComm), mk("⚪","Prata",      "COMEX:SI1!", scanComm),
        mk("🛢","WTI",          "NYMEX:CL1!", scanComm), mk("🛢","Brent",      "NYMEX:BZ1!", scanComm),
        mk("🟠","Cobre",        "COMEX:HG1!", scanComm), mk("🔥","Gás Natural","NYMEX:NG1!", scanComm),
        mk("🌱","Soja",         "CBOT:ZS1!",  scanComm), mk("🌽","Milho",      "CBOT:ZC1!",  scanComm),
        mk("🌾","Trigo",        "CBOT:ZW1!",  scanComm),
      ],
      cripto: [
        mk("₿","Bitcoin",   "BITSTAMP:BTCUSD",   scanCrypto),
        mk("Ξ","Ethereum",  "BITSTAMP:ETHUSD",   scanCrypto),
        mk("🔶","BNB",      "BINANCE:BNBUSDT",   scanCrypto),
        mk("◎","Solana",    "BINANCE:SOLUSDT",   scanCrypto),
        mk("✕","XRP",       "BITSTAMP:XRPUSD",   scanCrypto),
        mk("₳","Cardano",   "BINANCE:ADAUSDT",   scanCrypto),
        mk("Ð","Dogecoin",  "BINANCE:DOGEUSDT",  scanCrypto),
        mk("🔺","Avalanche","BINANCE:AVAXUSDT",  scanCrypto),
      ],
      ts: Date.now()
    }), {headers:CORS});

  } catch(e) {
    return new Response(JSON.stringify({error:e.message}),{status:500,headers:CORS});
  }
}
