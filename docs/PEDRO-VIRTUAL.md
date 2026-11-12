# Pedro Virtual

Evolução do Pedro IA: de "assistente do painel" para **bichinho virtual** (o gato do
Gustavo). Spec completa: `PEDRO-VIRTUAL-SPEC.md` (fora do repositório, enviada pelo
Gustavo). Este arquivo registra o que já foi feito e como operar.

## Estado atual: Fase 1 (limpeza e fundação) — Pedro continua em STAND BY

Nada foi reativado. `PEDRO_ATIVO` segue `false` no front (`src/pedro-standby.js`) e
ausente no servidor (`api/_pedro-standby.js`).

### O que o Pedro é agora
- Um **pet**: conversa, lembra, pergunta de volta, tem as manias do Pedro real.
  Prompt novo em `api/_pedro-pet-lib.js` (`buildSystemPrompt`).
- **Zero acesso ao painel**: nada de agenda, tarefas, contas, finanças, clima, diário do
  painel, Google Calendar. Se pedirem algo disso, responde como gato ("isso é com o
  Jarbas…"). Só toca chaves `pedro_*` do `sync_kv`.
- Única tool do LLM: `save_memory` (com categoria opcional
  `pessoa|lugar|plano|mania_do_pedro|momento`).
- Cadeia de LLM (Groq → OpenAI, circuit breaker) **inalterada**. Se tudo falhar, responde
  com um miado simpático (`engine: "fallback"`) — não existe mais o sistema de keywords.
- `aprenda: …` e a memória de longo prazo (com idade relativa) **inalterados**.
- **Seed de manias** do Pedro real em `pedro_memory_v1` (papéis/mesa, caixas/malas,
  poltrona/sofá, dorme esticado, pijama de biscoito de gengibre). Roda uma única vez
  (flag em `pedro_pet_v1.seeds.manias_v1`), nunca sobrescreve e não ressurge se você
  apagar uma mania.
- Contexto de **estado** e **diário** já existe no prompt, só que vazio até a Fase 4.

### O que foi removido (dados preservados)
- Tools/comandos de assistente em `api/pedro.js`, integração Google Calendar, clima.
- No `pedro-cron.js`: lembretes de compromisso e check-in noturno. O cron agora só
  valida o secret e responde (não abre o Neon, não envia push).
- No front: timers de bom-dia/agenda/check-in/contas, `PEDRO_REACTIONS`, `pedroNotify`
  (e suas chamadas em Tarefas, Contas, Agenda e DailyCenter).
- Admin: abas "Intents" e "Não reconhecidas" saíram. Novas abas: **Memória**,
  **Ensinado**, e placeholders **Diário** e **Estado**.
- Tabelas `panel_pedro_*` **continuam no banco, intactas** (só não são mais lidas/escritas;
  `initTables`/seed de intents deixaram de rodar).

### Testes novos
- `api/_pedro-pet.test.mjs`: prompt, tools, seed idempotente, `aprenda:`, fallback sem
  Groq/OpenAI, fluxo LLM + `save_memory` (com `sql` falso, sem rede).
- `api/_pedro-isolation.test.mjs`: nenhum `api/*pedro*.js` referencia chaves do painel
  (extraídas automaticamente dos `useKV` do front), Google/Outlook/Jarbas, e o
  `jarbas.js` não importa nada do Pedro.

### Backup antes de mexer
```bash
DATABASE_URL=postgres://... node scripts/pedro-backup.mjs
```
Exporta todas as chaves `pedro_*` (memória, ensinado, chat, pet, push) para um JSON
local (ignorado pelo git).

### Como reverter a Fase 1
O PR é um commit único, sem migração de dados. `git revert` desse commit restaura o
Pedro-assistente anterior (ainda em stand by). As chaves novas (`pedro_pet_v1`, mania
seeds em `pedro_memory_v1`) só existem se o Pedro tiver sido reativado e usado; remover
a flag `seeds.manias_v1` + as entradas `seed_mania_*` é suficiente para desfazê-las.

## Checklist antes de reativar (quando o Gustavo aprovar)
1. Rodar o backup acima.
2. **Rotacionar segredos** expostos antes: token do GitHub, `GROQ_API_KEY`, VAPID privada
   (se trocar a pública, atualizar `VAPID_PUBLIC_KEY` em `src/App.jsx` e os usuários
   precisam reinscrever o push), `CRON_SECRET`.
3. Passos 1–3 de `docs/PEDRO-STANDBY.md` (env `PEDRO_ATIVO=1`, `PEDRO_ATIVO=true` no
   front, retomar o cron).
4. Lembrar: as inscrições antigas de push continuam, mas o cron da Fase 1 não envia nada.

## Próximas fases
Ver seção 10 da spec: Fase 2 (cena 3D + spike da lib), 3 (interação), 4 (vida fora do
app, diário, push), 5 (quintal).
