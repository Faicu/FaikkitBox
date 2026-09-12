// Acțiunile de descărcare ale wizard-ului: un torrent, un lot, și urmărirea
// unui film care încă nu există la calitatea cerută.
//
// Scos din componentă la pasul 3 al refactorizării. Primește starea (citită,
// nu deținută) și `dispatch` — sursa de adevăr rămâne reducer-ul.

import type { Dispatch, RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { downloadFilelist } from "@/lib/filelist.functions";
import type { FilelistTorrent } from "@/lib/filelist.functions";
import { listWantedMovies, setMovieWatch } from "@/lib/media/media.functions";
import type { WantedMovie } from "@/lib/media/media.functions";
import type { BulkDownloadItem } from "./types";
import type { WizardAction, WizardState } from "./state";

export function useWizardDownload({
  state,
  dispatch,
  isTv,
  cancelBulkRef,
}: {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
  isTv: boolean;
  cancelBulkRef: RefObject<boolean>;
}) {
  const queryClient = useQueryClient();
  const downloadFn = useServerFn(downloadFilelist);
  const setMovieWatchFn = useServerFn(setMovieWatch);
  const wantedFn = useServerFn(listWantedMovies);

  const { selected, checkResult, tmdbDetails, quality } = state;

  // Metadatele TMDB deja cunoscute (titlu, gen, rezumat RO, imdb/tmdb id) —
  // trimise o dată cu descărcarea, ca torrentul să apară direct în tabela
  // `media` fără nicio căutare TMDB ulterioară (vezi Bibliotecă).
  function buildMediaPayload(opts: {
    season: number | null;
    episode: number | null;
    isSeasonPack: boolean;
  }) {
    if (!selected || !checkResult) return undefined;
    const parsedYear = selected.year ? Number(selected.year) : NaN;
    return {
      mediaType: (isTv ? "episode" : "movie") as "episode" | "movie",
      imdbId: checkResult.imdbId,
      tmdbId: selected.id,
      title: selected.title,
      originalTitle: checkResult.originalTitle,
      literalTitle: tmdbDetails?.literalTitle ?? null,
      year: Number.isFinite(parsedYear) ? parsedYear : null,
      season: isTv ? opts.season : null,
      episode: isTv ? opts.episode : null,
      overviewRo: tmdbDetails?.overview ?? null,
      genres: tmdbDetails?.genres ?? [],
      posterPath: selected.posterUrl ?? null,
      tvStatus: tmdbDetails?.tvStatus ?? null,
      isSeasonPack: opts.isSeasonPack,
      addedVia: "wizard" as const,
    };
  }

  // Urmărirea unui film care încă nu există pe Filelist la calitatea cerută.
  // Nu închide wizard-ul: rămâi pe același ecran, care se transformă în
  // bannerul „se așteaptă", ca să vezi imediat că s-a înregistrat.
  async function toggleMovieWatch(enabled: boolean) {
    if (!selected || !checkResult) return;
    dispatch({ type: "SET_BUSY", busy: true });
    try {
      const parsedYear = selected.year ? Number(selected.year) : NaN;
      const res = await setMovieWatchFn({
        data: {
          tmdbId: selected.id,
          enabled,
          quality,
          imdbId: checkResult.imdbId,
          title: selected.title,
          originalTitle: checkResult.originalTitle,
          literalTitle: tmdbDetails?.literalTitle ?? null,
          year: Number.isFinite(parsedYear) ? parsedYear : null,
          posterPath: selected.posterUrl ?? null,
          overviewRo: tmdbDetails?.overview ?? null,
          genres: tmdbDetails?.genres ?? [],
        },
      }).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));

      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const fresh = await wantedFn().catch(() => [] as WantedMovie[]);
      dispatch({ type: "SET_WANTED", wanted: fresh.find((w) => w.tmdbId === selected.id) ?? null });
      // Biblioteca arată secțiunea „Se așteaptă", deci trebuie să afle.
      queryClient.invalidateQueries({ queryKey: ["wanted-movies"] });
      toast.success(enabled ? `Urmărești „${selected.title}”` : "Urmărire oprită");
    } finally {
      dispatch({ type: "SET_BUSY", busy: false });
    }
  }

  // Nu atinge `busy` — apelantul îl deține. downloadBulk cheamă funcția asta
  // în serie, iar cât timp ea își făcea singură dispatch({ type: "SET_BUSY", busy: true })/finally
  // dispatch({ type: "SET_BUSY", busy: false }), primul element terminat deblocheze tot wizard-ul în
  // mijlocul lotului: butoanele redeveneau active și dialogul se putea
  // închide (`onOpenChange` se uită tot la `busy`), deși restul descărcărilor
  // încă porneau una câte una.
  async function downloadNow(
    torrent: FilelistTorrent,
    opts: { season: number | null; episode: number | null; isSeasonPack: boolean },
  ) {
    dispatch({ type: "SET_DOWNLOADING_TORRENT", torrentId: torrent.id });
    const toastId = toast.loading(`Se descarcă: ${torrent.name}…`);
    try {
      const res = await downloadFn({
        data: {
          torrentId: torrent.id,
          torrentName: torrent.name,
          categoryId: torrent.category,
          categoryName: torrent.categoryName,
          size: torrent.size,
          freeleech: torrent.freeleech,
          internal: torrent.internal,
          imdb: torrent.imdb,
          media: buildMediaPayload(opts),
        },
      });
      if (res.status === "ok") {
        toast.success("Adăugat în qBittorrent!", {
          id: toastId,
          description: `${torrent.name} → ${res.savePath}`,
          duration: 6000,
        });
        queryClient.invalidateQueries({ queryKey: ["filelistLog"] });
        return true;
      }
      toast.error("Eroare la descărcare", { id: toastId, description: res.error, duration: 8000 });
      return false;
    } catch (e) {
      toast.error("Eroare neașteptată", {
        id: toastId,
        description: e instanceof Error ? e.message : String(e),
        duration: 8000,
      });
      return false;
    } finally {
      dispatch({ type: "SET_DOWNLOADING_TORRENT", torrentId: null });
    }
  }

  async function downloadOne(
    torrent: FilelistTorrent,
    opts: { season: number | null; episode: number | null; isSeasonPack: boolean },
  ) {
    dispatch({ type: "SET_BUSY", busy: true });
    try {
      if (await downloadNow(torrent, opts)) {
        dispatch({ type: "DONE", message: `„${torrent.name}” a fost adăugat în qBittorrent.` });
      }
    } finally {
      dispatch({ type: "SET_BUSY", busy: false });
    }
  }

  // "Descarcă tot ce lipsește" — pornește în serie (nu paralel, ca să nu
  // suprasolicităm qBittorrent/autentificarea) fiecare element din plan:
  // pachet de sezon acolo unde există, altfel fiecare episod individual găsit
  // (vezi computeBulkPlan) — nimic din ce e disponibil nu rămâne pe dinafară.
  async function downloadBulk(items: BulkDownloadItem[]) {
    dispatch({ type: "SET_BUSY", busy: true });
    cancelBulkRef.current = false;
    dispatch({ type: "SET_BULK_PROGRESS", progress: { done: 0, total: items.length } });
    let okCount = 0;
    let stopped = false;
    try {
      for (const item of items) {
        // Verificat ÎNTRE elemente, nu în timpul unuia: o descărcare deja
        // trimisă la qBittorrent nu mai poate fi retrasă, deci "oprește"
        // înseamnă cinstit "nu mai porni altele".
        if (cancelBulkRef.current) {
          stopped = true;
          break;
        }
        const success = await downloadNow(item.torrent, {
          season: item.season,
          episode: item.episode ?? null,
          isSeasonPack: item.isSeasonPack,
        });
        if (success) okCount++;
        dispatch({ type: "SET_BULK_PROGRESS", progress: { done: okCount, total: items.length } });
      }
    } finally {
      // finally, ca o excepție neprevăzută să nu lase wizard-ul blocat pe
      // "busy" la nesfârșit, fără nicio cale de închidere.
      dispatch({ type: "SET_BUSY", busy: false });
      dispatch({ type: "SET_BULK_PROGRESS", progress: null });
      cancelBulkRef.current = false;
    }
    if (okCount > 0) {
      const suffix = stopped ? " (oprit la cerere)" : "";
      toast.success(`${okCount}/${items.length} descărcări adăugate în qBittorrent${suffix}`);
      dispatch({
        type: "DONE",
        message: `${okCount}/${items.length} descărcări adăugate în qBittorrent${suffix}.`,
      });
      return;
    }
    // Oprit înainte să pornească ceva (sau toate au eșuat) — nu are sens un
    // ecran "gata" care nu anunță nimic; ne întoarcem de unde am plecat.
    dispatch({ type: "BACK" });
  }

  return { downloadNow, downloadOne, downloadBulk, toggleMovieWatch };
}
