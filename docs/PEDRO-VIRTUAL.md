# Pedro Virtual

Evolução do Pedro IA: de "assistente do painel" para **bichinho virtual** (o gato do
Gustavo). Spec completa: `PEDRO-VIRTUAL-SPEC.md` (fora do repositório, enviada pelo
Gustavo). Este arquivo registra o que já foi feito e como operar.

## Estado atual: Fase 4 (vida fora do app, Diário e push) pronta — Pedro continua em STAND BY

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

---

## Fase 3 — interação e cuidados

### Gestos (toque primeiro; mouse equivale)
| Gesto | Reação |
|---|---|
| Tocar no Pedro | "Oi": olha pra você, miado e piscada lenta (vibra de leve) |
| Arrastar **devagar** sobre ele | **Carinho**: ele senta, ronrona (som + vibração), sobem corações; com afeto ≥ 45 e > 5 s, "amassa pãozinho" |
| Arrastar **rápido/bagunçado** | **Incomoda**: bufa e se afasta (nunca pune, só reage) |
| **Segurar** (0,6 s) | **Colo**: câmera se aproxima, ele relaxa e ronrona — ou se debate e sai correndo se estiver cheio de energia e entediado |
| Tocar no chão | Ele olha e, se perto, vem |
| Tocar na **tigela de comida / água** | Vai, come/bebe (com som). Se não precisa, **recusa** ("Tô sem fome agora 😸") |
| Tocar em **caixa, mala, caminha, poltrona, papéis** | Convite: com sono ou curiosidade, entra e se acomoda |
| **Bandeja** 🎾🐭🪶🍗🍪: arrastar pra dentro da sala | Bolinha: arremesso (rola, quica nas paredes) e ele caça e pula. Ratinho: ele espreita e dá o bote. **Pena**: ele segue a ponta e ataca enquanto você arrasta. Comida: vai à tigela. Petisco: aparece onde caiu e ele come. Um **toque** (sem arrastar) joga o brinquedo perto dele |
| Chamar pelo nome no chat | (Fase 2) vem até a câmera |

Feedback sempre: som, vibração (`navigator.vibrate`, desligável na lojinha), corações. Reduced-motion: menos partículas e animação de "+1" estática.

### Estado, necessidades e biscoitos (`pedro_pet_v1`)
- `src/pedro/pet-state.js` (puro, testado): `necessidades` 0–100 onde **100 = satisfeito** (fome, sede, energia, diversão, afeto, higiene), humor derivado
  (`feliz|calmo|brincalhao|sonolento|manhoso|curioso`), decaimento por hora (com **catch-up** ao abrir, teto de 48 h), eventos de cuidado e loja.
- **Cuidado sem culpa:** piso de 8 — nada vai a zero; baixa necessidade deixa o Pedro manhoso/dorminhoco, **nunca** doente ou em risco; sem game over.
- Necessidades **mudam o comportamento** (brain): com fome ele vai comer, cansado dorme, entediado brinca, sujo se limpa. O que ele faz **sozinho**
  também atende as necessidades (mas não rende biscoito).
- **Biscoitos 🍪 (moedas):** carinho ≥ 3 s (+1), refeição (+2), beber (+1), brincar (+2) — só quando a necessidade estava < 85 (anti-farm).
- O chat do servidor **já lê** `necessidades`/`humor` do `pedro_pet_v1`: o Pedro fala conforme o estado.
- Barras discretas no topo + contador de biscoitos; alvos de toque ≥ 44 px.

### Lojinha (decisão em aberto nº 5 da spec — proposta inicial, fácil de mudar em `CATALOGO`)
- **Pijama de biscoito de gengibre** (azul-marinho com biscoitinhos e bengalas): 🍪 25, vestir/tirar. É um casaquinho 3D preso ao tronco do gato.
- **Petisco**: 🍪 3 cada (consumível; recusa se a barriga está cheia e devolve).
- Bolinha, ratinho e pena são grátis e ilimitados.

### Sons (decisão nº 2): síntese procedural com WebAudio, 100 % original
Miado (glissando + formante), ronronar (ruído filtrado modulado a 24 Hz), mastigar, lamber água, pulo da bolinha, tilintar de biscoito, bufada.
O áudio só liga após o primeiro gesto; botão 🔊/🔇 no topo. Nenhum som de jogo.

