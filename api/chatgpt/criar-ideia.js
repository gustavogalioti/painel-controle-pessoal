export const config = { runtime: "edge" };
import { makeHandler, criarIdeia } from "../_gusos-lib.js";

// Criação, baixo risco, reversível manualmente: x-openai-isConsequential: false.
export default makeHandler("criar_ideia", criarIdeia);
