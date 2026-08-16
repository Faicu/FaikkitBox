import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { downloadFilelist } from "@/lib/filelist.functions";
import type { FilelistTorrent } from "@/lib/filelist.functions";
import { parseSeasonEpisodeFromName } from "@/lib/torrent-name-parse";

// ---------------------------------------------------------------------------
// Hook reutilizabil pentru descărcare torrent
// ---------------------------------------------------------------------------

// Metadatele TMDB deja cunoscute de card (MovieCard/ShowCard au deja `item` +
// `details` încărcate pentru orice titlu fixat) — trimise o dată cu
// descărcarea, ca torrentul să apară direct în tabela `media`, la fel ca la
// wizard, fără nicio căutare TMDB suplimentară. Opțional: fără context (ex.
// căutarea manuală brută din FilelistSection, fără legătură TMDB), rămâne pe
// vechiul comportament — doar `downloads`, fără `media`.
export interface DownloadMediaContext {
  mediaType: "movie" | "tv";
  imdbId: string | null;
  tmdbId: number;
  title: string;
  originalTitle?: string | null;
  literalTitle?: string | null;
  year?: number | null;
  overviewRo?: string | null;
  genres?: string[];
  posterUrl?: string | null;
  tvStatus?: string | null;
}

function buildMediaPayload(context: DownloadMediaContext, torrent: FilelistTorrent) {
  const isTv = context.mediaType === "tv";
  const parsed = isTv ? parseSeasonEpisodeFromName(torrent.name) : null;
  return {
    mediaType: (isTv ? "episode" : "movie") as "episode" | "movie",
    imdbId: context.imdbId,
    tmdbId: context.tmdbId,
    title: context.title,
    originalTitle: context.originalTitle ?? null,
    literalTitle: context.literalTitle ?? null,
    year: context.year ?? null,
    season: isTv ? (parsed?.season ?? null) : null,
    episode: isTv ? (parsed?.episode ?? null) : null,
    overviewRo: context.overviewRo ?? null,
    genres: context.genres ?? [],
    posterPath: context.posterUrl ?? null,
    tvStatus: isTv ? (context.tvStatus ?? null) : null,
    isSeasonPack: isTv && !!parsed && parsed.episode === null,
    addedVia: "manual" as const,
  };
}

export function useDownload(mediaContext?: DownloadMediaContext) {
  const qc = useQueryClient();
  const downloadFn = useServerFn(downloadFilelist);
  const [downloading, setDownloading] = useState<number | null>(null);

  async function handleDownload(torrent: FilelistTorrent) {
    setDownloading(torrent.id);
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
          media: mediaContext ? buildMediaPayload(mediaContext, torrent) : undefined,
        },
      });
      if (res.status === "ok") {
        toast.success("Adăugat în qBittorrent!", {
          id: toastId,
          description: `${torrent.name} → ${res.savePath}`,
          duration: 6000,
        });
        qc.invalidateQueries({ queryKey: ["filelistLog"] });
      } else {
        toast.error("Eroare la descărcare", {
          id: toastId,
          description: res.error,
          duration: 8000,
        });
      }
    } catch (e) {
      toast.error("Eroare neașteptată", {
        id: toastId,
        description: e instanceof Error ? e.message : String(e),
        duration: 8000,
      });
    } finally {
      setDownloading(null);
    }
  }

  return { downloading, handleDownload };
}
