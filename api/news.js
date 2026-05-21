export const config = { runtime: "edge" };

const NEWSDATA_KEY = "pub_c5f714f2551048358747f9016a0e8a7f";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET",
  "Content-Type": "application/json",
};

const CATEGORY_MAP = {
  "GLOBAL/GEOPOLÍTICA": { q: "geopolitica diplomacia",       cat: "world"      },
  "EUA":                { q: "estados unidos trump economia", cat: "politics"   },
  "BRASIL":             { q: "brasil governo economia",       cat: "politics"   },
  "ECONOMIA":           { q: "economia inflacao mercado",     cat: "business"   },
  "BOLSA":              { q: "ibovespa bolsa acoes b3",       cat: "business"   },
  "MOEDA":              { q: "dolar real cambio euro",        cat: "business"   },
  "COMMODITIES":        { q: "petroleo ouro soja commodities",cat: "business"   },
  "CRIPTO":             { q: "bitcoin cripto ethereum",       cat: "technology" },
  "GUERRAS":            { q: "guerra conflito ucr%C3%A2nia",  cat: "world"      },
  "TECNOLOGIA":         { q: "tecnologia inteligencia artificial", cat: "technology" },
  "GERAL":              { q: "brasil noticias",               cat: "top"        },
};

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category") || "GERAL";
  const map = CATEGORY_MAP[category] || CATEGORY_MAP["GERAL"];

  const params = new URLSearchParams({
    apikey:   NEWSDATA_KEY,
    language: "pt",
    country:  "br",
    size:     "5",
    q:        map.q,
  });
  if (map.cat !== "top") params.set("category", map.cat);

  try {
    const res  = await fetch(`https://newsdata.io/api/1/news?${params}`);
    const data = await res.json();

    const articles = (data.results || []).map(a => ({
      title: a.title        || "",
      link:  a.link         || "#",
      date:  a.pubDate      || "",
      src:   a.source_name  || a.source_id || "",
      desc:  a.description  || "",
    }));

    return new Response(JSON.stringify({ articles, status: data.status }), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ articles: [], error: e.message }), { status: 500, headers: CORS });
  }
}
