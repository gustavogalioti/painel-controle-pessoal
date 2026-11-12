// Dados do mundo (sala): pontos de interesse (POIs) onde o Pedro pode estar. Sem three — só dados,
// compartilhados pela cena (RoomScene), pelo comportamento (brain) e, na Fase 4, pelo simulador do servidor.
// Metros. x: direita, z: em direção à câmera, parede dos fundos (janela) em z = -ROOM.d/2. Heading 0 olha +z.
export const ROOM = { w: 3.8, d: 3.8, h: 2.6 };

export const POIS = {
  centro:   { id: "centro",   x: 0.1,   z: 0.9,   heading: 0,    ativ: ["sentar", "limpar"] },
  sol:      { id: "sol",      x: -0.1,  z: -0.2,  heading: 2.6,  ativ: ["descansar_janela", "dormir", "limpar"] },
  janela:   { id: "janela",   x: -0.25, z: -1.35, heading: Math.PI, ativ: ["descansar_janela"] },
  tapete:   { id: "tapete",   x: 0.35,  z: 0.6,   heading: 0.4,  ativ: ["amassar", "brincar", "limpar", "dormir"] },
  caminha:  { id: "caminha",  x: -1.05, z: 0.75,  heading: 0.9,  ativ: ["dormir", "amassar"] },
  caixa:    { id: "caixa",    x: -1.4,  z: -0.15, heading: 1.3,  ativ: ["dormir", "esconder"] },
  mala:     { id: "mala",     x: -1.25, z: 1.55,  heading: 0.6,  ativ: ["dormir", "esconder"] },
  poltrona: { id: "poltrona", x: -1.15, z: -0.95, heading: 1.2,  ativ: ["dormir", "descansar_janela"] },
  papeis:   { id: "papeis",   x: 1.0,   z: -0.45, heading: -1.2, ativ: ["dormir", "limpar"] },
  comida:   { id: "comida",   x: 0.7,   z: -1.4,  heading: Math.PI, ativ: ["comer"] },
  agua:     { id: "agua",     x: 1.05,  z: -1.4,  heading: Math.PI, ativ: ["beber"] },
  arranhador: { id: "arranhador", x: 1.3, z: 1.25, heading: -1.5, ativ: ["arranhar", "explorar"] },
};

export const POI_IDS = Object.keys(POIS);

// Altura do chão (para os pés do gato) em (x, z): caminha afunda um pouco, tapete e papéis elevam um fio.
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
export function groundHeight(x, z) {
  const bed = Math.hypot(x - POIS.caminha.x, z - POIS.caminha.z);
  const rug = Math.hypot((x - 0.3) / 0.75, (z - 0.55) / 0.5);
  const paper = Math.max(Math.abs(x - POIS.papeis.x) / 0.32, Math.abs(z - POIS.papeis.z) / 0.28);
  return 0.075 * smooth(0.42, 0.28, bed) + 0.012 * smooth(1.0, 0.9, rug) + 0.02 * smooth(1.0, 0.85, paper);
}

// Mantém o gato dentro da sala (margem das paredes e dos móveis encostados).
export function clampToRoom(x, z, margin = 0.25) {
  return [Math.min(ROOM.w / 2 - margin, Math.max(-ROOM.w / 2 + margin, x)), Math.min(ROOM.d / 2 - margin, Math.max(-ROOM.d / 2 + margin, z))];
}
