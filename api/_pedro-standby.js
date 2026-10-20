// ─────────────────────────────────────────────────────────────────────────
// Interruptor único do Pedro (painel) — ver docs/PEDRO-STANDBY.md pra reativar.
// Em stand by (comportamento padrão): zero chamada de LLM, zero consulta ao
// Neon, zero push. Só a string exata "1" na env var PEDRO_ATIVO ativa o
// Pedro de novo — qualquer outro valor, ou a variável ausente, é stand by.
// ─────────────────────────────────────────────────────────────────────────
export function pedroAtivo() {
  return process.env.PEDRO_ATIVO === "1";
}
