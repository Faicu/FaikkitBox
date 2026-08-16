import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Download,
  Loader2,
  Clock3,
  XCircle,
} from "lucide-react";

import type { FilelistTorrent } from "@/lib/filelist.functions";

// ---------------------------------------------------------------------------
// Disponibilitatea unui episod — exact cele 4 stări cerute: deja în Plex,
// lipsă+descărcabil, lipsă+indisponibil pe Filelist, nelansat încă (cu dată,
// dacă TMDB o are stabilită — un episod fără dată anunțată e tratat ca
// "indisponibil", nu ca "nelansat", ca să nu inventăm o dată care nu există).
// ---------------------------------------------------------------------------

export type EpisodeAvailability =
  | { kind: "in_plex"; quality: string | null }
  | { kind: "episode_torrent"; torrent: FilelistTorrent }
  | { kind: "pack_only" }
  | { kind: "unavailable" }
  | { kind: "upcoming"; airDate: string | null };

export interface SeasonRowData {
  seasonNumber: number;
  packTorrent: FilelistTorrent | null;
  episodes: Array<{
    episodeNum: number;
    title: string;
    availability: EpisodeAvailability;
  }>;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ro-RO", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Bucharest",
  });
}

// Badge-ul agregat de pe rândul de sezon închis.
function seasonBadge(season: SeasonRowData): { tone: string; label: string } {
  const eps = season.episodes;
  if (eps.length === 0) return { tone: "gray", label: "—" };
  const allInPlex = eps.every((e) => e.availability.kind === "in_plex");
  if (allInPlex) return { tone: "green", label: "Complet în Plex" };
  const anyInPlex = eps.some((e) => e.availability.kind === "in_plex");
  const allUpcoming = eps.every((e) => e.availability.kind === "upcoming");
  if (allUpcoming) {
    const firstDate = eps.find((e) => e.availability.kind === "upcoming" && e.availability.airDate);
    const dateLabel =
      firstDate?.availability.kind === "upcoming" && firstDate.availability.airDate
        ? fmtDate(firstDate.availability.airDate)
        : null;
    return { tone: "amber", label: dateLabel ? `Nelansat — ${dateLabel}` : "Nelansat încă" };
  }
  const anyAvailable =
    !!season.packTorrent || eps.some((e) => e.availability.kind === "episode_torrent");
  if (anyAvailable) {
    return { tone: "blue", label: anyInPlex ? "Parțial în Plex, restul disponibil" : "Disponibil" };
  }
  return { tone: "gray", label: anyInPlex ? "Parțial în Plex" : "Indisponibil" };
}

const TONE_CLASSES: Record<string, string> = {
  green: "bg-emerald-500/15 text-emerald-400",
  blue: "bg-sky-500/15 text-sky-400",
  gray: "bg-muted text-muted-foreground",
  amber: "bg-amber-500/15 text-amber-400",
};

function EpisodeRow({
  episode,
  busy,
  downloadingTorrentId,
  onDownloadEpisode,
}: {
  episode: SeasonRowData["episodes"][number];
  busy: boolean;
  downloadingTorrentId: number | null;
  onDownloadEpisode: (torrent: FilelistTorrent) => void;
}) {
  const { availability } = episode;
  const epLabel = `E${String(episode.episodeNum).padStart(2, "0")}`;

  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="w-9 shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
        {epLabel}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs">{episode.title}</span>
      {availability.kind === "in_plex" && (
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
          <CheckCircle2 className="h-2.5 w-2.5" /> {availability.quality ?? "În Plex"}
        </span>
      )}
      {availability.kind === "episode_torrent" && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onDownloadEpisode(availability.torrent)}
          className="flex shrink-0 items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium text-sky-400 hover:bg-sky-500/25 disabled:opacity-50"
        >
          {downloadingTorrentId === availability.torrent.id ? (
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
          ) : (
            <Download className="h-2.5 w-2.5" />
          )}
          Descarcă
        </button>
      )}
      {availability.kind === "pack_only" && (
        <span
          className="shrink-0 rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-400/80"
          title="Disponibil doar ca parte din pachetul de sezon — nu se poate descărca separat."
        >
          doar ca pachet
        </span>
      )}
      {availability.kind === "unavailable" && (
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          <XCircle className="h-2.5 w-2.5" /> Indisponibil
        </span>
      )}
      {availability.kind === "upcoming" && (
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
          <Clock3 className="h-2.5 w-2.5" />
          {availability.airDate ? fmtDate(availability.airDate) : "Nelansat"}
        </span>
      )}
    </div>
  );
}

function SeasonRow({
  season,
  busy,
  downloadingTorrentId,
  onDownloadPack,
  onDownloadEpisode,
}: {
  season: SeasonRowData;
  busy: boolean;
  downloadingTorrentId: number | null;
  onDownloadPack: (torrent: FilelistTorrent) => void;
  onDownloadEpisode: (torrent: FilelistTorrent) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const badge = seasonBadge(season);
  const hasPack = !!season.packTorrent;

  return (
    <div className="rounded-xl border border-border/60 overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm font-medium hover:bg-muted/50 transition-colors"
      >
        <span>
          Sezon {String(season.seasonNumber).padStart(2, "0")}
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
            ({season.episodes.length} ep)
          </span>
        </span>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${TONE_CLASSES[badge.tone]}`}
          >
            {badge.label}
          </span>
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {isOpen && (
        <div className="border-t border-border/60 px-3 py-2">
          {hasPack && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onDownloadPack(season.packTorrent!)}
              className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              {downloadingTorrentId === season.packTorrent!.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              Descarcă pachetul sezonului
            </button>
          )}
          <div className="divide-y divide-border/40">
            {season.episodes.map((ep) => (
              <EpisodeRow
                key={ep.episodeNum}
                episode={ep}
                busy={busy}
                downloadingTorrentId={downloadingTorrentId}
                onDownloadEpisode={onDownloadEpisode}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function SeasonAccordion({
  seasons,
  busy,
  downloadingTorrentId,
  onDownloadPack,
  onDownloadEpisode,
}: {
  seasons: SeasonRowData[];
  busy: boolean;
  downloadingTorrentId: number | null;
  onDownloadPack: (season: SeasonRowData, torrent: FilelistTorrent) => void;
  onDownloadEpisode: (
    season: SeasonRowData,
    episode: SeasonRowData["episodes"][number],
    torrent: FilelistTorrent,
  ) => void;
}) {
  return (
    <div className="space-y-1.5">
      {seasons.map((season) => (
        <SeasonRow
          key={season.seasonNumber}
          season={season}
          busy={busy}
          downloadingTorrentId={downloadingTorrentId}
          onDownloadPack={(t) => onDownloadPack(season, t)}
          onDownloadEpisode={(t) => {
            const ep = season.episodes.find(
              (e) =>
                e.availability.kind === "episode_torrent" && e.availability.torrent.id === t.id,
            );
            if (ep) onDownloadEpisode(season, ep, t);
          }}
        />
      ))}
    </div>
  );
}
