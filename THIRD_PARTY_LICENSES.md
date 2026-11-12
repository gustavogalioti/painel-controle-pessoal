# Licenças de terceiros

## three.js — MIT
- Fonte: https://github.com/mrdoob/three.js
- Uso: renderização 3D do mundo do Pedro (`npm` dependency `three`).
- Copyright © 2010-2026 three.js authors. Licença MIT (texto em `node_modules/three/LICENSE`).

## threejs-procedural-animals (procedural-animals) — MIT
- Fonte: https://github.com/majidmanzarpour/threejs-procedural-animals
- Uso: gato procedural do Pedro (espécie `cat`, variante `ginger`). **Vendorizado** em
  `src/pedro/vendor/procedural-animals/` (só o núcleo + espécie `cat`; as outras 23 espécies foram podadas).
- Modificações locais (marcadas com `[Pedro Virtual]` no código): `registry.js` enxuto (só `cat`) e
  `species/cat/coat.js` com o override `muzzleWhite` (focinho e queixo brancos no ginger).
- Copyright (c) 2026 Majid Manzarpour and procedural-animals contributors. Licença MIT completa em
  `src/pedro/vendor/procedural-animals/LICENSE`.
- O arquivo `public/pedro/pedro-cat-medium.animal` é um **bake** gerado por essa biblioteca
  (`node scripts/pedro-bake.mjs`), sem nenhum modelo/textura de terceiros.

## Assets
- Todos os móveis, props, texturas (canvas procedural) e luzes da sala são código próprio deste repositório.
- **Nenhum** asset, modelo, textura, som ou screenshot do Nintendogs + Cats (ou de qualquer jogo) é usado ou
  versionado: o material enviado pelo Gustavo é apenas referência privada de proporção/câmera/estilo.
