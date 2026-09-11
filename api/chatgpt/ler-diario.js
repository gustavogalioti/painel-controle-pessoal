export const config = { runtime: "edge" };
import { makeHandler, lerDiario } from "../_gusos-lib.js";

// Leitura, baixo risco: x-openai-isConsequential: false no schema.
export default makeHandler("ler_diario", lerDiario);
