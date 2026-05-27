export const config = { runtime: "edge" };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET",
  "Content-Type": "application/json",
};

function parseRSS(xml) {
  const items = [];
  const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
  for (const match of itemMatches) {
    const item = match[1];
    const get = (tag) => {
      const m = item.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`));
      return m ? (m[1] || m[2] || "").trim() : "";
    };
    const title = get("title");
    const link  = get("link") || item.match(/<link\s*\/>?\s*([^\s<]+)/)?.[1] || "#";
    const date  = get("pubDate");
    const src   = get("source") || item.match(/url="([^"]+)"/)?.[1] || "";
    if (title) items.push({ title, link, date, src });
  }
  return items.slice(0, 8);
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const q    = searchParams.get("q") || "";
  const mode = searchParams.get("mode") || "top"; // "top" ou "search"

  let url;
  if (mode === "search" && q) {
    url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
  } else {
    url = "https://news.google.com/rss?hl=pt-BR&gl=BR&ceid=BR:pt-419";
  }

  try {
    const res  = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RSS Reader)" }
    });
    const xml  = await res.text();
    const items = parseRSS(xml);

    return new Response(JSON.stringify({ items, ok: true }), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ items: [], error: e.message }), { headers: CORS });
  }
}
