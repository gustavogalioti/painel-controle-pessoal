export const config = { runtime: "edge" };

const BRAPI = "4NkivGqSUVTRj1JX3TZSZ5";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET",
  "Content-Type": "application/json",
};

export default async function handler(req) {
  try {
    // Brapi free plan: 1 ativo por request — chamadas separadas
    const [usdR, ibovR, spR, nqR, djR, vixR, cgR, erR] = await Promise.allSettled([
      fetch(`https://brapi.dev/api/quote/USDBRL%3DX?token=${BRAPI}`).then(r => r.json()),
      fetch(`https://brapi.dev/api/quote/IBOV?token=${BRAPI}`).then(r => r.json()),
      fetch(`https://brapi.dev/api/quote/%5EGSPC?token=${BRAPI}`).then(r => r.json()),
      fetch(`https://brapi.dev/api/quote/%5EIXIC?token=${BRAPI}`).then(r => r.json()),
      fetch(`https://brapi.dev/api/quote/%5EDJI?token=${BRAPI}`).then(r => r.json()),
      fetch(`https://brapi.dev/api/quote/%5EVIX?token=${BRAPI}`).then(r => r.json()),
      // CoinGecko — sem limite, sem auth
      fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,gold&vs_currencies=usd&include_24hr_change=true").then(r => r.json()),
      // ExchangeRate — câmbio livre
      fetch("https://open.er-api.com/v6/latest/USD").then(r => r.json()),
    ]);

    const get = (r) => r.status === "fulfilled" ? r.value?.results?.[0] : null;
    const cg  = cgR.status  === "fulfilled" ? cgR.value  : null;
    const er  = erR.status  === "fulfilled" ? erR.value  : null;

    const usd  = get(usdR);
    const ibov = get(ibovR);
    const sp   = get(spR);
    const nq   = get(nqR);
    const dj   = get(djR);
    const vix  = get(vixR);

    // EUR/BRL derivado do ExchangeRate
    const usdBrl = usd?.regularMarketPrice;
    const eurUsd  = er?.rates?.EUR;
    const eurBrl  = (usdBrl && eurUsd) ? usdBrl / eurUsd : null;
    const xauUsd  = cg?.gold?.usd;
    const xauBrl  = (xauUsd && usdBrl) ? xauUsd * usdBrl : null;

    const result = {
      dolar:  { price: usd?.regularMarketPrice,  chg: usd?.regularMarketChangePercent  },
      ibov:   { price: ibov?.regularMarketPrice, chg: ibov?.regularMarketChangePercent },
      sp500:  { price: sp?.regularMarketPrice,   chg: sp?.regularMarketChangePercent   },
      nasdaq: { price: nq?.regularMarketPrice,   chg: nq?.regularMarketChangePercent   },
      dow:    { price: dj?.regularMarketPrice,   chg: dj?.regularMarketChangePercent   },
      vix:    { price: vix?.regularMarketPrice,  chg: vix?.regularMarketChangePercent  },
      btc:    { price: cg?.bitcoin?.usd,         chg: cg?.bitcoin?.usd_24h_change      },
      eth:    { price: cg?.ethereum?.usd,        chg: cg?.ethereum?.usd_24h_change     },
      euro:   { price: eurBrl,                   chg: null                             },
      ouro:   { price: xauBrl,                   chg: null                             },
      brent:  { price: null,                     chg: null                             },
    };

    return new Response(JSON.stringify(result), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
