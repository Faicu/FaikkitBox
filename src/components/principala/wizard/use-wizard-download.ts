// Acțiunile de descărcare ale wizard-ului: un torrent (film, episod sau sezon
// întreg) și urmărirea unui film care încă nu există la calitatea cerută.
//
// Scos din componentă la pasul 3 al refactorizării. Primește starea (citită,
// nu deținută) și `dispatch` — sursa de adevăr rămâne reducer-ul.

import type { Dispatch } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { downloadFilelist } from "@/lib/filelist.functions";
import type { FilelistTorrent } from "@/lib/filelist.functions";
import { listWantedMovies, setMovieWatch } from "@/lib/media/media.functions";
import type { WantedMovie } from "@/lib/media/media.functions";
import { normalizeStoredPoster } from "@/lib/tmdb/poster";
import type { WizardAction, WizardState } from "./state";

export function useWizardDownload({
  state,
  dispatch,
  isTv,
}: {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
  isTv: boolean;
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
      // Lista de căutare dă w92, potrivit pentru miniaturile ei; în `media`
      // salvăm mereu dimensiunea folosită la afișare mare.
      posterPath: normalizeStoredPoster(selected.posterUrl ?? null),
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
          // Lista de căutare dă w92, potrivit pentru miniaturile ei; în `media`
          // salvăm mereu dimensiunea folosită la afișare mare.
          posterPath: normalizeStoredPoster(selected.posterUrl ?? null),
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

  async function downloadOne(
    torrent: FilelistTorrent,
    opts: { season: number | null; episode: number | null; isSeasonPack: boolean },
  ) {
    dispatch({ type: "SET_BUSY", busy: true });
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
      if (res.status !== "ok") {
        toast.error("Eroare la descărcare", {
          id: toastId,
          description: res.error,
          duration: 8000,
        });
        return;
      }
      toast.success("Adăugat în qBittorrent!", {
        id: toastId,
        description: `${torrent.name} → ${res.savePath}`,
        duration: 6000,
      });
      // Biblioteca e preîncărcată și ținută în memorie (lib/prefetch.ts):
      // descărcarea nouă trebuie să apară în ea imediat, nu la următorul puls.
      queryClient.invalidateQueries({ queryKey: ["plexLibraryBrowse"] });
      dispatch({ type: "DONE", message: `„${torrent.name}” a fost adăugat în qBittorrent.` });
    } catch (e) {
      toast.error("Eroare neașteptată", {
        id: toastId,
        description: e instanceof Error ? e.message : String(e),
        duration: 8000,
      });
    } finally {
      dispatch({ type: "SET_BUSY", busy: false });
    }
  }

  return { downloadOne, toggleMovieWatch };
}
