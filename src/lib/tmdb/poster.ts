// Dimensiunea posterelor TMDB, ca operație pe URL.
//
// TMDB servește aceeași imagine la orice dimensiune, schimbând un singur
// segment din adresă: /t/p/w92/abc.jpg ↔ /t/p/w342/abc.jpg. De-asta
// redimensionarea e o rescriere de text, nu o cerere nouă.
//
// Există fiindcă posterele ajungeau în `media` la două rezoluții diferite,
// după cum fusese adăugat titlul: lista de căutare a wizard-ului cere w92
// (corect pentru miniaturile ei de 40px), dar valoarea aia se salva apoi ca
// atare și rămânea acolo — inclusiv pentru drawer-ul din Bibliotecă, unde
// posterul se vede la ~170×240px fizici și un w92 e vizibil moale.
//
// Modul fără dependențe: îl folosesc și componentele de client, și codul de
// server (notificări push).

// Ce se salvează în `media.poster_path`. Destul pentru cel mai mare loc în
// care e afișat (drawer-ul din Bibliotecă), fără să încărcăm inutil listele.
export const STORED_POSTER_SIZE = "w342";

/** Rescrie dimensiunea dintr-un URL de poster TMDB. Lasă neatins orice altceva. */
export function resizePosterUrl(url: string | null, size: string): string | null {
  if (!url) return null;
  return url.replace(/\/t\/p\/w\d+\//, `/t/p/${size}/`);
}

/**
 * Dimensiunea în care merită păstrat un poster. Aplicat ORICÂND se scrie în
 * `media`, ca sursa (căutare, detalii, Descoperă) să nu mai decidă calitatea
 * pe care o vei vedea peste luni în Bibliotecă.
 */
export function normalizeStoredPoster(url: string | null): string | null {
  return resizePosterUrl(url, STORED_POSTER_SIZE);
}
