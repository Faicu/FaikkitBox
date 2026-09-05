// ---------------------------------------------------------------------------
// Limitare de rată în memorie, pentru endpoint-urile de autentificare.
//
// Fereastră fixă per cheie (IP, sau IP+utilizator la login). În memorie e
// suficient: rulează un singur proces Node, iar la restart limitele se resetează
// — acceptabil, fiindcă un restart nu e ceva ce poate provoca un atacator.
//
// Aceeași idee ca limitarea din errors/error-log.ts, extrasă aici ca să fie
// folosită de mai multe locuri.
// ---------------------------------------------------------------------------

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

// Curățare periodică — altfel harta crește nemărginit cu fiecare IP nou văzut
// (o cale ieftină de a consuma memoria serverului din exterior).
const SWEEP_INTERVAL_MS = 10 * 60_000;
let sweepTimer: ReturnType<typeof setInterval> | null = null;

function ensureSweeper(windowMs: number): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    const cutoff = Date.now() - Math.max(windowMs, SWEEP_INTERVAL_MS);
    for (const [key, b] of buckets) {
      if (b.windowStart < cutoff) buckets.delete(key);
    }
  }, SWEEP_INTERVAL_MS);
  // Nu ține procesul în viață doar pentru curățenie.
  sweepTimer.unref?.();
}

export interface RateLimitResult {
  allowed: boolean;
  /** Secunde până la resetarea ferestrei — pentru mesajul afișat userului. */
  retryAfterSec: number;
}

/**
 * Înregistrează o încercare pe cheia dată și spune dacă e permisă.
 * Depășirea limitei NU prelungește fereastra (fixă), ca o rafală să nu poată
 * bloca la nesfârșit un utilizator legitim de pe același IP.
 */
export function hitRateLimit(key: string, max: number, windowMs: number): RateLimitResult {
  ensureSweeper(windowMs);
  const now = Date.now();
  const b = buckets.get(key);

  if (!b || now - b.windowStart > windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return { allowed: true, retryAfterSec: 0 };
  }

  b.count++;
  if (b.count > max) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((b.windowStart + windowMs - now) / 1000)),
    };
  }
  return { allowed: true, retryAfterSec: 0 };
}

/** Șterge contorul unei chei — apelat după o autentificare reușită. */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

export function formatRetryAfter(sec: number): string {
  if (sec < 60) return `${sec} secunde`;
  const min = Math.ceil(sec / 60);
  return `${min} ${min === 1 ? "minut" : "minute"}`;
}
