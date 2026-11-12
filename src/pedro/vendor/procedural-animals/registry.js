// [Pedro Virtual] Versão enxuta: só a espécie 'cat' foi vendorizada (as outras 23 espécies da lib foram podadas).
// Species registry. String ids resolve through loaders (dynamic imports), so a bundler only pulls in
// the species a game actually asks for. Species modules can also be imported and registered
// directly: `import wolf from 'procedural-animals/species/wolf'; createAnimal(wolf, ...)`.
const loaders = {
  cat: () => import('./species/cat/index.js'),
};
const loaded = new Map();

export function registerSpecies(mod) {
  const s = mod.default || mod;
  loaded.set(s.id, s);
  return s;
}

export async function loadSpecies(id) {
  if (typeof id === 'object' && id) return registerSpecies(id);
  if (loaded.has(id)) return loaded.get(id);
  const l = loaders[id];
  if (!l) throw new Error(`procedural-animals: unknown species "${id}". Known: ${listSpecies().join(', ')}`);
  return registerSpecies(await l());
}

export function getLoadedSpecies(id) { return loaded.get(id); }
export function listSpecies() { return [...new Set([...Object.keys(loaders), ...loaded.keys()])]; }
export function addLoader(id, fn) { loaders[id] = fn; }
