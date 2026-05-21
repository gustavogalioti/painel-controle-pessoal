export const config = { runtime: "edge" };

const NEWSDATA_KEY = "pub_c5f714f2551048358747f9016a0e8a7f";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET",
  "Content-Type": "application/json",
};

// Busca notícias gerais em PT-BR e filtra por palavras-chave no frontend
// Usa apenas 1 requisição para todas as categorias
export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category") || "";

  // Se pedir categoria específica, faz busca direcionada
  const QUERIES = {
    "GLOBAL/GEOPOLÍTICA": { q: "geopolitica diplomacia internacional",  cat: "world"      },
    "EUA":                { q: "trump estados unidos washington",         cat: "politics"   },
    "BRASIL":             { q: "brasil lula governo federal",            cat: "politics"   },
    "ECONOMIA":           { q: "economia inflacao pib banco central",    cat: "business"   },
    "BOLSA":              { q: "ibovespa bolsa b3 acoes bovespa",        cat: "business"   },
    "MOEDA":              { q: "dolar real cambio euro moeda",           cat: "business"   },
    "COMMODITIES":        { q: "petroleo ouro soja commodities agro",    cat: "business"   },
    "CRIPTO":             { q: "bitcoin ethereum criptomoeda blockchain", cat: "technology" },
    "GUERRAS":            { q: "guerra conflito militar exercito",        cat: "world"      },
    "TECNOLOGIA":         { q: "tecnologia inteligencia artificial ia",  cat: "technology" },
    "GERAL":              { q: "brasil noticias destaque",               cat: ""           },
  };

  const cfg = QUERIES[category] || QUERIES["GERAL"];

  const params = new URLSearchParams({
    apikey:   NEWSDATA_KEY,
    language: "pt",
    country:  "br",
    size:     "5",
    q:        cfg.q,
  });
  if (cfg.cat) params.set("category", cfg.cat);

  try {
    const res  = await fetch(`https://newsdata.io/api/1/news?${params}`);
    const data = await res.json();

    if (data.status !== "success") {
      // Quota atingida — retorna artigos vazios sem erro
      return new Response(JSON.stringify({ articles: [], quota: true }), { headers: CORS });
    }

    const articles = (data.results || []).map(a => ({
      title: a.title       || "",
      link:  a.link        || "#",
      date:  a.pubDate     || "",
      src:   a.source_name || a.source_id || "",
      desc:  a.description || "",
    })).filter(a => a.title);

    return new Response(JSON.stringify({ articles, status: "success" }), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ articles: [], error: e.message }), { headers: CORS });
  }
}
