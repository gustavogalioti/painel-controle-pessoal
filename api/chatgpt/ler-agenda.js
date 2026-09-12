export const config = { runtime: "edge" };
import { makeHandler, lerAgenda } from "../_gusos-lib.js";

// Leitura, baixo risco: x-openai-isConsequential: false no schema.
// Funde eventos locais (events_v1) com eventos ao vivo do Google Calendar,
// igual à tela de Agenda do painel.
export default makeHandler("ler_agenda", lerAgenda);
