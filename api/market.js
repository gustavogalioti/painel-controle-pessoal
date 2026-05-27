export const config = { runtime: "edge" };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET",
  "Content-Type": "application/json",
};

// Busca um ativo no Google Finance e retorna preço + variação %
async function fetchGoogleFinance(ticker, exchange = "") {
  try {
    const symbol = exchange ? `${exchange}:${ticker}` : ticker;
    const url = `https://www.google.com/finance/quote/${symbol}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "pt-BR,pt;q=0.9",
        "Accept": "text/html,application/xhtml+xml",
      }
    });
    const html = await res.text();

    // Extrai preço — Google Finance usa data-last-price ou classe YMlKec
    let price = null;
    let chg   = null;

    // Tenta data-last-price attribute
    const dataPrice = html.match(/data-last-price="([0-9.,]+)"/);
    if (dataPrice) price = parseFloat(dataPrice[1].replace(",", "."));

    // Fallback: classe YMlKec fFuuX (preço principal)
    if (!price) {
      const classPrice = html.match(/class="YMlKec fFuuX"[^>]*>([0-9.,]+)</);
      if (classPrice) price = parseFloat(classPrice[1].replace(/\./g, "").replace(",", "."));
    }

    // Variação % — classe gz-pb
    const chgMatch = html.match(/([+-][0-9.,]+)%/);
    if (chgMatch) chg = parseFloat(chgMatch[1].replace(",", "."));

    return { price, chg, ok: price != null };
  } catch (e) {
    return { price: null, chg: null, ok: false, error: e.message };
  }
}

export default async function handler(req) {
  try {
    // Busca todos em paralelo
    const [
      dolarR, ibovR, spR, nasdaqR, dowR, vixR,
      btcR, ethR, ouroR, brentR, eurR, selicR
    ] = await Promise.allSettled([
      fetchGoogleFinance("USDBRL=X"),           // Dólar
      fetchGoogleFinance("IBOV", "INDEXBVMF"),  // Ibovespa
      fetchGoogleFinance("SPX", "INDEXSP"),     // S&P 500
      fetchGoogleFinance("COMP", "INDEXNASDAQ"),// Nasdaq
      fetchGoogleFinance("DJI", "INDEXDJX"),    // Dow Jones
      fetchGoogleFinance("VIX", "INDEXCBOE"),   // VIX
      fetchGoogleFinance("BTC-BRL"),            // Bitcoin em BRL
      fetchGoogleFinance("ETH-BRL"),            // Ethereum em BRL
      fetchGoogleFinance("GC=F"),               // Ouro (futuros)
      fetchGoogleFinance("BZ=F"),               // Brent (futuros)
      fetchGoogleFinance("EURBRL=X"),           // Euro
      fetchGoogleFinance("SELIC", "INDEXBVMF"), // Selic
    ]);

    const get = (r) => r.status === "fulfilled" ? r.value : { price: null, chg: null };

    const dolar  = get(dolarR);
    const usdBrl = dolar.price;

    // Ouro vem em USD — converte para BRL
    const ouroUsd = get(ouroR).price;
    const ouroBrl = (ouroUsd && usdBrl) ? ouroUsd * usdBrl : null;

    const result = {
      dolar:  { price: usdBrl,             chg: get(dolarR).chg   },
      ibov:   { price: get(ibovR).price,   chg: get(ibovR).chg    },
      sp500:  { price: get(spR).price,     chg: get(spR).chg      },
      nasdaq: { price: get(nasdaqR).price, chg: get(nasdaqR).chg  },
      dow:    { price: get(dowR).price,    chg: get(dowR).chg      },
      vix:    { price: get(vixR).price,    chg: get(vixR).chg      },
      btc:    { price: get(btcR).price,    chg: get(btcR).chg      },
      eth:    { price: get(ethR).price,    chg: get(ethR).chg      },
      ouro:   { price: ouroBrl,            chg: get(ouroR).chg     },
      ouroUsd:{ price: ouroUsd,            chg: get(ouroR).chg     },
      brent:  { price: get(brentR).price,  chg: get(brentR).chg    },
      euro:   { price: get(eurR).price,    chg: get(eurR).chg      },
      selic:  { price: 14.75,              chg: null               },
    };

    return new Response(JSON.stringify(result), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
