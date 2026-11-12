# Pedro Virtual

Evolução do Pedro IA: de "assistente do painel" para **bichinho virtual** (o gato do
Gustavo). Spec completa: `PEDRO-VIRTUAL-SPEC.md` (fora do repositório, enviada pelo
Gustavo). Este arquivo registra o que já foi feito e como operar.

## Estado atual: Fase 2 (cena 3D) pronta — Pedro continua em STAND BY

> Decisões do Gustavo: **sem botão flutuante** (o Pedro só vive dentro da tela própria, nunca nas outras
> telas do painel) e o tile se chama **"Pedro"**.

## Fase 1 (limpeza e fundação)

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



---

## Fase 2 — cena 3D e Pedro vivo

### Spike: lib `threejs-procedural-animals` (decisão: **usar a lib**, sem plano B)
- Funciona em Vite/React sem dor: Web Workers de módulo (`worker.format: "es"`, `target es2022` no
  `vite.config.js`), bake `.animal` e a espécie `cat` com variante `ginger`.
- **Vendorizada** (não é dependência git) em `src/pedro/vendor/procedural-animals/`, só o núcleo + `cat` (as outras
  23 espécies foram podadas). Licença MIT mantida (`LICENSE` junto e `THIRD_PARTY_LICENSES.md`).
- Ajuste ao Pedro real: `ginger` já tem peito/queixo claros, nariz rosa e listras. O que faltava foi feito por
  **override**, sem tocar em nenhum asset: olhos **dourados** (`eye: "gold"`) e **focinho + queixo brancos**
  (novo override local `muzzleWhite`, patch pequeno e marcado em `species/cat/coat.js`). Receita final:
  `seed 2, male, ginger, muzzleWhite, white 0.8, eye gold` (`PEDRO_LOOK` em `actor/PedroActor.js`).
- **Bake:** `node scripts/pedro-bake.mjs` gera `public/pedro/pedro-cat-medium.animal` (≈4,2 MB; ≈2 MB com gzip) —
  carrega em milissegundos. Se o arquivo faltar, o app gera o gato em runtime (~1,5 s no desktop) sem quebrar.
  Tier **medium** (~30k vértices) para todos; desktop/hero ficam como possível evolução.
- **Peso:** a cena vive num chunk `React.lazy` (`PedroScreen`, ≈325 KB gzip + gato). O resto do painel não pesa mais.
- **Desempenho (não medido em aparelho real):** o ambiente de desenvolvimento só tem renderização por software, então
  os 30 fps no celular de referência (Poco F5) **precisam ser confirmados no aparelho**. Para isso há `?pedrodebug`
  (mostra fps, nível de qualidade, origem do gato e motor do chat) e `?pedronivel=0..3` (força um nível).

### O que foi entregue
| Peça | Arquivo |
|---|---|
| Interface do gato (`moveTo`, `lookAt`, `face`, `play`, `comeToCamera`, `setMood`, `setOutfit`) | `src/pedro/actor/PedroActor.js` |
| Cena: renderer, câmera 3ª pessoa baixa com damping, luz pela **hora real de SP**, loop, pausa em aba oculta, qualidade adaptativa, gestos | `src/pedro/PedroScene.js` |
| Sala: piso de madeira, janelão com esquadria que projeta sombra, cortinas, tapete, caminha de vime, tigelas, caixa de papelão, mala aberta, poltrona preta, mesa com papéis (e papéis no chão), planta, arranhador, caixa de areia, abajur | `src/pedro/world/RoomScene.js` |
| POIs/chão/limites (dados puros, reaproveitáveis no servidor na Fase 4) | `src/pedro/world/pois.js` |
| Comportamento: escolhe passeio+atividade por pesos de hora (dorme muito, janela de manhã, brinca ao entardecer) | `src/pedro/behavior/brain.js` |
| Chamar por nome/apelido (sem acento, repetição de letras, typo, vocativo no início/fim) | `src/pedro/names.js` |
| Luz por hora (manhã dourada → tarde alaranjada → noite azul + abajur) | `src/pedro/time.js` |
| Tela com chat integrado, balão sobre o Pedro, fallback sem WebGL | `src/pedro/PedroScreen.jsx` |
| Tile **Pedro** na Home + página (overlay em tela cheia; **sem botão flutuante**) | `src/App.jsx` (`PedroCard`, `PedroPage`) |

Comportamento visual hoje: caminha entre POIs, dorme, descansa olhando a janela, come, bebe, se limpa, amassa o
tapete, caça/pula, arranha, se esconde na caixa/mala — com piscadas lentas. **Chamar pelo nome no chat** ("Pedruxo!",
"vem cá, Pedrão"): ele para o que está fazendo, vem andando até a câmera, olha, senta e pisca (otimista, antes da
resposta do LLM chegar). Toque no Pedro = "oi"; toque no chão = olha e, se perto, vem. Arrastar com 2 dedos / botão
direito orbita de leve; pinça / roda dá zoom curto.

Qualidade adaptativa: mede FPS a cada 3 s e desce de nível (resolução → sombras menores → LOD/fur menor → sem sombras
e 30 fps). Celular (`pointer: coarse`) começa no nível 1. Aba oculta = render pausado. `prefers-reduced-motion`
deixa a câmera mais "seca". Se o WebGL falhar: foto do Pedro + chat (nunca tela branca).

### Como ver (Pedro ainda em stand by)
O tile só aparece com `PEDRO_ATIVO = true` (`src/pedro-standby.js`) e o servidor com `PEDRO_ATIVO=1`. Para uma
prévia **só visual** (sem chat), troque a constante do front localmente: o chat dependeria da env no servidor.
Parâmetros úteis na URL: `?pedrohora=21` (força a hora do dia), `?pedrodebug`, `?pedronivel=2`.

### Fica para as próximas fases
Fase 3: gestos de cuidado (carinho, colo, bolinha/brinquedos, comida e água pelo toque, sons, partículas, haptics,
inventário/biscoitos, roupinha de biscoito de gengibre, barras de necessidades). Fase 4: `advancePet`, vida fora do
app, diário e pushes. Fase 5: quintal.
