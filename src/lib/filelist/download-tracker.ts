// ---------------------------------------------------------------------------
// Urmărirea descărcărilor — sarcina „downloads” a Watcher-ului, de la
// pornirea unei descărcări până la titlul gata în Plex.
//
// La fiecare rulare:
// 1. Torrentele neterminate din `media` (listUnfinishedTorrents), cerute toate
//    într-o singură cerere qBittorrent. Cele ajunse la 100% pornesc
//    finalizarea (finalizeDownload din download.ts) ca operațiune separată,
//    fără ca rularea s-o aștepte: subtitrarea poate dura minute, iar celelalte
//    torrente n-au de ce să stea după ea.
// 2. Legarea la Plex a celor terminate de cel mult 30 de minute.
// 3. La 10 minute, reconcilierea (plex-link-reconciler.ts): legarea celor
//    terminate de peste 30 de minute, până la 72h. Era o sarcină separată,
//    „Legare Plex”; aici nu mai pot lega simultan același pachet de sezon.
//
// Ritmul depinde de ce e de făcut: la 10s cât se descarcă, se finalizează sau
// se leagă ceva; la 10 minute cât rămân doar titluri nelegate mai vechi; altfel
// doarme — o descărcare nouă o trezește (pokeWatcher în download.ts), iar o
// verificare din oră în oră rămâne plasă de siguranță.
//
// Starea e toată în DB, deci un restart nu pierde nimic: descărcările
// neterminate și legările în curs sunt prinse la primul tact de după pornire.
// Înainte, fiecare torrent avea propria buclă în memorie (30s, până la 48h,
// plus 30 de minute de legare), reluată la pornire de o sarcină separată.
// ---------------------------------------------------------------------------

import type { QbitTorrentInfo } from "./types";

const RECONCILE_EVERY_MS = 10 * 60_000;
const IDLE_CHECK_MS = 60 * 60_000;

declare global {
  var __faikkitboxFinalizing: Set<string> | undefined;
  // Ultima reconciliere și dacă a lăsat titluri nelegate. În memorie: după un
  // restart, reconcilierea rulează la prima rulare, ca înainte la pornire.
  var __faikkitboxReconcile: { at: number; pending: boolean } | undefined;
}

// Torrentele în curs de finalizare (redenumire, subtitrare, refresh Plex).
// Pe globalThis, nu în modul: plugin-ul și server functions rulează în copii
// separate ale modulelor, dar în același proces — „Ștergeri programate” o
// citește ca să nu șteargă un torrent exact cât i se scriu fișierele.
export function finalizingHashes(): Set<string> {
  return (globalThis.__faikkitboxFinalizing ??= new Set());
}

// `nextAt` null = ritmul obișnuit al sarcinii (10s); altfel ora următoarei
// rulări (vezi WatcherOutcome în watcher/tasks.ts).
export async function trackDownloads(): Promise<{ summary: string | null; nextAt: number | null }> {
  const qbitUrl = (process.env.QBIT_URL ?? "http://192.168.1.192:25556").replace(/\/$/, "");
  const qbitUser = process.env.QBIT_USERNAME;
  const qbitPass = process.env.QBIT_PASSWORD;
  if (!qbitUser || !qbitPass) return { summary: null, nextAt: Date.now() + IDLE_CHECK_MS };

  const media = await import("../media/media");
  const finalizing = finalizingHashes();
  const parts: string[] = [];

  const allUnfinished = media.listUnfinishedTorrents();
  const unfinished = allUnfinished.filter((t) => !finalizing.has(t.torrentHash));
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
      // până iese din fereastra de 14 zile.
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
  const recent = media.listRecentlyCompletedUnlinked(RECENT_LINK_MINUTES);
  const toLink = recent.filter((h) => !finalizing.has(h));
  let linked = 0;
  for (const hash of toLink) {
    // O eroare (Plex oprit, scanare neterminată) e tăcută, ca în bucla veche:
    // se reîncearcă peste 10s, iar după 30 de minute o preia reconcilierea.
    const ok = await media.resolveMediaPlexLinkByTorrentHash(hash).catch(() => false);
    const okPack = ok ? false : await media.resolveSeasonPackPlexLinks(hash).catch(() => false);
    if (ok || okPack) linked++;
  }

  // Reconcilierea, la 10 minute. Completează și calitatea filmelor legate fără
  // ea; dacă doar asta mai e de făcut, se întâmplă la verificarea orară.
  const now = Date.now();
  let reconcile = globalThis.__faikkitboxReconcile;
  if (!reconcile || now - reconcile.at >= RECONCILE_EVERY_MS) {
    const { reconcilePlexLinks } = await import("../media/plex-link-reconciler");
    const r = await reconcilePlexLinks();
    linked += r.linked;
    reconcile = globalThis.__faikkitboxReconcile = {
      at: now,
      pending: r.checked > r.linked,
    };
  }
  if (linked) parts.push(`${linked} ${linked === 1 ? "legat" : "legate"} la Plex`);

  const active = allUnfinished.length > 0 || finalizing.size > 0 || recent.length > 0;
  const nextAt = active
    ? null
    : reconcile.pending
      ? reconcile.at + RECONCILE_EVERY_MS
      : now + IDLE_CHECK_MS;
  return { summary: parts.length ? parts.join(" · ") : null, nextAt };
}
