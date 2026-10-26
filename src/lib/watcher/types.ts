// Formele trimise clientului de watcher.functions.ts. Fișier fără importuri,
// ca să poată fi citit și din componente fără să tragă cod server în bundle.

export interface WatcherTaskStatus {
  id: string;
  label: string;
  delayMs: number;
  everyMs: number | null;
  cadenceLabel: string | null;
  controllable: boolean;
  paused: boolean;
  // „Rulează acum” cerut, încă nepreluat de tact (sarcina rulează deja).
  requestedAt: string | null;
  runningSince: string | null;
  runningManual: boolean;
  nextRunAt: string | null;
  lastFinishedAt: string | null;
  lastDurationMs: number | null;
  lastOk: boolean | null;
  lastError: string | null;
  // Ultima rulare care a făcut efectiv ceva (din istoric) — rândul din Tehnic
  // o arată pe ea, nu ultima rulare, care la sarcinile dese e mereu „acum”.
  lastActionAt: string | null;
  lastActionSummary: string | null;
}

export interface WatcherRun {
  id: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  ok: boolean;
  manual: boolean;
  summary: string | null;
  error: string | null;
}
