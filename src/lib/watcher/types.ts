// Formele trimise clientului de watcher.functions.ts. Fișier fără importuri,
// ca să poată fi citit și din componente fără să tragă cod server în bundle.

export interface WatcherTaskStatus {
  id: string;
  label: string;
  delayMs: number;
  everyMs: number | null;
  group: string | null;
  controllable: boolean;
  paused: boolean;
  // „Rulează acum” cerut, încă nepreluat de tact (sarcina rulează deja sau
  // grupul ei e ocupat).
  requestedAt: string | null;
  runningSince: string | null;
  runningManual: boolean;
  nextRunAt: string | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastDurationMs: number | null;
  lastOk: boolean | null;
  lastError: string | null;
  lastSummary: string | null;
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
