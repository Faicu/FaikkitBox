// Calitatea de rezervă a urmăririi (seriale și filme) — funcție pură, ca
// regula să poată fi testată fără Filelist.
//
// Regula, per țintă (un episod, un pachet de sezon, un film):
// - dacă apare calitatea principală, se ia principala;
// - dacă apare doar rezerva, NU se descarcă nimic, dar se notează momentul;
// - la o verificare ulterioară, dacă principala tot lipsește și au trecut cel
//   puțin 3 ore de la prima notare, se ia rezerva.
//
// Pragul de 3 ore e cadența urmăririi serialelor: „a doua verificare" trebuie
// să fie una reală, nu un „Verifică acum" apăsat de două ori la rând, altfel
// rezerva s-ar lua imediat — adică exact ce regula vrea să evite (1080p apare
// des la o oră-două după 720p).

export const FALLBACK_WAIT_MS = 3 * 60 * 60 * 1000;

// țintă → momentul ISO în care s-a găsit prima dată doar rezerva.
export type FallbackSeen = Record<string, string>;

export function parseFallbackSeen(raw: string | null): FallbackSeen {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Rezerva e activă doar dacă e setată și diferă de principală.
export function effectiveFallback(
  primary: string,
  fallback: string | null | undefined,
): string | null {
  return fallback && fallback !== primary ? fallback : null;
}

// Pentru o țintă la care s-a găsit doar rezerva: se poate lua acum?
// `firstSeen` e momentul de păstrat în notițe dacă încă se așteaptă.
export function fallbackReady(
  target: string,
  seen: FallbackSeen,
  now: number,
): { ready: boolean; firstSeen: string } {
  const prev = seen[target];
  const prevMs = prev ? new Date(prev).getTime() : NaN;
  if (!Number.isFinite(prevMs)) {
    return { ready: false, firstSeen: new Date(now).toISOString() };
  }
  return { ready: now - prevMs >= FALLBACK_WAIT_MS, firstSeen: prev! };
}
