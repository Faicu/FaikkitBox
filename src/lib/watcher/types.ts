// Formele trimise clientului. Fără importuri, ca să nu tragă cod server în bundle.

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
  // Ultima rulare care a făcut ceva (din istoric) — ultima rulare simplă, la
  // sarcinile dese, ar fi mereu „acum”.
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
