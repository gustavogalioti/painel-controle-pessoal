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
