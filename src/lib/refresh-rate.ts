// ---------------------------------------------------------------------------
// Ritmul statisticilor live, reglabil per dispozitiv (localStorage — un telefon
// pe date mobile poate vrea alt ritm). Citit printr-o funcție, evaluată de
// `refetchInterval` la fiecare tick, deci schimbarea are efect imediat.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "faikkitbox:refreshMs";

export const REFRESH_MIN_MS = 1000;
export const REFRESH_MAX_MS = 30_000;
// 1s implicit — tot setul costă acum ~55ms/s pe server, partajat între tab-uri
// (discovery Plex pe LAN, statistici Docker stale-while-revalidate). Sub 1s
// nu: si.currentLoad() măsoară delta față de apelul anterior, deci ar fi zgomot.
// Ce curge la secundă (uptime, poziția de redare) e interpolat local.
export const REFRESH_DEFAULT_MS = 1000;

export const REFRESH_PRESETS = [
  { label: "1s", ms: 1000 },
  { label: "2s", ms: 2000 },
  { label: "3s", ms: 3000 },
  { label: "5s", ms: 5000 },
  { label: "10s", ms: 10_000 },
  { label: "30s", ms: 30_000 },
] as const;

// Cache în memorie: refetchInterval e apelat des.
let cached: number | null = null;

function clamp(ms: number): number {
  if (!Number.isFinite(ms)) return REFRESH_DEFAULT_MS;
  return Math.min(REFRESH_MAX_MS, Math.max(REFRESH_MIN_MS, Math.round(ms)));
}

export function getRefreshMs(): number {
  if (cached !== null) return cached;
  // Pe server (SSR) — implicitul.
  if (typeof localStorage === "undefined") return REFRESH_DEFAULT_MS;
  const raw = localStorage.getItem(STORAGE_KEY);
  cached = raw ? clamp(Number(raw)) : REFRESH_DEFAULT_MS;
  return cached;
}

type Listener = (ms: number) => void;
const listeners = new Set<Listener>();

export function setRefreshMs(ms: number): void {
  const v = clamp(ms);
  cached = v;
  try {
    localStorage.setItem(STORAGE_KEY, String(v));
  } catch {
    // Mod privat sau storage plin — setarea ține doar sesiunea curentă.
  }
  for (const l of listeners) l(v);
}

export function onRefreshMsChange(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

// Sesiunile Plex mai dese decât restul, dar nu mai dese decât ritmul ales
// (economia de baterie trebuie să se aplice și lor).
export function getFastRefreshMs(): number {
  return Math.min(getRefreshMs(), 1000);
}
