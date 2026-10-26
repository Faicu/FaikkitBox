// ---------------------------------------------------------------------------
// Urmărirea descărcărilor — sarcina „downloads” a Watcher-ului, la 10s.
//
// La fiecare tact:
// 1. Torrentele neterminate din `media` (listUnfinishedTorrents), cerute toate
//    într-o singură cerere qBittorrent. Cele ajunse la 100% pornesc
//    finalizarea (finalizeDownload din download.ts) ca operațiune separată,
//    fără ca tactul s-o aștepte: subtitrarea poate dura minute, iar celelalte
//    torrente n-au de ce să stea după ea.
// 2. Legarea la Plex a celor terminate de cel mult 30 de minute.
//
// Starea e toată în DB, deci un restart nu pierde nimic: descărcările
// neterminate și legările în curs sunt prinse la primul tact de după pornire.
// Înainte, fiecare torrent avea propria buclă în memorie (30s, până la 48h,
// plus 30 de minute de legare), reluată la pornire de o sarcină separată.
// ---------------------------------------------------------------------------

import type { QbitTorrentInfo } from "./types";

declare global {
  var __faikkitboxFinalizing: Set<string> | undefined;
}

// Torrentele în curs de finalizare (redenumire, subtitrare, refresh Plex).
// Pe globalThis, nu în modul: plugin-ul și server functions rulează în copii
// separate ale modulelor, dar în același proces — „Ștergeri programate” o
// citește ca să nu șteargă un torrent exact cât i se scriu fișierele.
export function finalizingHashes(): Set<string> {
  return (globalThis.__faikkitboxFinalizing ??= new Set());
}

export async function trackDownloads(): Promise<string | null> {
  const qbitUrl = (process.env.QBIT_URL ?? "http://192.168.1.192:25556").replace(/\/$/, "");
  const qbitUser = process.env.QBIT_USERNAME;
  const qbitPass = process.env.QBIT_PASSWORD;
  if (!qbitUser || !qbitPass) return null;

  const media = await import("../media/media");
  const finalizing = finalizingHashes();
  const parts: string[] = [];

  const unfinished = media.listUnfinishedTorrents().filter((t) => !finalizing.has(t.torrentHash));
  if (unfinished.length > 0) {
    const { qbitGet } = await import("../qbit-client");
    const { finalizeDownload, isTorrentComplete } = await import("./download");
    // qbitGet reautentifică singur la 401/403 — SID-ul WebUI expiră după o oră.
    const res = await qbitGet(
      qbitUrl,
      `/api/v2/torrents/info?hashes=${unfinished.map((t) => t.torrentHash).join("|")}`,
      qbitUser,
      qbitPass,
    );
    if (!res.ok) throw new Error(`qBittorrent a răspuns HTTP ${res.status}`);
    const list = (await res.json()) as QbitTorrentInfo[];
    const byHash = new Map(list.map((t) => [String(t.hash ?? "").toLowerCase(), t]));

    const done: string[] = [];
    for (const t of unfinished) {
      // Lipsă din qBittorrent (șters manual): rămâne neterminat, fără zgomot,
      // până iese din fereastra de 48h.
      const info = byHash.get(t.torrentHash.toLowerCase());
      if (!info || !isTorrentComplete(Number(info.progress ?? 0), info.state ?? "")) continue;
      finalizing.add(t.torrentHash);
      done.push(t.torrentName);
      void finalizeDownload({ ...t, qbitUrl, qbitUser, qbitPass })
        .catch((e) => console.warn(`[filelist] Finalizarea „${t.torrentName}” a eșuat:`, e))
        .finally(() => finalizing.delete(t.torrentHash));
    }
    if (done.length) parts.push(`terminat: ${done.join(", ")}`);
  }

  // Legarea la Plex. Cele încă în finalizare n-au primit refresh-ul Plex, deci
  // n-au ce găsi acolo — vin la tactul de după.
  const { RECENT_LINK_MINUTES } = await import("../media/plex-link-reconciler");
  const toLink = media
    .listRecentlyCompletedUnlinked(RECENT_LINK_MINUTES)
    .filter((h) => !finalizing.has(h));
  let linked = 0;
  for (const hash of toLink) {
    // O eroare (Plex oprit, scanare neterminată) e tăcută, ca în bucla veche:
    // se reîncearcă peste 10s, iar după 30 de minute o preia reconcilierea.
    const ok = await media.resolveMediaPlexLinkByTorrentHash(hash).catch(() => false);
    const okPack = ok ? false : await media.resolveSeasonPackPlexLinks(hash).catch(() => false);
    if (ok || okPack) linked++;
  }
  if (linked) parts.push(`${linked} ${linked === 1 ? "legat" : "legate"} la Plex`);

  return parts.length ? parts.join(" · ") : null;
}
