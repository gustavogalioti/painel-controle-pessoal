# Painel de Controle Pessoal

Dashboard pessoal com diário, documentos, contas, compromissos, curiosidades, notícias e indicadores de mercado em tempo real.

## Tecnologias

- React 18 + Vite
- CSS Variables (sem biblioteca de UI)
- LocalStorage para persistência
- Ticker de mercado simulado (live ticks a cada 3s)

## Como rodar localmente

```bash
npm install
npm run dev
```

Acesse: http://localhost:5173

## Como fazer build

```bash
npm run build
```

## Deploy no Vercel (recomendado)

1. Suba o projeto no GitHub
2. Acesse [vercel.com](https://vercel.com) e importe o repositório
3. Clique em Deploy — zero configuração necessária

## Estrutura

```
src/
  App.jsx       # Toda a aplicação (componentes, lógica, UI)
  index.css     # Variáveis de tema + reset global
  main.jsx      # Entry point React
index.html      # HTML base
vite.config.js  # Configuração Vite
```

## Módulos

| Seção | Abas |
|---|---|
| Pessoal | Diário, Documentos, Contas, Compromissos |
| Profissional | (em construção) |
| Informações | Curiosidades, Notícias, Indicadores |

## Tarefas — Daily Command Center

A aba Tarefas abre em **Meu Dia**; o Kanban original continua em **Todas as Tarefas**.
Visões: Meu Dia · Caixa de Entrada · Próximos Dias · Todas as Tarefas · Histórico.

- `src/DailyCenter.jsx` — telas, rituais (planejar / revisar / encerrar), captura rápida e Modo Foco
- `src/daily-lib.js` — regras puras (testadas com `npm test`)
- `src/daily.css` — tokens e estilos (escopo `.dcc`)

Dados: continua em `tasks_v1`. Campos novos e opcionais por tarefa: `plannedDate`, `focusDate`/`focusOrder`,
`estimatedMinutes`, `nextAction`, `steps`, `inbox`, `deferredCount`/`deferrals`. Novas chaves de sync: `daily_reviews_v1`, `focus_log_v1`.
O timer do Modo Foco usa timestamps e sincroniza via `dcc_focus_timer_v1` (inicie no PC, retome no celular).
A agenda do planejamento junta `events_v1` + Google + Outlook (pessoal/corporativo) conectados.
Tarefas criadas pelo Pedro, Jarbas e ChatGPT sem tag/prazo entram com `inbox: true` (Caixa de Entrada).
`useKV` expõe `{ error, retry }` como 4º retorno; escritas que falham são reenviadas em vez de sobrescritas pela nuvem.
