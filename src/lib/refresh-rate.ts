// ---------------------------------------------------------------------------
// Ritmul de reîmprospătare al statisticilor live, reglabil de utilizator.
//
// Preferință per-dispozitiv (localStorage), nu setare globală în DB: e o
// alegere de afișare, iar un telefon pe date mobile poate vrea alt ritm decât
// desktopul din casă.
//
// Citit prin funcție (nu constantă) fiindcă `refetchInterval` din TanStack
// Query acceptă un callback, evaluat la fiecare tick — deci o schimbare are
// efect imediat, fără remontarea componentelor sau reîncărcarea paginii.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "faikkitbox:refreshMs";

export const REFRESH_MIN_MS = 1000;
export const REFRESH_MAX_MS = 30_000;
// 1s implicit. A fost 3s, apoi 2s, cât timp o colectare costa secunde întregi.
// După ce discovery-ul Plex a fost pus pe LAN (~5ms în loc de ~539ms) și partea
// scumpă a statisticilor de sistem a trecut pe stale-while-revalidate (~7ms în
// loc de ~2400ms), tot setul costă ~55ms/secundă pe server, partajat între toate
// tab-urile. Nu mai există motiv să fie mai lent.
//
// Sub 1s nu coborâm intenționat: si.currentLoad() măsoară încărcarea ca delta
// față de apelul anterior, deci eșantioane sub-secundă devin zgomot, nu
// informație. Ce chiar trebuie să curgă la secundă (uptime, poziția de redare
// Plex) e interpolat local, fără nicio cerere — vezi use-live-counter.ts.
export const REFRESH_DEFAULT_MS = 1000;

export const REFRESH_PRESETS = [
  { label: "1s", ms: 1000 },
  { label: "2s", ms: 2000 },
  { label: "3s", ms: 3000 },
  { label: "5s", ms: 5000 },
  { label: "10s", ms: 10_000 },
  { label: "30s", ms: 30_000 },
] as const;

// Cache în memorie: refetchInterval e apelat des, nu vrem o citire din
// localStorage la fiecare tick al fiecărui query.
let cached: number | null = null;

function clamp(ms: number): number {
  if (!Number.isFinite(ms)) return REFRESH_DEFAULT_MS;
  return Math.min(REFRESH_MAX_MS, Math.max(REFRESH_MIN_MS, Math.round(ms)));
}

export function getRefreshMs(): number {
  if (cached !== null) return cached;
  // Pe server (SSR) nu există localStorage — folosim implicitul.
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
    // mod privat / storage plin — setarea rămâne doar pentru sesiunea curentă
  }
  for (const l of listeners) l(v);
}

export function onRefreshMsChange(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

// Statisticile "rapide" (sesiuni Plex) rămân mai dese decât restul, dar nu mai
// dese decât ritmul ales — altfel un utilizator care pune 30s ca să economisească
// baterie ar continua să primească o cerere pe secundă.
export function getFastRefreshMs(): number {
  return Math.min(getRefreshMs(), 1000);
}
