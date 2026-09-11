export const config = { runtime: "edge" };
import { makeHandler, lerIdeias } from "../_gusos-lib.js";

// Leitura, baixo risco: x-openai-isConsequential: false no schema.
export default makeHandler("ler_ideias", lerIdeias);
