// Ecranul de rezultat: ce s-a aflat despre titlu și ce poți face. Derivările
// stau aici — nu le folosește alt pas.

import { useState, type Dispatch } from "react";
import { CheckCircle2, Download, Info, Loader2, AlertTriangle, RefreshCw } from "lucide-react";

import { groupTorrentsBySeasonEpisode } from "@/components/filelist/quality-utils";
import type { FilelistTorrent } from "@/lib/filelist.functions";
import { Orb } from "@/components/ui/orb";
import { ActionButton, HdrHint, HdrQuestion, PosterHero, QualitySelector } from "./WizardControls";
import { SeasonAccordion } from "./SeasonAccordion";
import type { SeasonRowData } from "./SeasonAccordion";
import { deriveSeasonRows } from "./derive-seasons";
import {
  ONGOING_TV_STATUSES,
  tvStatusLabel,
  qualityDirection,
  bestOf,
  matchesForQuality,
  availableQualities,
  hdrVariantOf,
  pickFromSet,
  sdrVariantOf,
} from "./selection";
import { normalizeStoredPoster } from "@/lib/tmdb/poster";
import type { CheckResult, Quality, TorrentChoiceContext } from "./types";
import type { WizardAction, WizardState } from "./state";

export function ResultStep({
  state,
  dispatch,
  isAdmin,
  isTv,
  selected,
  checkResult,
  onRetry,
  onToggleWatch,
}: {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
  isAdmin: boolean;
  isTv: boolean;
  // Primite non-null de la shell, care verifică deja prezența lor.
  selected: NonNullable<WizardState["selected"]>;
  checkResult: CheckResult;
  onRetry: () => void;
  onToggleWatch: (enabled: boolean) => void;
}) {
  const {
    checkError,
    tmdbDetails,
    tvmazeAirstamps,
    seasonSchema,
    plexBySeason,
    downloadingEntries,
    wantedEntry,
    quality,
    busy,
  } = state;

  // „Urmărește” la o calitate HDR trece prin aceeași întrebare ca descărcarea —
  // altfel un fișier HDR ar ajunge în bibliotecă fără întrebare.
  const [askHdrWatch, setAskHdrWatch] = useState(false);
  const setQuality = (q: Quality) => {
    setAskHdrWatch(false);
    dispatch({ type: "SET_QUALITY", quality: q });
  };
  const sdrOfQuality = sdrVariantOf(quality);

  const seasonGroups = isTv ? groupTorrentsBySeasonEpisode(checkResult.torrents) : [];

  // Starea fiecărui episod, exact una: în Plex, în descărcare, lipsă și
  // descărcabil, lipsă și indisponibil, sau nelansat (cu dată). Fără dată
  // cunoscută, „indisponibil” — nu inventăm o dată.
  const seasonRows: SeasonRowData[] = isTv
    ? deriveSeasonRows({
        seasons: checkResult.seasons,
        seasonSchema,
        seasonGroups,
        plexBySeason,
        downloadingEntries,
        tvmazeAirstamps,
        quality,
      })
    : [];

  const movieAlreadyDownloading = !isTv && downloadingEntries.length > 0;
  const movieMatches = isTv ? [] : matchesForQuality(checkResult.torrents, quality, "movie");
  const movieMatch = bestOf(movieMatches);
  // Lipsă la calitatea aleasă, dar există la alta — indiciu pentru selector.
  const otherQualities =
    !isTv && !movieMatch ? availableQualities(checkResult.torrents, quality, "movie") : [];
  // Varianta HDR a rezoluției alese („1080p”, „4K” = fără HDR).
  const hdrSibling = hdrVariantOf(quality);
  const hdrMovieCount =
    !isTv && hdrSibling ? matchesForQuality(checkResult.torrents, hdrSibling, "movie").length : 0;
  // La seriale: sezoanele cu variantă HDR, fără cele deja întregi în Plex la ea.
  const hasHdrInPlex = (seasonNum: number) => {
    const eps = seasonRows.find((r) => r.seasonNumber === seasonNum)?.episodes ?? [];
    return (
      eps.length > 0 &&
      eps.every((e) => e.availability.kind === "in_plex" && e.availability.quality === hdrSibling)
    );
  };
  const hdrSeasons = hdrSibling
    ? seasonGroups
        .filter((g) => !hasHdrInPlex(g.seasonNum))
        .filter(
          (g) =>
            matchesForQuality(pickFromSet(g.byQuality, hdrSibling), hdrSibling, "tv").length > 0 ||
            [...g.episodes.values()].some(
              (set) => matchesForQuality(pickFromSet(set, hdrSibling), hdrSibling, "tv").length > 0,
            ),
        )
        .map((g) => g.seasonNum)
    : [];

  // La filme, „există în Plex” e suficient.
  const alreadyInPlex = !isTv && checkResult.plexFound;
  const plexQualities = checkResult.plexQualities;
  // Un film deja în Plex: o calitate nedeținută se oferă explicit, în ambele
  // sensuri (vezi qualityDirection).
  const direction = alreadyInPlex ? qualityDirection(plexQualities, quality) : null;

  // Confirmarea direct la un singur candidat (sau pentru non-admini); altfel
  // întâi alegerea manuală.
  function requestDownload(
    candidates: FilelistTorrent[],
    ctx: Omit<TorrentChoiceContext, "candidates">,
  ) {
    const best = bestOf(candidates);
    if (!best) return;
    if (!isAdmin || candidates.length === 1) {
      dispatch({
        type: "OPEN_CONFIRM",
        target: { torrent: best, ...ctx },
        back: { step: "result" },
      });
      return;
    }
    dispatch({ type: "OPEN_PICK", choice: { ...ctx, candidates }, pickedTorrentId: best.id });
  }

  function handleDownloadPack(season: SeasonRowData, torrents: FilelistTorrent[]) {
    requestDownload(torrents, {
      label: `Sezonul ${season.seasonNumber} (întreg)`,
      season: season.seasonNumber,
      isSeasonPack: true,
    });
  }

  function handleDownloadEpisode(
    season: SeasonRowData,
    episode: SeasonRowData["episodes"][number],
    torrents: FilelistTorrent[],
  ) {
    requestDownload(torrents, {
      label: `S${String(season.seasonNumber).padStart(2, "0")}E${String(episode.episodeNum).padStart(2, "0")}`,
      season: season.seasonNumber,
      episode: episode.episodeNum,
      isSeasonPack: false,
    });
  }

  return (
    <div className="animate-in fade-in slide-in-from-right-2 duration-200 space-y-4">
      <PosterHero
        // Posterul din căutare e w92 — aici se vede mult mai mare.
        posterUrl={normalizeStoredPoster(selected.posterUrl)}
        mediaType={selected.mediaType}
        title={selected.title}
        subtitle={checkResult.originalTitle + (selected.year ? ` · ${selected.year}` : "")}
      />

      {/* O verificare eșuată nu mai arată „nu există încă” (cu urmărirea
        oferită) — adevărul era că n-am reușit să întrebăm. */}
      {checkError ? (
        <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3">
          <div className="flex items-start gap-2 text-sm text-destructive-foreground">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
            <div className="space-y-1">
              <div className="font-medium">Verificarea a eșuat</div>
              <div className="text-xs text-muted-foreground break-words">{checkError}</div>
              <div className="text-xs text-muted-foreground">
                Nu știu ce există în Plex sau pe Filelist pentru titlul ăsta — nimic din ce-ar
                apărea mai jos n-ar fi de încredere.
              </div>
            </div>
          </div>
          <ActionButton
            busy={busy}
            icon={<RefreshCw className="h-4 w-4" />}
            label="Reîncearcă"
            onClick={onRetry}
          />
        </div>
      ) : isTv ? (
        <>
          {tmdbDetails?.tvStatus && ONGOING_TV_STATUSES.has(tmdbDetails.tvStatus) && (
            <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-xs text-amber-300">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                {tmdbDetails.nextEpisode
                  ? (() => {
                      const ne = tmdbDetails.nextEpisode;
                      const airstamp = tvmazeAirstamps.find(
                        (a) =>
                          a.seasonNumber === ne.seasonNumber && a.episodeNum === ne.episodeNumber,
                      )?.airstamp;
                      const dateLabel = new Date(airstamp ?? ne.airDate).toLocaleDateString(
                        "ro-RO",
                        {
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                          timeZone: "Europe/Bucharest",
                        },
                      );
                      const timeLabel = airstamp
                        ? new Date(airstamp).toLocaleTimeString("ro-RO", {
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: false,
                            timeZone: "Europe/Bucharest",
                          })
                        : null;
                      return `Episodul S${String(ne.seasonNumber).padStart(2, "0")}E${String(ne.episodeNumber).padStart(2, "0")} apare pe ${dateLabel}${timeLabel ? `, ora ${timeLabel}` : ""}.`;
                    })()
                  : `Serialul e reînnoit (${tvStatusLabel(tmdbDetails.tvStatus)}), dar fără dată anunțată încă pentru episoade noi.`}
              </span>
            </div>
          )}

          <QualitySelector quality={quality} onChange={setQuality} />

          {hdrSibling && hdrSeasons.length > 0 && (
            <HdrHint
              quality={hdrSibling}
              detail={
                hdrSeasons.length === 1
                  ? `sezonul ${hdrSeasons[0]}`
                  : `sezoanele ${hdrSeasons.join(", ")}`
              }
              busy={busy}
              onClick={() => setQuality(hdrSibling)}
            />
          )}

          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Sezoane
            </div>
            <SeasonAccordion
              seasons={seasonRows}
              busy={busy}
              onDownloadPack={handleDownloadPack}
              onDownloadEpisode={handleDownloadEpisode}
              onPickQuality={setQuality}
            />
          </div>
        </>
      ) : movieAlreadyDownloading ? (
        <div className="flex items-center gap-2 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-400">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          Filmul se descarcă deja — aștepți să apară în Plex înainte de orice altă acțiune.
        </div>
      ) : alreadyInPlex ? (
        <>
          <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Deja în bibliotecă Plex
            {plexQualities.length > 0 ? ` — ${plexQualities.join(", ")}` : ""}
          </div>

          {/* Selectorul rămâne: singurul motiv să stai aici e altă variantă
            decât cea din Plex. */}
          <QualitySelector quality={quality} onChange={setQuality} />

          {/* Nu și când varianta HDR e deja în bibliotecă. */}
          {hdrSibling && hdrMovieCount > 0 && !plexQualities.includes(hdrSibling) && (
            <HdrHint
              quality={hdrSibling}
              detail={`${hdrMovieCount}`}
              busy={busy}
              onClick={() => setQuality(hdrSibling)}
            />
          )}

          {/* Altfel, o calitate deja deținută lăsa un ecran mut, ca o eroare. */}
          {!direction && plexQualities.includes(quality) && (
            <div className="rounded-xl glass-card p-3 text-sm text-muted-foreground">
              {quality} e deja în bibliotecă. Alege altă calitate dacă vrei încă o variantă.
            </div>
          )}

          {direction &&
            (movieMatch ? (
              <>
                <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-xs text-amber-300">
                  <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>
                    Ai deja {plexQualities.join(", ")} în Plex. Descărcarea adaugă încă un fișier,
                    la {quality}
                    {direction === "downgrade" ? " (calitate mai mică)" : ""} — pe cele vechi le
                    ștergi tu, din Bibliotecă.
                  </span>
                </div>
                <ActionButton
                  busy={busy}
                  icon={<Download className="h-4 w-4" />}
                  label={`Descarcă varianta ${quality}`}
                  onClick={() =>
                    requestDownload(movieMatches, {
                      // Explicit: label-ul ajunge în jurnal — peste o lună vrei
                      // să știi de ce ai două fișiere și în ce sens.
                      label: `Film — ${direction} la ${quality}`,
                      isSeasonPack: false,
                    })
                  }
                />
              </>
            ) : (
              <div className="rounded-xl glass-card p-3 text-sm text-muted-foreground">
                Nu există {quality} pe Filelist pentru titlul ăsta.
              </div>
            ))}
        </>
      ) : (
        <>
          {/* Deasupra selectorului: un film urmărit rămâne urmărit și când
              apare un torrent — vrei și bannerul, și butonul. */}
          {wantedEntry && (
            <div className="space-y-2 rounded-xl bg-violet-500/10 p-3">
              <div className="flex items-center gap-2 text-sm text-violet-300">
                <Orb state="searching" px={16} />
                Se așteaptă la {wantedEntry.quality} — se verifică din 12 în 12 ore.
              </div>
              {/* Oprirea: doar proprietarul sau un admin. */}
              {wantedEntry.canManage && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onToggleWatch(false)}
                  className="rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 disabled:opacity-40"
                >
                  Oprește urmărirea
                </button>
              )}
            </div>
          )}

          <QualitySelector quality={quality} onChange={setQuality} />

          {movieMatch ? (
            <>
              {hdrSibling && hdrMovieCount > 0 && (
                <HdrHint
                  quality={hdrSibling}
                  detail={`${hdrMovieCount}`}
                  busy={busy}
                  onClick={() => setQuality(hdrSibling)}
                />
              )}
              <ActionButton
                busy={busy}
                icon={<Download className="h-4 w-4" />}
                label="Descarcă acum"
                onClick={() =>
                  requestDownload(movieMatches, { label: "Film", isSeasonPack: false })
                }
              />
            </>
          ) : (
            <div className="space-y-3 rounded-xl glass-card p-3">
              <div className="text-sm text-muted-foreground">
                Nu există încă la calitatea {quality} pe Filelist.
              </div>
              {otherQualities.length > 0 && (
                <div className="space-y-2">
                  <div className="text-sm">Dar e disponibil la:</div>
                  <div className="flex flex-wrap gap-2">
                    {otherQualities.map((q) => (
                      <button
                        key={q}
                        type="button"
                        disabled={busy}
                        onClick={() => setQuality(q)}
                        className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-40"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {/* Deschis oricui e logat: un film așteptat nu ocupă nimic până
                  apare. */}
              {!wantedEntry &&
                (askHdrWatch && sdrOfQuality ? (
                  <HdrQuestion
                    quality={quality}
                    sdrQuality={sdrOfQuality}
                    yesLabel="Da, urmărește"
                    busy={busy}
                    onYes={() => {
                      setAskHdrWatch(false);
                      onToggleWatch(true);
                    }}
                    onNo={() => setQuality(sdrOfQuality)}
                  />
                ) : (
                  <ActionButton
                    busy={busy}
                    icon={<Orb state="searching" px={16} />}
                    label="Urmărește — descarcă automat când apare"
                    onClick={() => (sdrOfQuality ? setAskHdrWatch(true) : onToggleWatch(true))}
                  />
                ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
