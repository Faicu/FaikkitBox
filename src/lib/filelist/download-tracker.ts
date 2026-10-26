// ---------------------------------------------------------------------------
// Sarcina „downloads” a Watcher-ului: descărcările, de la pornire până la
// titlul legat în Plex. La fiecare rulare:
// 1. torrentele neterminate din `media`, într-o singură cerere qBittorrent;
//    cele gata pornesc finalizarea (finalizeDownload) separat — subtitrarea
//    poate dura minute, iar celelalte n-au de ce să aștepte;
// 2. legarea la Plex a celor terminate de cel mult 30 de minute;
// 3. la 10 minute, reconcilierea celor mai vechi, până la 72h.
//
// Ritmul: 10s cât e ceva în curs, 10 minute cât rămân doar titluri nelegate
// mai vechi, altfel doarme (trezită de pokeWatcher, verificare orară). Starea
// e toată în DB, deci un restart nu pierde nimic.
// ---------------------------------------------------------------------------

import type { QbitTorrentInfo } from "./types";

const RECONCILE_EVERY_MS = 10 * 60_000;
const IDLE_CHECK_MS = 60 * 60_000;

declare global {
  var __faikkitboxFinalizing: Set<string> | undefined;
  // Ultima reconciliere; după un restart, reconcilierea rulează imediat.
  var __faikkitboxReconcile: { at: number; pending: boolean } | undefined;
}

// Torrentele în curs de finalizare. Pe globalThis: plugin-ul și server
// functions rulează în copii separate ale modulelor, dar în același proces —
// „Ștergeri programate” nu șterge un torrent cât i se scriu fișierele.
export function finalizingHashes(): Set<string> {
  return (globalThis.__faikkitboxFinalizing ??= new Set());
}

// `nextAt` null = ritmul obișnuit (10s); altfel ora următoarei rulări.
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
      // Lipsă din qBittorrent (șters manual): rămâne neterminat, fără zgomot.
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

  // Cele încă în finalizare n-au primit refresh-ul Plex — vin la tactul următor.
  const { RECENT_LINK_MINUTES } = await import("../media/plex-link-reconciler");
  const recent = media.listRecentlyCompletedUnlinked(RECENT_LINK_MINUTES);
  const toLink = recent.filter((h) => !finalizing.has(h));
  let linked = 0;
  for (const hash of toLink) {
    // Eroare tăcută (Plex oprit, scanare neterminată): se reia peste 10s.
    const ok = await media.resolveMediaPlexLinkByTorrentHash(hash).catch(() => false);
    const okPack = ok ? false : await media.resolveSeasonPackPlexLinks(hash).catch(() => false);
    if (ok || okPack) linked++;
  }

  // Reconcilierea completează și calitatea filmelor legate fără ea; dacă doar
  // asta mai e de făcut, se întâmplă la verificarea orară.
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
