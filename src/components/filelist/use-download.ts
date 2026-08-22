import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { downloadFilelist } from "@/lib/filelist.functions";
import type { FilelistTorrent } from "@/lib/filelist.functions";
import { parseSeasonEpisodeFromName } from "@/lib/media/torrent-name-parse";

// ---------------------------------------------------------------------------
// Hook reutilizabil pentru descărcare torrent
// ---------------------------------------------------------------------------

// Metadatele TMDB/bibliotecă ale titlului de legat, trimise o dată cu
// descărcarea, ca torrentul să apară direct în tabela `media` legat corect,
// fără nicio rezolvare automată ulterioară. Opțional, per apel: fără context
// (căutarea manuală brută din FilelistSection, fără titlu ales explicit),
// rămâne pe vechiul comportament — server-ul ghicește automat titlul din
// IMDb ID-ul torrentului (autoResolveManualMedia), care poate greși pentru
// torrente indexate pe Filelist sub ID-ul altei producții din franciză.
export interface DownloadMediaContext {
  mediaType: "movie" | "tv";
  imdbId: string | null;
  tmdbId: number | null;
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

export function useDownload() {
  const qc = useQueryClient();
  const downloadFn = useServerFn(downloadFilelist);
  const [downloading, setDownloading] = useState<number | null>(null);

  async function handleDownload(torrent: FilelistTorrent, mediaContext?: DownloadMediaContext) {
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
