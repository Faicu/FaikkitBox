// Semnal către Watcher: pornește sarcina la tactul următor (vezi poke în
// runner.ts). Fără importuri — poate fi chemat din orice server function;
// dacă Watcher-ul nu rulează (teste, dev), nu face nimic.
export function pokeWatcher(taskId: string): void {
  globalThis.__faikkitboxWatcherPoke?.(taskId);
}