### Testes e verificação
- `src/pedro-state.test.mjs`: normalização (preserva campos do servidor), decaimento/piso/catch-up, humor, eventos e biscoitos (incl. anti-farm), recusas, loja, necessidades puxando o comportamento.
- Em Chromium headless (renderização por software): carinho (+24 afeto, +1 🍪), incômodo, arrasto real da bolinha da bandeja (+diversão, +2 🍪), comida (fome 30→82, +2 🍪), compra e uso do pijama, colo (zoom), corações e a tela noturna/diurna conferidos por screenshot. Corrigido no caminho: loop de render infinito por setter instável do `useKV`.
- **Não verificado em aparelho real:** toque/gestos em tela de verdade (a latência do headless atrapalhou o "segurar" de 0,6 s), vibração, **áudio audível** (sintetizado, mas ninguém ouviu) e os 30 fps.

### Limitações conhecidas
- O front grava `pedro_pet_v1` de tempos em tempos; se o servidor semear as manias *depois* de o front carregar o estado, a flag `seeds` pode ser sobrescrita uma vez (efeito: uma mania apagada pode reaparecer). Será resolvido na Fase 4, quando o servidor passa a ser dono do estado.
- Brinquedos e colisões são simples (sem física entre móveis; o gato atravessa móveis baixos). Convites e passeios usam rotas retas entre POIs.

---

## Fase 4 — vida fora do app, Diário e push

### Arquitetura: o servidor é o dono do estado
- **`advancePet(state, now, rng)`** (`src/pedro/sim.js`, pura e testada): avança de `ultimoTick` até `agora` em passos de **10 min**: decaimento, escolha de atividade
  por pesos (hora do dia, necessidades, sorte), efeitos ao concluir (come → fome sobe, dorme → energia sobe…) e **eventos estruturados**
  (`ev_<ms>_<tipo>`, com extras: passarinho na janela, achou um presente, sonhou, derrubou algo). Catch-up limitado a **48 h**.
  `advancePetSeeded` deriva o seed do último tick: reprocessar o mesmo trecho gera os mesmos eventos/ids (dedupe do diário).
- **`api/_pedro-life.js`**: `tickPedro` (avança + grava estado e diário), `applyUpdate` (cuidados/loja/config vindos do app, com validação), diário (`listDiary`, `markDiaryRead`,
  `reactDiary`) e `runCronTick` (núcleo do cron, injetável e testado). Só toca chaves `pedro_*` (`pedro_pet_v1`, `pedro_diary_v1`, `pedro_chat_v1`, `pedro_push_subs`).
- **Cron** (`api/pedro-cron.js`, cron-job.org): a cada disparo o Pedro "vive", o Diário é escrito e **no máximo um** push sai, se a política permitir.
- **App**: `usePedroPet` mantém um espelho do estado do servidor (sincroniza ao abrir e a cada minuto; cuidados são otimistas e confirmados por POST). Ao abrir, o gato **nasce
  onde o servidor diz que ele está** e continua a atividade (ex.: dormindo no tapete). O chat do servidor recebe o estado **de agora** e o diário recente.
- Endpoints novos em `/api/pedro`: `pet_state`, `pet_update`, `diary`, `diary_read`, `diary_react`, `admin_diary`, `admin_diary_delete`, `admin_pet`, `admin_pet_set`.

### Diário do Pedro (`pedro_diary_v1`)
- Entradas `{id, quando, tipo, evento, texto, humor, local, marcante, fonte, lido, reacao}`. **Marcantes** (achou presente, passarinho, sonho, se escondeu, dormiu nos papéis…) viram entrada própria;
  os **triviais** viram **um resumo por turno** (manhã/tarde/noite) — sem spam.
- Texto: **templates** na voz do Pedro; o **LLM só reescreve os marcantes**, com orçamento de **4/dia** (uma falha para tudo e mantém o modelo; protege a cota Groq do Jarbas).
  **Anti-alucinação:** o prompt só recebe os fatos do evento (sonho é fantasia declarada), proíbe cobrar/lamentar e a resposta passa por um filtro (curta, sem lista, sem "agenda/tarefa/painel…").
