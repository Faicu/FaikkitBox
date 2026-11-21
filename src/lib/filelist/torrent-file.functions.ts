// Server function pentru adăugarea unui .torrent de mână (torrent-file.ts).
// Fișier separat, cu importuri dinamice în handler: componenta de client nu
// trage graful server (db.ts) în bundle-ul public.

import { createServerFn } from "@tanstack/react-start";

import type { TorrentFileInput, TorrentFileResult } from "./torrent-file";

export type { TorrentFileResult } from "./torrent-file";

// `dryRun` = previzualizarea (titlul TMDB, numele, mărimea), fără trimitere.
export const addTorrentFile = createServerFn({ method: "POST" })
  .validator((data: TorrentFileInput) => ({
    ...data,
    season: data.season != null ? Number(data.season) : null,
    episode: data.episode != null ? Number(data.episode) : null,
  }))
  .handler(async ({ data }): Promise<TorrentFileResult> => {
    const { requireAdmin } = await import("../auth/admin.server");
    const session = await requireAdmin();
    const { addTorrentFileCore } = await import("./torrent-file");
    return addTorrentFileCore(data, session.data.userId ?? null);
  });
