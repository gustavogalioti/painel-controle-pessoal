// ─────────────────────────────────────────────────────────────────────────
// Interruptor único do Pedro (front) — ver docs/PEDRO-STANDBY.md pra reativar.
// Em stand by (valor atual: false): PedroWidget/PedroAdminModal não são
// montados, nenhum efeito do Pedro roda (sem useKV de pedro_chat_v1/
// pedro_state_v1, sem timers, sem pedir permissão de notificação, sem
// push_subscribe, sem fetch pra /api/pedro) e pedroNotify vira um no-op.
//
// Esse projeto não usa variáveis de ambiente do Vite (nenhum import.meta.env
// em nenhum outro arquivo do src/) — por isso o interruptor aqui é uma
// constante simples, igual ao resto do projeto, em vez de VITE_PEDRO_ATIVO.
//
// Pra REATIVAR o Pedro:
//   1. Troque PEDRO_ATIVO pra true aqui embaixo (e rode o build de novo).
//   2. No Vercel, defina a env var de servidor PEDRO_ATIVO=1 (ver
//      api/_pedro-standby.js) — sem isso o servidor continua em stand by
//      mesmo com o front achando que está ativo.
//   3. Resuma (unpause) o cron job no cron-job.org.
export const PEDRO_ATIVO = false;