- UI: botão 📖 com **badge de novas**, linha do tempo por dia com ícone do evento, **💛** (vira afeto +6 e uma memória "momento", uma vez por entrada) e **copiar** a entrada.
- Admin: abas **Diário** (ver/apagar) e **Estado** (ver `ultimoTick`, onde está, o que faz, pushes de hoje; editar/zerar necessidades de teste).

### Push e mensagens espontâneas (`src/pedro/push-policy.js`, pura e testada)
- Limites: **máx. 3/dia** (configurável, 0–6), **silêncio 22h–8h** (configurável), **≥ 2 h** entre pushes, **nunca o mesmo tipo em sequência**, e **cancela se o app foi aberto/usado há menos de 30 min**.
- Tipos (por prioridade): *descoberta* (marcante com presente/passarinho…), *diário* (outro marcante), *saudade* leve (≥ 10 h sem abrir; 1/dia; **sem cobrança nem culpa**) e *fome* (rara, 1/dia).
- O texto do push reaproveita o texto do diário. Toque no push **abre a tela do Pedro com a mensagem na bolha** (`/?pedro=1&msg=…` ou `postMessage` se o app já está aberto). A fala também entra no chat.
- Preferências em `pedro_pet_v1.config.push` (ligar/desligar na lojinha ⚙, limite, janela). Inscrições (`pedro_push_subs`) intactas.

### Custos estimados (registrar também no README)
| Item | Volume/dia |
|---|---|
| Cron a cada **10 min** | 144 chamadas; cada uma: ~4 leituras + ~2 escritas no Neon, **sem LLM** na maioria |
| LLM do diário | **≤ 4** chamadas (só marcantes); + as do chat (como antes) |
| Push | **≤ 3** |
| Cena 3D | 100 % no cliente (zero custo de servidor) |

### Para ativar (quando você aprovar) — checklist
1. **Backup** (`scripts/pedro-backup.mjs`) e **rotação de segredos** (GitHub, `GROQ_API_KEY`, VAPID privada, `CRON_SECRET`).
2. Env na Vercel: `PEDRO_ATIVO=1` (+ as chaves existentes de Groq/OpenAI, VAPID, `CRON_SECRET`). No front: `PEDRO_ATIVO = true` em `src/pedro-standby.js`.
3. No **cron-job.org**: apontar para `…/api/pedro-cron?secret=…` **a cada 10 min** e retomar o job.
4. Abrir o Pedro, aceitar notificações (🔔) pra registrar a inscrição.

### Testes e verificação
- `src/pedro-sim.test.mjs`: determinismo, 12 h de ausência (local consistente, necessidades válidas, rotina de gato por hora), teto de 48 h, ids estáveis, efeitos, textos do diário (nada de agenda/culpa), turnos, resumos, dedupe, prompt/sanitização, **política de push** (silêncio, teto, intervalo, tipo repetido, app aberto, novo dia, saudade sem culpa).
- `api/_pedro-life.test.mjs` (banco falso): `tickPedro` de 12 h, dedupe mesmo com escrita concorrente antiga, LLM do diário (só marcantes, orçamento, falha, resposta imprópria), `applyUpdate` (validação), diário (lido/💛 uma vez), **cron** (silêncio, push com orçamento, intervalo, app aberto, sem VAPID, registro no chat), chat com estado e diário. Isolamento do painel continua verde (inclui `_pedro-life.js`).
- Navegador (headless): servidor simulado rodando o **código real** de `_pedro-life.js`, partindo de 12 h sem abrir: o gato nasceu no ponto exato do servidor ("dormindo no tapete"), 5 entradas, balão "Enquanto você não tava…", badge 📖, marcar lido e 💛 → afeto + memória.
- **Não verificado:** push real (web-push/VAPID/SW em aparelho), o cron contra o Neon e o LLM reais, e o import de `../src/pedro/*` pelo bundler da Vercel (padrão comum, mas é a primeira vez neste projeto: se o deploy reclamar, copiar os módulos puros para `api/`).

### Limitações conhecidas
- O chat (`pedro_chat_v1`) ainda é escrito pelo app e, no push, pelo servidor: se os dois escreverem ao mesmo tempo (app aberto durante o push, o que a política evita), uma fala pode se perder.
- Escritas concorrentes cron × app no `pedro_pet_v1` são "última vence" (o app só envia deltas via `pet_update`, que relê o estado; o diário usa ids estáveis, então não duplica).
- Quintal, passeio e descobertas ao ar livre: Fase 5.
