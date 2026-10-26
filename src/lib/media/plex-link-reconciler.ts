// ---------------------------------------------------------------------------
// Reconciliere periodică: titluri descărcate complet, dar nelegate încă la Plex.
//
// În primele 30 de minute după terminare, legarea o încearcă sarcina
// „downloads” a Watcher-ului, la fiecare 10s. Ce rămâne nelegat după asta —
// fișier întârziat în scanarea Plex, Plex oprit o vreme — e reîncercat aici, la
// 10 minute, până la 72h.
//
// Istoric: înainte de Watcher, legarea era o buclă de 30 de minute în memorie,
// iar un restart în fereastra ei lăsa rândul permanent cu plex_rating_key NULL,
// blocat pe "Se procesează în Plex" în Bibliotecă. Jobul de aici a apărut ca
// plasă de siguranță pentru asta; acum fereastra scurtă stă și ea în DB, deci
// rămâne plasă doar pentru titlurile care întârzie în Plex.
// ---------------------------------------------------------------------------

import { getDb } from "../db";
import {
  resolveMediaPlexLinkByTorrentHash,
  resolveSeasonPackPlexLinks,
  repairLinkedMovieQuality,
} from "./media";

// Cât timp după completare mai merită reîncercat. Peste asta, fie fișierul nu a
// ajuns niciodată în bibliotecă (șters manual, mutat, respins de Plex), fie e
// nevoie de intervenție — reîncercarea la nesfârșit ar fi doar zgomot.
const MAX_AGE_HOURS = 72;
// Primele 30 de minute după terminare sunt ale sarcinii „downloads”, care
// încearcă legarea la fiecare 10s (vezi listRecentlyCompletedUnlinked).
export const RECENT_LINK_MINUTES = 30;

export interface ReconcileResult {
  checked: number;
  linked: number;
}

export async function reconcilePlexLinks(): Promise<ReconcileResult> {
  const db = getDb();

  // Un hash poate acoperi mai multe rânduri (pachet de sezon), de aceea DISTINCT
  // — funcțiile de legare lucrează oricum la nivel de hash.
  // Filmele legate corect, dar fără calitate (nu s-a putut decide care versiune
  // Plex e a noastră) — altă stare decât „nelegat", deci altă interogare.
  const repaired = await repairLinkedMovieQuality(MAX_AGE_HOURS).catch((e) => {
    console.warn("[plex-reconcile] Eroare la completarea calităților:", e);
    return 0;
  });
  if (repaired > 0) {
    console.log(`[plex-reconcile] ${repaired} filme au primit calitatea lipsă`);
  }

  const rows = db
    .prepare(
      `SELECT DISTINCT torrent_hash FROM media
       WHERE torrent_hash IS NOT NULL
         AND plex_rating_key IS NULL
         AND completed_at IS NOT NULL
         AND completed_at > datetime('now', ?)
         AND completed_at <= datetime('now', ?)`,
    )
    .all(`-${MAX_AGE_HOURS} hours`, `-${RECENT_LINK_MINUTES} minutes`) as Array<{
    torrent_hash: string;
  }>;

  if (rows.length === 0) return { checked: 0, linked: 0 };

  let linked = 0;
  for (const { torrent_hash } of rows) {
    try {
      const ok = await resolveMediaPlexLinkByTorrentHash(torrent_hash);
      const okPack = ok ? false : await resolveSeasonPackPlexLinks(torrent_hash);
      if (ok || okPack) {
        linked++;
        console.log(`[plex-reconcile] Legat la Plex: ${torrent_hash}`);
      }
    } catch (e) {
      console.warn(`[plex-reconcile] Eroare la ${torrent_hash}:`, e);
    }
  }

  // rows.length > 0 e garantat aici (ieșirea devreme de mai sus acoperă
  // restul), deci logăm doar când chiar s-a legat ceva — altfel linia asta
  // apărea la fiecare 10 minute cât timp exista măcar un titlu în așteptare.
  if (linked > 0) {
    console.log(
      `[plex-reconcile] ${rows.length} titluri nelegate verificate, ${linked} legate acum`,
    );
  }
  return { checked: rows.length, linked };
}
