import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// worker.format "es" + target es2022: exigidos pela lib de animais procedurais (src/pedro/vendor),
// que gera o Pedro 3D em Web Workers (módulos).
export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  build: { target: 'es2022' },
})
