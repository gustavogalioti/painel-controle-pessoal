export const config = { runtime: "edge" };
import { makeHandler, criarEvento } from "../_gusos-lib.js";

// Criação, baixo risco, reversível manualmente pelo painel/Google Calendar:
// x-openai-isConsequential: false no schema. Sincroniza com o Google
// Calendar automaticamente se estiver conectado (mesmo comportamento da UI).
export default makeHandler("criar_evento", criarEvento);
