export const config = { runtime: "edge" };
import { makeHandler, lerTarefas } from "../_gusos-lib.js";

// Ação de LEITURA — dados internos do próprio usuário, sem efeito colateral.
// Baixo risco: exposta no schema OpenAPI com x-openai-isConsequential: false.
export default makeHandler("ler_tarefas", lerTarefas);
