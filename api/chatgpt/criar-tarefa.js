export const config = { runtime: "edge" };
import { makeHandler, criarTarefa } from "../_gusos-lib.js";

// Ação de CRIAÇÃO — apenas adiciona um item novo aos dados do próprio
// usuário; reversível manualmente pelo painel (lixeira no card).
// Baixo risco: exposta com x-openai-isConsequential: false.
export default makeHandler("criar_tarefa", criarTarefa);
