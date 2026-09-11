export const config = { runtime: "edge" };
import {
  CORS, err, ok, requireAuth,
  lerTarefas, criarTarefa, lerIdeias, criarIdeia, lerDiario, anotarDiario,
} from "./_gusos-lib.js";

// ─────────────────────────────────────────────────────────────────────────
// CHATGPT — endpoint GENÉRICO, mantido por compatibilidade (testes manuais,
// Reqbin, etc.) e como fallback. Multiplexa as 6 ações via {action, params}.
//
// O Custom GPT do ChatGPT usa os 6 endpoints DEDICADOS em api/chatgpt/*.js
// (que importam a mesma lógica desta lib), porque só assim cada ação pode
// ser marcada individualmente como baixo/alto risco no schema OpenAPI
// (x-openai-isConsequential é declarado por operação/caminho, não por
// valor de campo dentro do corpo — ver /projects/.../permission-model.md).
//
// Toda a lógica de negócio vive em api/_gusos-lib.js; este arquivo é só
// o dispatcher do formato multiplexado antigo.
// ─────────────────────────────────────────────────────────────────────────

const ACTIONS = {
  ler_tarefas: lerTarefas,
  criar_tarefa: criarTarefa,
  ler_ideias: lerIdeias,
  criar_ideia: criarIdeia,
  ler_diario: lerDiario,
  anotar_diario: anotarDiario,
};

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return err(405, "method_not_allowed");
  if (!requireAuth(req)) return err(401, "unauthorized");

  let body;
  try {
    body = await req.json();
  } catch {
    return err(400, "invalid_json_body");
  }

  const { action, params } = body || {};
  const fn = ACTIONS[action];
  if (!fn) return err(400, "unknown_action");

  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(process.env.DATABASE_URL);
    const result = await fn(sql, params);
    if (result.fieldError) return err(400, result.fieldError);
    if (result.items !== undefined) return ok({ action, count: result.count, items: result.items });
    return ok({ action, item: result.item, deduplicated: !!result.deduplicated });
  } catch (e) {
    return err(500, "internal_error");
  }
}
