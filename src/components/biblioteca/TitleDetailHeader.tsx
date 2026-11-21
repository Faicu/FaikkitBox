import { Captions, CaptionsOff, Clock3, ExternalLink, Film, Flag, Tv } from "lucide-react";

import { DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { Progress } from "@/components/ui/progress";
import type { PlexTitleDetail } from "@/lib/services/plex-title-detail";
import { formatMs, formatSpeed, formatEta, sqliteUtcMs } from "@/lib/format";
import { StatusBadge } from "./StatusBadge";
import { SubtitleRetryLine } from "./TitleDetailParts";
import { airDateLabel, displayEpisodeTitle, episodeCode } from "./utils";

// Peste prag, „Se procesează” nu mai e o scanare Plex în curs (legarea reușește
// de obicei în primul minut).
const PROCESSING_HINT_AFTER_MS = 30 * 60 * 1000;

// Antetul fix al fișei: posterul cu tot ce descrie titlul, apoi starea
// temporară (descărcare/indexare). `d` e null cât se încarcă.
export function TitleDetailHeader({ detail: d }: { detail: PlexTitleDetail | null }) {
  const airedOn = d?.type === "episode" ? airDateLabel(d.airDate) : null;

  return (
    <>
      {/* Tot ce descrie titlul stă lângă poster, ca antetul fix să fie mic;
        dedesubt, doar starea temporară (descărcare/indexare). */}
      <div className="flex items-start gap-3">
        {d?.thumbUrl && (
          <img
            src={d.thumbUrl}
            className="h-[104px] w-[72px] shrink-0 rounded-lg object-cover bg-muted"
            loading="lazy"
            alt=""
          />
        )}
        <div className="min-w-0 flex-1">
          <DrawerTitle className="flex items-center gap-2 text-base leading-snug">
            {d?.type === "movie" ? (
              <Film className="h-4 w-4 text-amber-400 shrink-0" />
            ) : (
              <Tv className="h-4 w-4 text-blue-400 shrink-0" />
            )}
            {d ? (d.type === "movie" ? d.title : (d.show ?? d.title)) : "Se încarcă…"}
          </DrawerTitle>
          {d?.type === "episode" && (
            <DrawerDescription className="text-left text-sm font-medium text-foreground leading-snug mt-0.5">
              {episodeCode(d.season, d.episode) ?? ""}
              {displayEpisodeTitle(d.title) ? ` · ${d.title}` : ""}
            </DrawerDescription>
          )}
          {/* Titlul original, anul și IMDb — „care titlu e ăsta”. La episod,
            anul și IMDb sunt ale serialului; genurile există doar la serial.
            Episodul arată data difuzării. */}
          {d && (
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px]">
              {d.secondaryTitle && (
                // pr-1: `truncate` ar tăia aplecarea ultimei litere italice.
                <span className="min-w-0 truncate pr-1 text-xs text-muted-foreground italic">
                  {d.secondaryTitle}
                </span>
              )}
              {airedOn && (
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 font-medium text-muted-foreground">
                  {airedOn}
                </span>
              )}
              {d.type !== "episode" && d.year && (
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 font-medium text-muted-foreground">
                  {d.year}
                </span>
              )}
              {d.type !== "episode" && d.imdbId && (
                <a
                  href={`https://www.imdb.com/title/${d.imdbId}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 font-medium text-foreground hover:bg-muted/70 transition-colors"
                >
                  <ExternalLink className="h-3 w-3" /> IMDb
                </a>
              )}
              {/* Ține de FIȘIER (film, episod, pachet), nu de serial; doar
                descărcările noi au ID-ul. Un .torrent adăugat de mână are
                link-ul salvat și numele sursei. */}
              {d.type !== "tv_show" && (d.source || d.filelistId != null) && (
                <a
                  href={d.source?.url ?? `https://filelist.io/details.php?id=${d.filelistId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 font-medium text-foreground hover:bg-muted/70 transition-colors"
                >
                  <ExternalLink className="h-3 w-3" /> {d.source?.name ?? "Filelist"}
                </a>
              )}
            </div>
          )}
          {d && (d.type !== "tv_show" || d.durationMs > 0) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px]">
              {/* Calitatea, audio/subtitrarea și durata sunt ale unui FIȘIER —
                pe 'tv_show' sunt goale prin construcție, deci se arată per
                episod. */}
              {d.type !== "tv_show" && d.quality && (
                <span className="rounded-full bg-amber-500/15 text-amber-400 px-1.5 py-0.5 font-medium">
                  {d.quality}
                </span>
              )}
              {d.type === "tv_show" ? null : d.hasRomanianAudio ? (
                <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 font-medium">
                  <Flag className="h-3 w-3" />
                  Românesc
                </span>
              ) : (
                // Cât se descarcă, subtitrarea nu e încă verificată — o insignă
                // „doar engleză” ar fi falsă.
                d.status !== "downloading" &&
                (d.subtitleApproximate ? (
                  <span
                    title="Sincronizarea nu e sigură"
                    className="flex items-center gap-1 rounded-full bg-amber-500/15 text-amber-400 px-1.5 py-0.5 font-medium"
                  >
                    <Captions className="h-3 w-3" />
                    Subtitrare aproximativă
                  </span>
                ) : d.hasRomanianSubtitle ? (
                  <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 font-medium">
                    <Captions className="h-3 w-3" />
                    Subtitrare RO
                  </span>
                ) : (
                  <span
                    title="Fără subtitrare RO"
                    className="flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 font-medium text-muted-foreground"
                  >
                    <CaptionsOff className="h-3 w-3" />
                    Doar engleză
                  </span>
                ))
              )}
              {d.durationMs > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 font-medium text-muted-foreground">
                  <Clock3 className="h-3 w-3" /> {formatMs(d.durationMs)}
                </span>
              )}
            </div>
          )}
          {/* Reîncercarea zilnică a subtitrării: în căutare până când, sau
            încheiată. */}
          {d && d.subtitleRetry && d.status !== "downloading" && (
            <SubtitleRetryLine retry={d.subtitleRetry} />
          )}
          {/* Text simplu, nu pastile: informație secundară. */}
          {d && d.type !== "episode" && d.genres.length > 0 && (
            <div className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
              {d.genres.join(" · ")}
            </div>
          )}
        </div>
      </div>
      {d && d.status !== "in_library" && (
        <div className="mt-2 space-y-2">
          <div className="flex text-xs">
            <StatusBadge status={d.status} progress={d.progress} />
          </div>

          {d.status === "downloading" && d.progress != null && (
            <div>
              <Progress value={d.progress} />
              <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{d.progress.toFixed(1)}%</span>
                <span>
                  {d.dlspeed != null && formatSpeed(d.dlspeed)}
                  {d.eta != null && ` · rămas ${formatEta(d.eta)}`}
                </span>
              </div>
            </div>
          )}

          {d.status === "processing" && (
            <div className="text-[11px] text-muted-foreground">
              {/* Plex poate potrivi fișierul la alt titlu („S.W.A.T. Exiles” →
                „S.W.A.T.” 2017). Doar pentru admin, singurul care poate face
                Fix Match. */}
              {d.tech?.completedAt &&
              Date.now() - sqliteUtcMs(d.tech.completedAt) > PROCESSING_HINT_AFTER_MS
                ? "Durează mai mult decât de obicei. Verifică în Plex dacă titlul a fost recunoscut corect — dacă nu, ⋯ → Fix Match → alege titlul corect. Se leagă automat după aceea."
                : "Fișierul e descărcat complet — aștept ca Plex să îl indexeze."}
            </div>
          )}
        </div>
      )}
    </>
  );
}
