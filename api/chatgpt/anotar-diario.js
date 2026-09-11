export const config = { runtime: "edge" };
import { makeHandler, anotarDiario } from "../_gusos-lib.js";

// Criação, baixo risco, reversível manualmente pelo painel:
// x-openai-isConsequential: false no schema.
export default makeHandler("anotar_diario", anotarDiario);
