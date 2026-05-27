export const config = { runtime: "edge" };

const BRAPI = "4NkivGqSUVTRj1JX3TZSZ5";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET",
  "Content-Type": "application/json",
};

export default async function handler(req) {
  try {
    const [usdR, ibovR, spR, nqR, djR, vixR, cgR, erR, cgXauR, brentR] = await Promise.allSettled([
      fetch(`https://brapi.dev/api/quote/USDBRL%3DX?token=${BRAPI}`).then(r => r.json()),
      fetch(`https://brapi.dev/api/quote/%5EBVSP?token=${BRAPI}`).then(r => r.json()),
      fetch(`https://brapi.dev/api/quote/%5EGSPC?token=${BRAPI}`).then(r => r.json()),
      fetch(`https://brapi.dev/api/quote/%5EIXIC?token=${BRAPI}`).then(r => r.json()),
      fetch(`https://brapi.dev/api/quote/%5EDJI?token=${BRAPI}`).then(r => r.json()),
      fetch(`https://brapi.dev/api/quote/%5EVIX?token=${BRAPI}`).then(r => r.json()),
      fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true").then(r => r.json()),
      fetch("https://open.er-api.com/v6/latest/USD").then(r => r.json()),
      fetch("https://api.coingecko.com/api/v3/simple/price?ids=pax-gold&vs_currencies=usd&include_24hr_change=true").then(r => r.json()),
      fetch(`https://brapi.dev/api/quote/BZ%3DF?token=${BRAPI}`).then(r => r.json()),
    ]);

    const getQ  = (r) => r.status === "fulfilled" ? r.value?.results?.[0] : null;
    const cg    = cgR.status     === "fulfilled" ? cgR.value    : null;
    const er    = erR.status     === "fulfilled" ? erR.value    : null;
    const cgXau = cgXauR.status  === "fulfilled" ? cgXauR.value : null;

    const usd    = getQ(usdR);
    const usdBrl = usd?.regularMarketPrice || null;
    const eurUsd = er?.rates?.EUR || null;
    const eurBrl = (usdBrl && eurUsd) ? usdBrl / eurUsd : null;

    const paxg    = cgXau?.["pax-gold"]?.usd || null;
    const paxgChg = cgXau?.["pax-gold"]?.usd_24h_change || null;
    const xauBrl  = (paxg && usdBrl) ? paxg * usdBrl : null;

    const q = (r) => getQ(r);

    const result = {
      dolar:  { price: usdBrl,               chg: usd?.regularMarketChangePercent       },
      ibov:   { price: q(ibovR)?.regularMarketPrice,  chg: q(ibovR)?.regularMarketChangePercent  },
      sp500:  { price: q(spR)?.regularMarketPrice,    chg: q(spR)?.regularMarketChangePercent    },
      nasdaq: { price: q(nqR)?.regularMarketPrice,    chg: q(nqR)?.regularMarketChangePercent    },
      dow:    { price: q(djR)?.regularMarketPrice,    chg: q(djR)?.regularMarketChangePercent    },
      vix:    { price: q(vixR)?.regularMarketPrice,   chg: q(vixR)?.regularMarketChangePercent   },
      btc:    { price: cg?.bitcoin?.usd,              chg: cg?.bitcoin?.usd_24h_change            },
      eth:    { price: cg?.ethereum?.usd,             chg: cg?.ethereum?.usd_24h_change           },
      euro:   { price: eurBrl,                        chg: null                                   },
      ouro:   { price: xauBrl,                        chg: paxgChg                                },
      ouroUsd:{ price: paxg,                          chg: paxgChg                                },
      brent:  { price: q(brentR)?.regularMarketPrice, chg: q(brentR)?.regularMarketChangePercent  },
      selic:  { price: 14.75,                         chg: null                                   },
    };

    return new Response(JSON.stringify(result), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
