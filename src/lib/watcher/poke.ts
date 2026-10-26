// Semnal către Watcher: aduce rularea sarcinii cel târziu la `delayMs` de acum
// (vezi poke în runner.ts). Fără importuri — poate fi chemat din orice server
// function; dacă Watcher-ul nu rulează (teste, dev), nu face nimic.
export function pokeWatcher(taskId: string, delayMs = 0): void {
  globalThis.__faikkitboxWatcherPoke?.(taskId, delayMs);
}
