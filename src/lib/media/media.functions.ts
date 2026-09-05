// ---------------------------------------------------------------------------
// Server functions pentru `media`, separate intenționat de media.ts.
//
// media.ts are `import { getDb } from "../db"` static la vârf, iar db.ts
// conține schema SQLite completă și hashing-ul de parole. Cât timp componente
// client importau server functions DIN media.ts, tot graful ajungea în
// bundle-ul public: /assets/db-*.js era servit cu 200 către orice browser
// (verificat — fără valori secrete din .env, care sunt înlocuite la build, dar
// cu schema și structura internă la vedere).
//
// Fișierul ăsta e subțire și fără importuri server statice: corpul unui
// handler de server function e eliminat din bundle-ul de client, deci
// `await import("./media")` de mai jos rămâne exclusiv pe server.
//
// Regulă generală: orice modul importat de componente client trebuie să nu
// aibă importuri statice server-only.
// ---------------------------------------------------------------------------

import { createServerFn } from "@tanstack/react-start";

// Doar tipuri — se șterg la compilare, nu trag nimic în bundle.
export type { LibraryTitleMatch, DownloadingMediaEntry } from "./media";
import type { LibraryTitleMatch, DownloadingMediaEntry } from "./media";

// Căutare de titluri deja existente în bibliotecă (rânduri-rădăcină, fără
// parent_id) — folosită la descărcarea manuală de pe Filelist.
export const searchLibraryTitles = createServerFn({ method: "GET" })
  .validator((data: { query: string }) => data)
  .handler(async ({ data }): Promise<LibraryTitleMatch[]> => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();
    const { searchLibraryTitlesCore } = await import("./media");
    return searchLibraryTitlesCore(data.query);
  });

// Ce e deja în curs de descărcare pentru un titlu (torrent pornit, dar încă
// neindexat de Plex) — folosit de wizard ca să blocheze acțiuni duplicate.
export const getDownloadingMediaForTmdbId = createServerFn({ method: "GET" })
  .validator((data: { tmdbId: number; mediaType: "movie" | "tv" }) => data)
  .handler(async ({ data }): Promise<DownloadingMediaEntry[]> => {
    const { requireAuth } = await import("../auth/admin.server");
    await requireAuth();
    const { getDownloadingMediaForTmdbIdCore } = await import("./media");
    return getDownloadingMediaForTmdbIdCore(data.tmdbId, data.mediaType);
  });
