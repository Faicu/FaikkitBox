// Aduce rularea unei sarcini cel târziu la `delayMs` de acum (poke din
// runner.ts). Fără importuri; fără Watcher (teste, dev) nu face nimic.
export function pokeWatcher(taskId: string, delayMs = 0): void {
  globalThis.__faikkitboxWatcherPoke?.(taskId, delayMs);
}
