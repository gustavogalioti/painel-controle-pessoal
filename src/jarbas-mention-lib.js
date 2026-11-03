// PAINEL-3 PARTE B.3: detecção de "@jarbas" em campos de texto — extraído como módulo
// à parte (mesmo padrão de daily-lib.js) pra ser testável sem precisar importar App.jsx
// (que tem JSX e não roda direto no test runner do Node).
export const JARBAS_MENTION_RE = /@jarbas\b/i;

export function temMencaoJarbas(texto) {
  return JARBAS_MENTION_RE.test(texto || "");
}

// Monta o recado a partir do texto mencionado — função pura (sem tocar em rede/KV),
// pra quem chama (App.jsx, com o KV de verdade) só gravar o resultado.
export function montarRecadoDeMencao(texto, origem, { id = Date.now(), at = new Date().toISOString() } = {}) {
  if (!temMencaoJarbas(texto)) return null;
  return { id, text: texto.trim(), at, done: false, ...(origem ? { origem } : {}) };
}
