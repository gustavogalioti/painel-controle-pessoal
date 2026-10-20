# Pedro IA — Stand By

O Pedro (o assistente/gato do Painel, 100% independente do Jarbas) foi
colocado em **stand by**: zero chamada de LLM, zero consulta ao Neon, zero
push — mas **nada foi apagado**. Dados, tabelas, chaves, intents, memória e
inscrições de push continuam intactos. Reativar é trivial (ver abaixo).

## O que está congelado

- **Servidor** (`api/pedro.js`): logo após a checagem de sessão, se o Pedro
  não estiver ativo, o handler responde `200 { standby: true, reply: "O
  Pedro está em stand by." }` pra **qualquer** action (`chat`,
  `push_subscribe`, `push_unsubscribe`, `admin_*`) — antes de abrir conexão
  com o Neon, chamar Groq/OpenAI ou mexer em qualquer coisa.
- **Cron** (`api/pedro-cron.js`, disparado externamente pelo cron-job.org):
  depois de validar o `?secret=` (o 401 continua existindo pra secret
  errado), responde `200 { ok: true, standby: true }` **antes** de checar
  VAPID, abrir o Neon, falar com o Google Calendar ou enviar qualquer push.
- **Front** (`src/App.jsx`): o botão/avatar/bolha/painel do Pedro
  (`PedroWidget`, que inclui o `PedroAdminModal`) simplesmente não é
  montado. Isso sozinho já impede TODOS os efeitos do Pedro, porque todos
  vivem dentro do `PedroWidget`: os `useKV("pedro_chat_v1")` e
  `useKV("pedro_state_v1")` (que geram leitura/escrita e sync com o banco),
  os timers de bom-dia / lembrete de compromisso / check-in noturno / contas
  vencidas, o pedido de permissão de notificação, o `push_subscribe` e o
  `fetch` pra `/api/pedro`.
- `pedroNotify` (o barramento leve que as páginas usam pra avisar o Pedro de
  eventos — tarefa concluída, conta paga, etc.) e o evento `"pedro:event"`
  viram **no-op**: as páginas continuam chamando `pedroNotify(...)`
  normalmente, sem erro, só que o evento nunca é disparado de verdade — e,
  de qualquer forma, não sobra ninguém ouvindo, já que o `PedroWidget` nem
  está montado.

## O que foi preservado (nada foi tocado)

- Todas as tabelas `panel_pedro_*` (intents, keywords, respostas, log de
  não reconhecidas) e todas as chaves do `sync_kv` usadas pelo Pedro
  (`pedro_memory_v1`, `pedro_learned_v1`, `pedro_push_subs`,
  `pedro_reminded_events_server`, `pedro_evening_push_date`).
- O roteador de LLM do Pedro (`callLlmChain`, circuit breaker, etc.) e os
  testes já existentes em `api/_pedro-llm.test.mjs` — nada nessa lógica foi
  alterado, só deixou de ser chamada.
- As inscrições de push já instaladas (`pedro_push_subs`) — **nunca**
  deletadas nem chamado `unsubscribe` nelas. Como o cron é o único emissor
  de push do Pedro e agora ele responde stand by antes de sequer checar as
  inscrições, nenhuma notificação do Pedro sai — mas, se o Pedro for
  reativado, essas inscrições antigas continuam funcionando sem o usuário
  precisar reinstalar nada.
- O Service Worker (`public/sw.js`) só mostra uma notificação em reação a um
  evento `push` de verdade do navegador — e esse evento só existe quando o
  servidor efetivamente envia um push (via `web-push`, em
  `api/pedro-cron.js`). Como o cron agora nunca chega a chamar
  `sendPushToAll` em stand by, esse listener nunca é acionado. Confirmado:
  não existe nenhum outro caminho no código que dispare uma notificação
  "Pedro 🐾" além desses dois (cron → push → SW).
- `api/jarbas.js`, `api/chatgpt.js` e `api/_gusos-lib.js` não importam nada
  de `api/pedro.js` nem de `api/pedro-cron.js` (o próprio cabeçalho de
  `jarbas.js` já documentava essa independência) — o stand by do Pedro não
  afeta em nada o Jarbas, o ChatGPT ou o resto do painel.

## Como reativar o Pedro

1. **Servidor (Vercel)**: defina a env var `PEDRO_ATIVO=1` no projeto (só a
   string exata `"1"` ativa — qualquer outro valor, ou a variável ausente,
   continua em stand by). Ver `api/_pedro-standby.js`.
2. **Front**: em `src/pedro-standby.js`, troque `export const PEDRO_ATIVO =
   false;` para `true` e rode o build/deploy de novo.
3. **Cron externo**: no [cron-job.org](https://cron-job.org), **retome
   (unpause) o job** que bate em `api/pedro-cron.js`. Enquanto os passos 1 e
   2 já fazem o Pedro voltar a responder normalmente, o job externo
   continuar pausado é o que garante a economia de requisições total — sem
   isso, o cron continua rodando (e, com o Pedro ativo de novo, voltando a
   consultar o Neon e enviar push a cada disparo).

Os três passos são independentes: fazer só o 1 e o 2 sem retomar o cron
externo já devolve o chat/admin do Pedro no painel, mas os lembretes
proativos por push só voltam quando o cron externo for retomado também.

## Risco

Nenhum dado foi migrado, apagado ou alterado — o stand by é só uma checagem
de "saída antecipada" em três pontos (gate do servidor, gate do cron,
condição de montagem no front). Reverter os três passos acima volta o Pedro
ao estado exato de antes desta mudança.
