export const config = { runtime: "edge" };

const BRAPI = "4NkivGqSUVTRj1JX3TZSZ5";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET",
  "Content-Type": "application/json",
};

export default async function handler(req) {
  try {
    const [usdR, ibovR, spR, nqR, djR, vixR, cgR, erR, cgCommodR] = await Promise.allSettled([
      fetch(`https://brapi.dev/api/quote/USDBRL%3DX?token=${BRAPI}`).then(r => r.json()),
      fetch(`https://brapi.dev/api/quote/%5EBVSP?token=${BRAPI}`).then(r => r.json()),
      fetch(`https://brapi.dev/api/quote/%5EGSPC?token=${BRAPI}`).then(r => r.json()),
      fetch(`https://brapi.dev/api/quote/%5EIXIC?token=${BRAPI}`).then(r => r.json()),
      fetch(`https://brapi.dev/api/quote/%5EDJI?token=${BRAPI}`).then(r => r.json()),
      fetch(`https://brapi.dev/api/quote/%5EVIX?token=${BRAPI}`).then(r => r.json()),
      // CoinGecko — BTC + ETH
      fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true").then(r => r.json()),
      // ExchangeRate — câmbio livre
      fetch("https://open.er-api.com/v6/latest/USD").then(r => r.json()),
      // CoinGecko commodities — ouro (pax-gold) e petróleo
      fetch("https://api.coingecko.com/api/v3/simple/price?ids=pax-gold,tether-gold&vs_currencies=usd&include_24hr_change=true").then(r => r.json()),
    ]);

    const getQ  = (r) => r.status === "fulfilled" ? r.value?.results?.[0] : null;
    const cg    = cgR.status      === "fulfilled" ? cgR.value      : null;
    const er    = erR.status      === "fulfilled" ? erR.value      : null;
    const cgCom = cgCommodR.status === "fulfilled" ? cgCommodR.value : null;

    const usd  = getQ(usdR);
    const ibov = getQ(ibovR);
    const sp   = getQ(spR);
    const nq   = getQ(nqR);
    const dj   = getQ(djR);
    const vix  = getQ(vixR);

    const usdBrl = usd?.regularMarketPrice || null;
    const eurUsd = er?.rates?.EUR || null;
    const eurBrl = (usdBrl && eurUsd) ? usdBrl / eurUsd : null;

    // Ouro via PAX Gold (token lastreado em ouro físico, 1 PAXG = 1 oz troy)
    const paxg   = cgCom?.["pax-gold"]?.usd || cgCom?.["tether-gold"]?.usd || null;
    const paxgChg= cgCom?.["pax-gold"]?.usd_24h_change || null;
    const xauBrl = (paxg && usdBrl) ? paxg * usdBrl : null;

    // Brent via Brapi (símbolo BZ=F)
    let brentPrice = null, brentChg = null;
    try {
      const brentRes = await fetch(`https://brapi.dev/api/quote/BZ%3DF?token=${BRAPI}`).then(r => r.json());
      const brentQ = brentRes?.results?.[0];
      brentPrice = brentQ?.regularMarketPrice || null;
      brentChg   = brentQ?.regularMarketChangePercent || null;
    } catch {}

    const result = {
      dolar:  { price: usdBrl,                       chg: usd?.regularMarketChangePercent  },
      ibov:   { price: ibov?.regularMarketPrice,      chg: ibov?.regularMarketChangePercent },
      sp500:  { price: sp?.regularMarketPrice,        chg: sp?.regularMarketChangePercent   },
      nasdaq: { price: nq?.regularMarketPrice,        chg: nq?.regularMarketChangePercent   },
      dow:    { price: dj?.regularMarketPrice,        chg: dj?.regularMarketChangePercent   },
      vix:    { price: vix?.regularMarketPrice,       chg: vix?.regularMarketChangePercent  },
      btc:    { price: cg?.bitcoin?.usd,              chg: cg?.bitcoin?.usd_24h_change      },
      eth:    { price: cg?.ethereum?.usd,             chg: cg?.ethereum?.usd_24h_change     },
      euro:   { price: eurBrl,                        chg: null                             },
      ouro:   { price: xauBrl,                        chg: paxgChg                          },
      ouroUsd:{ price: paxg,                          chg: paxgChg                          },
      brent:  { price: brentPrice,                    chg: brentChg                         },
    };

    return new Response(JSON.stringify(result), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
