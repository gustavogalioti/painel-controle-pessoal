// Detecção de "chamar o Pedro" pelo nome/apelido no chat. Função pura (sem three/React).
// Match tolerante: sem acento, sem caixa, letras repetidas ("Pedruxooo"), pequena
// distância de edição (typo) e só conta como CHAMADO se o nome está em posição de
// vocativo (início ou fim da mensagem) — "o Pedro foi ao mercado" não chama.
export const DEFAULT_APELIDOS = ["pedro", "pedrinho", "pedruxo", "pedrão", "pedro timóti"];

const SAUDACOES = new Set(["oi", "ola", "e", "ei", "ey", "opa", "fala", "salve", "eai", "psiu", "psit", "venha", "vem", "cade", "cadê", "boa", "bom"]);

function fold(s) {
  return (s || "").toString().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/(.)\1+/g, "$1") // letras repetidas -> uma
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function lev(a, b) {
  if (a === b) return 0;
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return dp[b.length];
}

const sameWord = (w, name) => w === name || (name.length >= 5 && Math.abs(w.length - name.length) <= 1 && lev(w, name) <= 1);

// -> { called, name, vocative }
export function detectCall(text, apelidos = DEFAULT_APELIDOS) {
  const tokens = fold(text).split(" ").filter(Boolean);
  if (!tokens.length) return { called: false, name: null, vocative: false };
  const names = [...apelidos].map(fold).filter(Boolean).sort((a, b) => b.split(" ").length - a.split(" ").length);
  for (const name of names) {
    const parts = name.split(" ");
    for (let i = 0; i + parts.length <= tokens.length; i++) {
      if (!parts.every((p, k) => sameWord(tokens[i + k], p))) continue;
      const end = i + parts.length;
      const atStart = i === 0 || (i === 1 && SAUDACOES.has(tokens[0])) || (i === 2 && SAUDACOES.has(tokens[0]) && SAUDACOES.has(tokens[1]));
      const atEnd = end === tokens.length;
      if (atStart || atEnd) return { called: true, name, vocative: true };
    }
  }
  return { called: false, name: null, vocative: false };
}
