import { useEffect, useReducer, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Loader2,
  CheckCircle2,
  Download,
  ArrowLeft,
  Check,
  Info,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DownloadConfirmFields } from "@/components/filelist/DownloadConfirmDialog";
import { adminStatusQuery } from "@/lib/queries";
import type { TmdbSearchResult } from "@/lib/tmdb/tmdb.functions";
import type { FilelistTorrent } from "@/lib/filelist.functions";
import { Orb } from "@/components/ui/orb";
import { groupTorrentsBySeasonEpisode } from "@/components/filelist/quality-utils";
import { ActionButton, TorrentPicker, PosterHero, QualitySelector } from "./wizard/WizardControls";
import { SearchStep } from "./wizard/SearchStep";
import { DoneStep } from "./wizard/DoneStep";
import { SeasonAccordion } from "./wizard/SeasonAccordion";
import type { SeasonRowData } from "./wizard/SeasonAccordion";
import type { Step, BulkDownloadItem, TorrentChoiceContext } from "./wizard/types";
import {
  ONGOING_TV_STATUSES,
  tvStatusLabel,
  qualityRank,
  bestOf,
  matchesForQuality,
} from "./wizard/selection";
import { deriveSeasonRows, deriveBulkPlan } from "./wizard/derive-seasons";
import { useWizardData } from "./wizard/use-wizard-data";
import { useWizardDownload } from "./wizard/use-wizard-download";
import { wizardReducer, initialWizardState } from "./wizard/state";

