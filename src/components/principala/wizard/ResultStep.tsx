// Ecranul de rezultat: ce s-a aflat despre titlu și ce poți face cu el.
//
// Cel mai mare pas al wizard-ului, și singurul care are logică derivată
// proprie — de-aia derivările stau aici, nu în shell: nimic din ele nu e
// folosit de ceilalți pași.

import type { Dispatch } from "react";
import { CheckCircle2, Download, Info, Loader2, AlertTriangle, RefreshCw } from "lucide-react";

import { groupTorrentsBySeasonEpisode } from "@/components/filelist/quality-utils";
import type { FilelistTorrent } from "@/lib/filelist.functions";
import { Orb } from "@/components/ui/orb";
import { ActionButton, TorrentPicker, PosterHero, QualitySelector } from "./WizardControls";
import { SeasonAccordion } from "./SeasonAccordion";
import type { SeasonRowData } from "./SeasonAccordion";
import { deriveSeasonRows, deriveBulkPlan } from "./derive-seasons";
import {
  ONGOING_TV_STATUSES,
  tvStatusLabel,
  qualityRank,
  bestOf,
  matchesForQuality,
} from "./selection";
import type { CheckResult, TorrentChoiceContext } from "./types";
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
  // Primite îngustate (non-null) de shell, care oricum verifică prezența lor
  // înainte de a randa pasul — aici ar fi doar zgomot de verificări repetate.
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
    pickedTorrentId,
    busy,
    downloadingTorrentId,
  } = state;

  const seasonGroups = checkResult ? groupTorrentsBySeasonEpisode(checkResult.torrents) : [];

  // Schema per-sezon afișată în accordion: pentru fiecare episod, exact una
  // din stările posibile — deja în Plex, deja în curs de descărcare, lipsă+
  // descărcabil, lipsă+indisponibil, sau nelansat încă (cu dată, dacă TMDB o
  // are stabilită; fără dată cunoscută, tratăm episodul ca "indisponibil",
  // nu ca "nelansat" — nu inventăm o dată care nu există).
  const seasonRows: SeasonRowData[] =
    isTv && checkResult
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

  const bulkPlan = deriveBulkPlan(seasonRows);

  const movieAlreadyDownloading = !isTv && downloadingEntries.length > 0;
  const movieMatches = !isTv && checkResult ? matchesForQuality(checkResult.torrents, quality) : [];
  const movieMatch = movieMatches.find((t) => t.id === pickedTorrentId) ?? bestOf(movieMatches);

  // Pentru filme, "există în Plex" e suficient (verificare atomică).
  const alreadyInPlex = !isTv && !!checkResult?.plexFound;
  // Un film deja în Plex nu mai e fundătură: dacă alegi o calitate superioară
  // celei existente, îți oferim explicit upgrade-ul. Comparația e strict "mai
  // mare" — la calitate egală sau necunoscută nu propunem nimic, ca să nu
  // producem duplicate dintr-o ghiceală (vezi qualityRank).
  const plexQualityRank = qualityRank(checkResult?.plexQuality ?? null);
  const isQualityUpgrade = alreadyInPlex && qualityRank(quality) > plexQualityRank;
  const showQualityAndAction = !isTv && !!checkResult && !alreadyInPlex && !movieAlreadyDownloading;

  // Deschide direct confirmarea când există un singur candidat (sau userul
  // nu e admin — doar adminul poate alege manual), altfel arată mai întâi
  // alegerea de torrent.
  function requestDownload(
    candidates: FilelistTorrent[],
    ctx: Omit<TorrentChoiceContext, "candidates">,
  ) {
    if (!isAdmin || candidates.length <= 1) {
      const torrent = bestOf(candidates);
      if (!torrent) return;
      dispatch({
        type: "OPEN_CONFIRM",
        target: { kind: "single", torrent, ...ctx },
        back: { step: "result" },
      });
      return;
    }
    dispatch({
      type: "OPEN_PICK",
      choice: { ...ctx, candidates },
      pickedTorrentId: bestOf(candidates)!.id,
    });
  }

  function handleDownloadPack(season: SeasonRowData, torrents: FilelistTorrent[]) {
    requestDownload(torrents, {
      label: `Sezonul ${season.seasonNumber} (pachet)`,
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
        posterUrl={selected.posterUrl}
        mediaType={selected.mediaType}
        title={selected.title}
        subtitle={checkResult.originalTitle + (selected.year ? ` · ${selected.year}` : "")}
      />

      {/* O verificare eșuată producea până acum un `checkResult`
        gol, indistinct de un rezultat real gol: ecranul spunea
        „nu există încă la calitatea X pe Filelist" și îți oferea
        urmărirea, deși adevărul era că n-am reușit să întrebăm.
        Toastul de eroare dispărea, minciuna rămânea. */}
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

          <QualitySelector
            quality={quality}
            onChange={(q) => dispatch({ type: "SET_QUALITY", quality: q })}
            isAdmin={isAdmin}
          />

          {bulkPlan.length > 0 && (
            <ActionButton
              busy={busy}
              icon={<Download className="h-4 w-4" />}
              label={`Descarcă tot ce lipsește (${bulkPlan.length})`}
              onClick={() => {
                dispatch({
                  type: "OPEN_CONFIRM",
                  target: { kind: "bulk", items: bulkPlan },
                  back: { step: "result" },
                });
              }}
            />
          )}

          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Sezoane
            </div>
            <SeasonAccordion
              seasons={seasonRows}
              busy={busy}
              downloadingTorrentId={downloadingTorrentId}
              onDownloadPack={handleDownloadPack}
              onDownloadEpisode={handleDownloadEpisode}
            />
          </div>
        </>
      ) : alreadyInPlex ? (
        <>
          <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Deja în bibliotecă Plex
            {checkResult.plexQuality ? ` — ${checkResult.plexQuality}` : ""}
          </div>

          {/* Selectorul rămâne disponibil: singurul motiv să mai
            stai pe ecranul ăsta e să iei o variantă mai bună
            decât cea din Plex. */}
          <QualitySelector
            quality={quality}
            onChange={(q) => dispatch({ type: "SET_QUALITY", quality: q })}
            isAdmin={isAdmin}
          />

          {isQualityUpgrade &&
            (movieMatch ? (
              <>
                <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-xs text-amber-300">
                  <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>
                    Ai deja {checkResult.plexQuality} în Plex. Descărcarea adaugă un al doilea
                    fișier, la {quality} — pe cel vechi îl ștergi tu, din Bibliotecă.
                  </span>
                </div>
                {isAdmin && (
                  <TorrentPicker
                    matches={movieMatches}
                    selectedId={movieMatch.id}
                    onSelect={(id) => dispatch({ type: "PICK_TORRENT", torrentId: id })}
                  />
                )}
                <ActionButton
                  busy={busy}
                  icon={<Download className="h-4 w-4" />}
                  label={`Descarcă varianta ${quality}`}
                  onClick={() => {
                    dispatch({
                      type: "OPEN_CONFIRM",
                      target: {
                        kind: "single",
                        torrent: movieMatch,
                        label: `Film — upgrade la ${quality}`,
                        isSeasonPack: false,
                      },
                      back: { step: "result" },
                    });
                  }}
                />
              </>
            ) : (
              <div className="rounded-xl glass-card p-3 text-sm text-muted-foreground">
                Nu există {quality} pe Filelist pentru upgrade.
              </div>
            ))}
        </>
      ) : movieAlreadyDownloading ? (
        <div className="flex items-center gap-2 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-400">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          Filmul se descarcă deja — aștepți să apară în Plex înainte de orice altă acțiune.
        </div>
      ) : (
        showQualityAndAction && (
          <>
            {/* Bannerul stă deasupra selectorului, nu în ramura
              „nu există", fiindcă un film urmărit rămâne urmărit
              și în clipa în care apare un torrent — atunci vrei
              să vezi și că e așteptat, și butonul de descărcare. */}
            {wantedEntry && (
              <div className="space-y-2 rounded-xl bg-violet-500/10 p-3">
                <div className="flex items-center gap-2 text-sm text-violet-300">
                  <Orb state="searching" px={16} />
                  Se așteaptă la {wantedEntry.quality} — se verifică din 12 în 12 ore.
                </div>
                {/* Oprirea ar putea anula așteptarea altcuiva, deci
                  doar proprietarul sau un admin. */}
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

            <QualitySelector
              quality={quality}
              onChange={(q) => dispatch({ type: "SET_QUALITY", quality: q })}
              isAdmin={isAdmin}
            />

            {movieMatch ? (
              <>
                {isAdmin && (
                  <TorrentPicker
                    matches={movieMatches}
                    selectedId={movieMatch.id}
                    onSelect={(id) => dispatch({ type: "PICK_TORRENT", torrentId: id })}
                  />
                )}
                <ActionButton
                  busy={busy}
                  icon={<Download className="h-4 w-4" />}
                  label="Descarcă acum"
                  onClick={() => {
                    dispatch({
                      type: "OPEN_CONFIRM",
                      target: {
                        kind: "single",
                        torrent: movieMatch,
                        label: "Film",
                        isSeasonPack: false,
                      },
                      back: { step: "result" },
                    });
                  }}
                />
              </>
            ) : (
              <div className="space-y-3 rounded-xl glass-card p-3">
                <div className="text-sm text-muted-foreground">
                  Nu există încă la calitatea {quality} pe Filelist.
                </div>
                {/* Fundacul de dinainte: mesajul spunea „încă", dar
                  nu-ți oferea nimic de făcut cu informația asta. */}
                {/* Deschis oricui e logat, nu doar adminilor: un film
                  așteptat nu ocupă nimic până apare, iar descărcarea
                  de atunci e exact ce a cerut utilizatorul. */}
                {!wantedEntry && (
                  <ActionButton
                    busy={busy}
                    icon={<Orb state="searching" px={16} />}
                    label="Urmărește — descarcă automat când apare"
                    onClick={() => onToggleWatch(true)}
                  />
                )}
              </div>
            )}
          </>
        )
      )}
    </div>
  );
}
