// ─────────────────────────────────────────────────────────────────────────
// Interruptor único do Pedro (front) — ver docs/PEDRO-STANDBY.md pra reativar.
// ATIVO (valor atual: true): o tile "Pedro" aparece na Home e a tela do Pedro monta.
// Para voltar ao STAND BY (kill-switch): troque pra false e rode o build — nada do
// Pedro monta, nenhum fetch pra /api/pedro, nenhum push local. (No servidor, tire
// a env PEDRO_ATIVO ou troque o valor: o handler e o cron respondem 'standby'.)
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
export const PEDRO_ATIVO = true;