export function AddMediaWizard({
  open,
  onClose,
  initialItem,
}: {
  open: boolean;
  onClose: () => void;
  // Sare peste pasul de căutare — folosit când wizard-ul e deschis direct
  // dintr-un titlu deja identificat (ex. butonul "Adaugă" din Descoperă).
  initialItem?: TmdbSearchResult | null;
}) {
  const { data: adminData } = useQuery(adminStatusQuery);
  const isAdmin = !!adminData?.isAdmin;

  const [state, dispatch] = useReducer(wizardReducer, initialWizardState);

  // Locale cu aceleași nume ca vechile `useState`: JSX-ul de mai jos citește
  // exact ce citea înainte, deci mutarea la reducer n-a cerut restructurarea
  // randării. Cele patru derivate din `flow` sunt singurele care se îngustează
  // pe pas — și tocmai combinațiile lor imposibile erau sursa bug-urilor.
  const {
    flow,
    query,
    results,
    searching,
    selected,
    checkResult,
    checkError,
    tmdbDetails,
    seasonSchema,
    tvmazeAirstamps,
    plexBySeason,
    downloadingEntries,
    wantedEntry,
    quality,
    pickedTorrentId,
    busy,
    downloadingTorrentId,
    bulkProgress,
  } = state;

  const step = flow.step;
  // Lista de candidați e vie și în timpul confirmării, dacă de acolo s-a
  // ajuns — de-asta o citim și din `back`, nu doar din pasul "pick".
  const torrentChoice: TorrentChoiceContext | null =
    flow.step === "pick"
      ? flow.choice
      : flow.step === "confirm" && flow.back.step === "pick"
        ? flow.back.choice
        : null;
  const confirmTorrent =
    flow.step === "confirm" && flow.target.kind === "single" ? flow.target : null;
  const confirmBulk =
    flow.step === "confirm" && flow.target.kind === "bulk" ? flow.target.items : null;
  const doneMessage = flow.step === "done" ? flow.message : null;

  const cancelBulkRef = useRef(false);

  const isTv = selected?.mediaType === "tv";

  // Hook-urile stau înaintea efectelor care le folosesc: `selectItem` e
  // chemat din efectul de deschidere prefill, iar o declarație de după s-ar
  // fi bazat pe faptul că efectul rulează oricum mai târziu — adevărat, dar
  // fragil de citit.
  const { onQueryChange, selectItem } = useWizardData(dispatch);
  const { downloadOne, downloadBulk, toggleMovieWatch } = useWizardDownload({
    state,
    dispatch,
    isTv,
    cancelBulkRef,
  });

  function reset() {
    dispatch({ type: "RESET" });
    cancelBulkRef.current = false;
  }

  function handleClose() {
    reset();
    onClose();
  }

  // Deschis direct dintr-un titlu deja identificat (ex. Descoperă) — sare
  // peste pasul de căutare și pornește direct verificarea.
  useEffect(() => {
    if (open && initialItem) {
      selectItem(initialItem);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialItem?.id, initialItem?.mediaType]);

  // Utilizatorii obișnuiți descarcă mereu la 1080p — dacă cineva ajunge cu
  // altă calitate selectată (ex. sesiune de admin expirată între timp),
  // cădem înapoi automat.
  useEffect(() => {
    if (!isAdmin) dispatch({ type: "SET_QUALITY", quality: "1080p" });
  }, [isAdmin]);

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

  // Navigare "înapoi" reală — revine la căutare, păstrând rezultatele deja
  // încărcate acolo unde are sens. Destinația nu mai e ghicită aici: reducer-ul
  // o citește din `flow.back` pentru confirmare (deci întoarcerea regăsește
  // exact lista de candidați din care venise) și o știe din pas pentru rest.
  function goBack() {
    // Singura decizie care depinde de props, nu de stare: când wizard-ul e
    // deschis prefill (din Descoperă), nu există pas de căutare la care să te
    // întorci, deci "înapoi" din rezultat închide.
    if (step === "result" && initialItem) {
      handleClose();
      return;
    }
    dispatch({ type: "BACK" });
  }

  // Pașii afișați în indicatorul de progres — sărim peste "Căutare" când
  // wizard-ul a fost deschis prefill, la fel cum sărim peste "Alege torrent"
  // când nu există de fapt o alegere de făcut (utilizator obișnuit, sau
  // admin cu un singur candidat) — apare doar când chiar se ajunge acolo.
  const stepperSteps: Array<{ key: Step; label: string }> = [
    ...(initialItem ? [] : [{ key: "search" as Step, label: "Căutare" }]),
    { key: "checking", label: "Verificare" },
    { key: "result", label: "Rezultat" },
    ...(torrentChoice || step === "pick" ? [{ key: "pick" as Step, label: "Alege torrent" }] : []),
    { key: "confirm", label: "Confirmare" },
  ];
  const effectiveStep = step === "search" && initialItem ? "checking" : step;
  const stepperIndex = stepperSteps.findIndex((s) => s.key === effectiveStep);

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && !busy && handleClose()}>
        <DialogContent className="top-8 flex max-h-[calc(100dvh-4rem)] w-[calc(100%-2rem)] max-w-md translate-y-0 flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:w-full">
          <DialogHeader className="shrink-0 space-y-0 p-4 pb-0 text-left">
            <div className="flex items-center gap-2">
              {(step === "result" || step === "pick" || step === "confirm") && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={goBack}
                  className="shrink-0 rounded-lg p-1 text-muted-foreground hover:text-foreground hover:bg-muted/60 disabled:opacity-40"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
              )}
              <DialogTitle className="flex-1 pr-6">Adaugă film/serial</DialogTitle>
            </div>
            {effectiveStep !== "search" && step !== "done" && stepperSteps.length > 1 && (
              <div className="flex items-center gap-1 pt-2">
                {stepperSteps.map((s, i) => (
                  <div key={s.key} className="flex flex-1 items-center gap-1">
                    <div
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold transition-colors ${
                        i < stepperIndex
                          ? "bg-primary text-primary-foreground"
                          : i === stepperIndex
                            ? "bg-primary/20 text-primary ring-1 ring-primary"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {i < stepperIndex ? <Check className="h-3 w-3" /> : i + 1}
                    </div>
                    {i < stepperSteps.length - 1 && (
                      <div
                        className={`h-0.5 flex-1 rounded-full transition-colors ${
                          i < stepperIndex ? "bg-primary" : "bg-muted"
                        }`}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto px-4 pb-6 pt-3">
            {step === "search" && !initialItem && (
              <SearchStep
                query={query}
                onQueryChange={onQueryChange}
                searching={searching}
                results={results}
                onSelect={selectItem}
              />
            )}

            {(step === "checking" || (step === "search" && initialItem)) && (
              <div className="animate-in fade-in duration-200 space-y-4">
                <div className="relative h-28 skeleton-sweep overflow-hidden rounded-2xl" />
                <div className="space-y-2">
                  <div className="h-4 w-2/3 skeleton-sweep rounded" />
                  <div className="h-3 w-1/3 skeleton-sweep rounded" />
                </div>
                <div className="flex items-center justify-center gap-2 pt-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Verific Plex și Filelist pentru „{selected?.title ?? initialItem?.title}”…
                </div>
              </div>
            )}

            {step === "result" && selected && checkResult && (
              <div className="animate-in fade-in slide-in-from-right-2 duration-200 space-y-4">
                <PosterHero
                  posterUrl={selected.posterUrl}
                  mediaType={selected.mediaType}
                  title={selected.title}
                  subtitle={
                    checkResult.originalTitle + (selected.year ? ` · ${selected.year}` : "")
                  }
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
                        <div className="text-xs text-muted-foreground break-words">
                          {checkError}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Nu știu ce există în Plex sau pe Filelist pentru titlul ăsta — nimic din
                          ce-ar apărea mai jos n-ar fi de încredere.
                        </div>
                      </div>
                    </div>
                    <ActionButton
                      busy={busy}
                      icon={<RefreshCw className="h-4 w-4" />}
                      label="Reîncearcă"
                      onClick={() => selectItem(selected)}
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
                                    a.seasonNumber === ne.seasonNumber &&
                                    a.episodeNum === ne.episodeNumber,
                                )?.airstamp;
                                const dateLabel = new Date(
                                  airstamp ?? ne.airDate,
                                ).toLocaleDateString("ro-RO", {
                                  day: "numeric",
                                  month: "long",
                                  year: "numeric",
                                  timeZone: "Europe/Bucharest",
                                });
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
                              Ai deja {checkResult.plexQuality} în Plex. Descărcarea adaugă un al
                              doilea fișier, la {quality} — pe cel vechi îl ștergi tu, din
                              Bibliotecă.
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
                    Filmul se descarcă deja — aștepți să apară în Plex înainte de orice altă
                    acțiune.
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
                              onClick={() => toggleMovieWatch(false)}
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
                              onClick={() => toggleMovieWatch(true)}
                            />
                          )}
                        </div>
                      )}
                    </>
                  )
                )}
              </div>
            )}

            {step === "pick" && torrentChoice && (
              <div className="animate-in fade-in slide-in-from-right-2 duration-200 space-y-4">
                <div className="text-sm font-semibold">Alege torrentul — {torrentChoice.label}</div>
                <TorrentPicker
                  matches={torrentChoice.candidates}
                  selectedId={pickedTorrentId ?? torrentChoice.candidates[0].id}
                  onSelect={(id) => dispatch({ type: "PICK_TORRENT", torrentId: id })}
                />
                <ActionButton
                  busy={false}
                  icon={<Download className="h-4 w-4" />}
                  label="Continuă"
                  onClick={() => {
                    const chosen =
                      torrentChoice.candidates.find((t) => t.id === pickedTorrentId) ??
                      bestOf(torrentChoice.candidates)!;
                    // `back` reține alegerea: săgeata de înapoi din
                    // confirmare readuce exact lista de candidați, nu un
                    // ecran de rezultat care ar pierde selecția.
                    dispatch({
                      type: "OPEN_CONFIRM",
                      target: {
                        kind: "single",
                        torrent: chosen,
                        label: torrentChoice.label,
                        season: torrentChoice.season,
                        episode: torrentChoice.episode,
                        isSeasonPack: torrentChoice.isSeasonPack,
                      },
                      back: { step: "pick", choice: torrentChoice },
                    });
                  }}
                />
              </div>
            )}

            {step === "confirm" && confirmBulk && (
              <div className="animate-in fade-in slide-in-from-right-2 duration-200 space-y-4">
                <div className="text-sm font-semibold">Confirmare descărcare în lot</div>
                <div className="space-y-2 rounded-xl glass-card p-3">
                  <div className="text-sm text-foreground">
                    Pornești {confirmBulk.length} descărcări — tot ce lipsește și e disponibil pe
                    Filelist, la calitatea {quality}?
                  </div>
                  {/* Fără înălțime maximă și scroll propriu: limita era
                      moștenită de pe vremea când confirmarea în lot era un
                      card înghesuit pe ecranul de rezultat, între selectorul
                      de calitate și acordeon. Acum, fiind pas propriu, lista
                      curge în scroll-ul dialogului — un scroll în scroll e
                      incomod pe telefon și tăia primul rând. */}
                  <div className="space-y-1">
                    {confirmBulk.map((item) => (
                      <div key={`${item.season}-${item.episode ?? "pack"}`} className="text-xs">
                        <span className="font-medium text-foreground">{item.label}</span>{" "}
                        <span className="break-all text-muted-foreground">
                          — {item.torrent.name}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Cât rulează lotul, butoanele lasă locul progresului: e
                    singurul moment în care dialogul nu poate fi închis, deci
                    trebuie să se vadă unde s-a ajuns și să existe o ieșire. */}
                {bulkProgress ? (
                  <div className="space-y-2 rounded-xl glass-card p-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {bulkProgress.done}/{bulkProgress.total} adăugate
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          cancelBulkRef.current = true;
                          toast.info("Se oprește după descărcarea curentă");
                        }}
                        className="rounded-lg border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/60"
                      >
                        Oprește
                      </button>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-[width] duration-300"
                        style={{
                          width: `${Math.round((bulkProgress.done / Math.max(bulkProgress.total, 1)) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => dispatch({ type: "BACK" })}
                      className="flex-1 rounded-xl border border-border py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
                    >
                      Anulează
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadBulk(confirmBulk)}
                      className="flex-1 rounded-xl bg-primary py-2 text-sm font-semibold text-primary-foreground"
                    >
                      Descarcă
                    </button>
                  </div>
                )}
              </div>
            )}

            {step === "confirm" && !confirmBulk && confirmTorrent && (
              <div className="animate-in fade-in slide-in-from-right-2 duration-200 space-y-4">
                <div className="text-sm font-semibold">Confirmare descărcare</div>
                <DownloadConfirmFields
                  torrent={confirmTorrent.torrent}
                  label={confirmTorrent.label}
                  // Wizard-ul trimite mereu metadatele TMDB proprii
                  // (buildMediaPayload), deci legarea manuală de un titlu
                  // existent n-ar avea ce influența — ascunsă, ca să nu fie un
                  // control care pare că face ceva și e ignorat în tăcere.
                  allowLinking={false}
                  onCancel={goBack}
                  onConfirm={() => {
                    // Fără curățare aici: `downloadOne` schimbă pasul pe
                    // "done" DOAR la succes, iar dacă goleam `confirmTorrent`
                    // înainte de a ști rezultatul, o descărcare eșuată lăsa
                    // pasul "confirm" fără țintă — adică un corp de dialog
                    // gol, cu stepper și săgeată deasupra. Curățarea se face
                    // în reset(), la închidere.
                    downloadOne(confirmTorrent.torrent, {
                      season: confirmTorrent.season ?? null,
                      episode: confirmTorrent.episode ?? null,
                      isSeasonPack: confirmTorrent.isSeasonPack ?? false,
                    });
                  }}
                />
              </div>
            )}

            {step === "done" && <DoneStep doneMessage={doneMessage} onClose={handleClose} />}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
