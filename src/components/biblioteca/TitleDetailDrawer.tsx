import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Film,
  Tv,
  Eye,
  EyeOff,
  Captions,
  CaptionsOff,
  Flag,
  Clock3,
  Users,
  User,
  Loader2,
  Trash2,
  Wrench,
  ChevronRight,
  ExternalLink,
  XCircle,
  ArrowLeft,
  Radar,
  CalendarClock,
  CheckCheck,
  RefreshCw,
  Download,
} from "lucide-react";
import { Orb } from "@/components/ui/orb";

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { getPlexTitleDetail } from "@/lib/services.functions";
import type { PlexTitleDetail } from "@/lib/services/plex-browse";
import { correctSubtitleForMedia, deleteSubtitleForMedia } from "@/lib/filelist.functions";
import { setShowWatch, checkShowNow } from "@/lib/media/media.functions";
import { formatMs, formatBytes, formatSpeed, formatEta } from "@/lib/format";
import { subtitleSourceDisplay } from "@/lib/filelist/subtitle-outcomes";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "./StatusBadge";
import { EpisodeList } from "./EpisodeList";
import {
  episodeCode,
  addedDate,
  nextEpisodeWhen,
  displayEpisodeTitle,
  airDateLabel,
  lastCheckedLabel,
  dayTimeLabel,
} from "./utils";
import { QualityButton, QualityChecklist } from "./QualityChecklist";

// Peste pragul ăsta, "Se procesează" nu mai e o scanare Plex în curs — de
// obicei legarea reușește în primul minut după descărcare.
const PROCESSING_HINT_AFTER_MS = 30 * 60 * 1000;

// Drawer-ul de detalii al unui titlu din Bibliotecă — complet independent de
// listă: primește doar mediaId, își gestionează singur toată starea (query
// de detalii, corectare/ștergere subtitrare). Cere listei doar două lucruri,
// prin callback-uri: să deschidă confirmarea de ștergere completă (rândurile
// rămân la nivel de listă, ca overlay simplu peste drawer — nu un
// AlertDialog Radix imbricat, care ar îngheța ecranul, vezi commit c76ce30)
// și să știe când s-a șters efectiv titlul, ca să închidă drawer-ul și să
// reîmprospăteze lista.
export function TitleDetailDrawer({
  mediaId,
  onClose,
  onRequestDelete,
}: {
  mediaId: number | null;
  onClose: () => void;
  onRequestDelete: (info: {
    mediaId: number;
    title: string;
    isSeasonPack: boolean;
    isCancel: boolean;
  }) => void;
}) {
  const queryClient = useQueryClient();
  const [correcting, setCorrecting] = useState(false);
  const [deletingSubtitle, setDeletingSubtitle] = useState(false);
  const [showTech, setShowTech] = useState(false);
  // Navigare serial → episod în ACELAȘI drawer, cu buton de întoarcere.
  // Nu un al doilea drawer/dialog peste primul: overlay-urile Radix imbricate
  // într-un Drawer vaul îngheață ecranul fără nicio eroare logată (vezi
  // commit c76ce30 și incidentul din AddMediaWizard).
  // Perechea (serial, episod), nu doar id-ul episodului: ștergerea unui titlu
  // pune mediaId pe null din afară, fără ca vaul să apeleze onOpenChange, deci
  // un reset făcut doar acolo lăsa episodul agățat — următorul titlu deschis
  // ar fi afișat direct episodul rămas din sesiunea anterioară. Legat de
  // serialul lui, starea se invalidează singură, fără useEffect.
  const [openEpisode, setOpenEpisode] = useState<{ showId: number; episodeId: number } | null>(
    null,
  );
  const [savingWatch, setSavingWatch] = useState(false);
  const [checkingNow, setCheckingNow] = useState(false);
  const [pickingWatch, setPickingWatch] = useState(false);
  const [pickingQuality, setPickingQuality] = useState(false);

  const correctFn = useServerFn(correctSubtitleForMedia);
  const deleteSubtitleFn = useServerFn(deleteSubtitleForMedia);
  const setShowWatchFn = useServerFn(setShowWatch);
  const checkShowNowFn = useServerFn(checkShowNow);

  // Serialul rămâne "titlul de bază" al drawer-ului; când e deschis un episod,
  // el devine subiectul afișat, iar butonul înapoi doar golește starea asta.
  // Dacă titlul de bază a dispărut (ex. ștergere), episodul deschis peste el
  // nu mai are context — nu ținem o cerere vie pentru un drawer închis.
  const openEpisodeId = openEpisode?.showId === mediaId ? openEpisode.episodeId : null;
  const activeId = mediaId == null ? null : (openEpisodeId ?? mediaId);

  const detail = useQuery({
    queryKey: ["plexTitleDetail", activeId],
    queryFn: () => getPlexTitleDetail({ data: { mediaId: activeId! } }),
    enabled: !!activeId,
    // Progres live cât timp titlul e în descărcare sau în așteptarea
    // indexării Plex — se oprește automat când trece la "in_library" (vezi
    // și plexLibraryBrowseQuery).
    //
    // Serialele merg pe un puls lent când n-au ce câștiga din cel rapid:
    // statusul unui serial e agregat din episoadele lui și rămâne
    // "downloading" cât timp măcar unul n-a ajuns în Plex, deci un episod
    // blocat definitiv (torrent șters din qBittorrent) ținea pulsul de 2.5s
    // pornit la nesfârșit, cât timp drawer-ul e deschis.
    refetchInterval: (query) => {
      const d = query.state.data;
      if (d?.status !== "ok") return false;
      const { status, type } = d.detail;
      if (status !== "downloading" && status !== "processing") return false;
      if (type !== "tv_show") return 2500;
      // Pulsul rapid are rost la un serial doar cât măcar un episod chiar
      // ține un procent care urcă; dacă toate sunt doar în așteptarea
      // indexării Plex (sau blocate, fără torrent în qBittorrent), rămâne
      // pulsul lent — vezi comentariul de mai sus.
      return d.detail.episodes.some((e) => e.status === "downloading" && e.progress != null)
        ? 2500
        : 15_000;
    },
  });
  const d = detail.data?.status === "ok" ? detail.data.detail : null;
  const airedOn = d?.type === "episode" ? airDateLabel(d.airDate) : null;
  const watchedEpisodes = d?.episodes.filter((e) => e.watchedByMe).length ?? 0;

  function invalidateAfterMutation() {
    queryClient.invalidateQueries({ queryKey: ["plexLibraryBrowse"] });
    // Ambele niveluri: o schimbare pe episod (subtitrare, ștergere) se vede și
    // în lista de episoade a serialului de deasupra.
    for (const id of new Set([mediaId, activeId])) {
      if (id) queryClient.invalidateQueries({ queryKey: ["plexTitleDetail", id] });
    }
  }

  async function toggleWatch(enabled: boolean, mode: "forward" | "backfill" = "forward") {
    if (!d) return;
    setSavingWatch(true);
    const res = await setShowWatchFn({
      data: { mediaId: d.mediaId, enabled, quality: d.autoDownloadQuality ?? "1080p", mode },
    }).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    setSavingWatch(false);
    setPickingWatch(false);
    if (!res.ok) {
      toast.error("Nu am putut schimba urmărirea", { description: res.error });
      return;
    }
    toast.success(enabled ? "Urmărire pornită" : "Urmărire oprită");
    invalidateAfterMutation();
  }

  // Calitatea principală și cea de rezervă se trimit mereu împreună: o
  // principală schimbată pe aceeași valoare ca rezerva lasă serialul fără
  // rezervă (două calități identice n-au sens — vezi effectiveFallback).
  async function setWatchQualities(quality: string, fallbackQuality: string | null) {
    if (!d) return;
    setSavingWatch(true);
    // Schimbarea calității pe un serial deja urmărit nu trebuie să mute
    // punctul de pornire înapoi — de-aia "backfill" nu apare aici.
    //
    // Eroarea se raportează, ca la toggleWatch de mai sus: setShowWatchCore
    // întoarce {ok:false} și când n-ai drepturi pe serial, iar varianta veche
    // (`.catch(() => {})`, fără să se uite la rezultat) o înghițea complet —
    // calitatea părea schimbată până la următorul refetch, care o dădea
    // înapoi fără nicio explicație.
    const res = await setShowWatchFn({
      data: {
        mediaId: d.mediaId,
        enabled: true,
        quality,
        fallbackQuality: fallbackQuality === quality ? null : fallbackQuality,
      },
    }).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    setSavingWatch(false);
    if (!res.ok) {
      toast.error("Nu am putut schimba calitatea", { description: res.error });
      return;
    }
    invalidateAfterMutation();
  }

  async function checkNow() {
    if (!d) return;
    setCheckingNow(true);
    const toastId = toast.loading(`Verific episoade noi pentru „${d.show ?? d.title}”…`);
    const res = await checkShowNowFn({ data: { mediaId: d.mediaId } }).catch((e) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
    }));
    setCheckingNow(false);
    if (!res.ok) {
      toast.error("Verificarea a eșuat", { id: toastId, description: res.error });
      return;
    }
    const o = res.outcome;
    if (o.downloaded.length > 0) {
      toast.success(`Pornite ${o.downloaded.length}`, {
        id: toastId,
        description: o.downloaded.join(", "),
        duration: 8000,
      });
    } else {
      toast.info("Niciun episod nou de descărcat", {
        id: toastId,
        // Motivul contează: "lipsesc 3 episoade, dar niciun torrent 1080p" e
        // altceva decât "ești la zi", iar fără el depanarea e ghicit.
        description:
          o.skipped ??
          (o.missing.length > 0 ? `Lipsesc: ${o.missing.join(", ")}` : "Ești la zi cu serialul"),
        duration: 8000,
      });
    }
    invalidateAfterMutation();
  }

  async function correctSubtitle() {
    if (!d) return;
    setCorrecting(true);
    const toastId = toast.loading(`Verific subtitrarea pentru „${d.title}”…`);
    const res = await correctFn({
      data: { mediaId: d.mediaId },
    }).catch((e) => ({
      status: "error" as const,
      error: e instanceof Error ? e.message : String(e),
    }));
    setCorrecting(false);
    if (res.status !== "ok") {
      toast.error("Eroare la corectarea subtitrării", { id: toastId, description: res.error });
      return;
    }
    toast.success("Subtitrare verificată", {
      id: toastId,
      description: res.detail,
      duration: 6000,
    });
    invalidateAfterMutation();
  }

  async function deleteSubtitle() {
    if (!d) return;
    setDeletingSubtitle(true);
    const toastId = toast.loading(`Șterg subtitrarea pentru „${d.title}”…`);
    const res = await deleteSubtitleFn({
      data: { mediaId: d.mediaId },
    }).catch((e) => ({
      status: "error" as const,
      error: e instanceof Error ? e.message : String(e),
    }));
    setDeletingSubtitle(false);
    if (res.status !== "ok") {
      toast.error("Eroare la ștergerea subtitrării", { id: toastId, description: res.error });
      return;
    }
    toast.success("Subtitrare ștearsă", {
      id: toastId,
      description: res.deleted.join(", "),
      duration: 6000,
    });
    invalidateAfterMutation();
  }

  return (
    <Drawer
      open={!!mediaId}
      onOpenChange={(o) => {
        if (o) return;
        setOpenEpisode(null);
        onClose();
      }}
    >
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="pb-2 text-left">
          {openEpisodeId != null && (
            <button
              type="button"
              onClick={() => setOpenEpisode(null)}
              className="mb-1 flex w-fit items-center gap-1 rounded-full bg-muted/60 px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" /> Înapoi la serial
            </button>
          )}
          {/* Tot ce descrie titlul stă lângă poster — an, IMDb, insigne, genuri —
              ca antetul fix să ocupe cât mai puțin; sub el, pe toată
              lățimea, rămâne doar starea temporară (descărcare/indexare). */}
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
              {/* Titlul original, anul și IMDb pe un rând: toate trei spun
                  „care titlu e ăsta”, nu „ce fișier am”. La episod, anul și
                  IMDb-ul sunt ale serialului (premiera, pagina serialului), iar
                  genurile există doar la nivel de serial pe TMDB — acolo le
                  vezi, cu „Înapoi la serial”. Episodul își arată în schimb
                  data difuzării. */}
              {d && (
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px]">
                  {d.originalTitle &&
                    d.originalTitle !== (d.type === "movie" ? d.title : (d.show ?? d.title)) && (
                      // pr-1: `truncate` taie tot ce iese din cutie, inclusiv
                      // aplecarea ultimei litere italice.
                      <span className="min-w-0 truncate pr-1 text-xs text-muted-foreground italic">
                        {d.originalTitle}
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
                  {/* Spre deosebire de IMDb, ține de FIȘIER: există la film și
                      la episod (la pachet, pagina pachetului), nu la serial.
                      Doar descărcările noi au ID-ul salvat. */}
                  {d.type !== "tv_show" && d.filelistId != null && (
                    <a
                      href={`https://filelist.io/details.php?id=${d.filelistId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 font-medium text-foreground hover:bg-muted/70 transition-colors"
                    >
                      <ExternalLink className="h-3 w-3" /> Filelist
                    </a>
                  )}
                </div>
              )}
              {d && (d.type !== "tv_show" || d.durationMs > 0) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px]">
                  {/* Calitatea, audio/subtitrarea și durata sunt proprietăți
                      ale unui FIȘIER. Rândul-părinte 'tv_show' nu are fișier,
                      deci coloanele lui sunt goale prin construcție — iar
                      has_romanian_subtitle = 0 pe el nu înseamnă "fără
                      subtitrare RO", ci "întrebare fără sens la nivel de
                      serial". Se aplică per episod, nu aici. */}
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
                    // Cât timp titlul e în descărcare, subtitrarea încă nu a
                    // fost căutată/verificată — o insignă "doar engleză" ar fi
                    // falsă, nu doar incompletă, de-aia o ascundem până se
                    // termină.
                    d.status !== "downloading" &&
                    (d.hasRomanianSubtitle ? (
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
              {/* Text simplu, nu pastile: e informație secundară, iar
                  pastilele ocupau un rând întreg. */}
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
                  {/* Plex poate potrivi fișierul la alt titlu (ex. „S.W.A.T.
                      Exiles" pus la „S.W.A.T." 2017) — legarea după TMDB nu-l
                      găsește atunci niciodată. Indiciul apare doar adminului
                      (d.tech), singurul care poate face Fix Match în Plex. */}
                  {d.tech?.completedAt &&
                  Date.now() - new Date(`${d.tech.completedAt.replace(" ", "T")}Z`).getTime() >
                    PROCESSING_HINT_AFTER_MS
                    ? "Durează mai mult decât de obicei. Verifică în Plex dacă titlul a fost recunoscut corect — dacă nu, ⋯ → Fix Match → alege titlul corect. Se leagă automat după aceea."
                    : "Fișierul e descărcat complet — aștept ca Plex să îl indexeze."}
                </div>
              )}
            </div>
          )}
        </DrawerHeader>

        <div className="min-h-0 flex-1 px-4 pb-6 space-y-3 overflow-y-auto overscroll-contain">
          {detail.isLoading && (
            <div className="text-xs text-muted-foreground">Se încarcă detaliile…</div>
          )}
          {detail.data?.status === "error" && (
            <div className="text-xs text-red-400">{detail.data.error}</div>
          )}
          {d && (
            <>
              {/* Cadrul episodului (TMDB, orizontal): în partea care se
                  derulează, nu în antet — acolo, fix, ocupa prea mult ecran.
                  Pe toată lățimea drawer-ului, care e oricum plafonată pe
                  desktop (vezi DrawerContent). */}
              {d.type === "episode" && d.stillUrl && (
                <img
                  src={d.stillUrl}
                  className="aspect-[2/1] w-full rounded-xl object-cover bg-muted"
                  loading="lazy"
                  alt=""
                />
              )}

              {d.summary && <ClampedSummary key={activeId} text={d.summary} />}

              {d.type === "tv_show" && (
                <>
                  {/* Episoadele noi, într-un singur card: ce urmează și cine
                      se ocupă de el. „Urmează S10E08” și „Urmărit” spun două
                      jumătăți ale aceluiași lucru — când apare episodul și
                      dacă ajunge singur în bibliotecă — deci stau împreună. */}
                  <div
                    className={`rounded-xl border border-border bg-muted/30 p-3 space-y-2 ${d.autoDownload ? "border-flow" : ""}`}
                  >
                    {/* Urmărirea episoadelor noi. Butoanele sunt ascunse
                        pentru serialele încheiate — n-au ce episoade noi să
                        primească — DAR nu și când urmărirea e deja pornită: un
                        serial urmărit care se încheie între timp ar rămâne
                        altfel fără niciun buton prin care s-o oprești. Fără
                        drepturi pe serial, starea „Urmărit” se vede, fără
                        butoane. */}
                    {(d.autoDownload || (d.canManage && d.tvStatus !== "Ended")) && (
                      <div className="flex items-center gap-2">
                        {d.autoDownload ? (
                          <Orb state="searching" px={18} label="Urmărit" />
                        ) : (
                          <Radar className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="flex-1 text-xs font-medium">
                          {d.autoDownload ? "Urmărit" : "Urmărește episoade noi"}
                        </span>
                        {d.canManage && d.autoDownload && (
                          <button
                            type="button"
                            onClick={checkNow}
                            disabled={checkingNow}
                            className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-muted/60 disabled:opacity-40"
                          >
                            {checkingNow ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3 w-3" />
                            )}
                            Verifică acum
                          </button>
                        )}
                        {!d.canManage ? null : d.autoDownload ? (
                          <button
                            type="button"
                            onClick={() => toggleWatch(false)}
                            disabled={savingWatch}
                            className="rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 disabled:opacity-40"
                          >
                            Oprește
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setPickingWatch((v) => !v)}
                            disabled={savingWatch}
                            className="rounded-lg bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
                          >
                            Pornește
                          </button>
                        )}
                      </div>
                    )}

                    {/* Următorul episod — citit din `media`, nu cerut live:
                        show-watcher îl ține la zi din TMDB (data) + TVmaze
                        (ora exactă). Ora se redă în fusul browserului, deci
                        apare direct în ora României. În dreapta, calitatea
                        cu care se descarcă. */}
                    <NextEpisodeLine
                      detail={d}
                      trailing={
                        d.canManage && d.autoDownload ? (
                          <QualityButton
                            primary={d.autoDownloadQuality ?? "1080p"}
                            fallback={d.autoDownloadFallbackQuality}
                            open={pickingQuality}
                            disabled={savingWatch}
                            onToggle={() => setPickingQuality((v) => !v)}
                          />
                        ) : null
                      }
                    />

                    {/* Lista de calități, inline — nu un Popover/Select Radix:
                        un overlay imbricat în Drawer-ul vaul îngheață ecranul
                        (vezi commit c76ce30). */}
                    {d.canManage && d.autoDownload && pickingQuality && (
                      <QualityChecklist
                        primary={d.autoDownloadQuality ?? "1080p"}
                        fallback={d.autoDownloadFallbackQuality}
                        disabled={savingWatch}
                        onChange={setWatchQualities}
                      />
                    )}

                    {d.autoDownload && (
                      <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
                        <Download className="mt-px h-3 w-3 shrink-0 text-primary" />
                        <span className="flex-1">Se descarcă automat când apare pe Filelist.</span>
                        <span className="shrink-0 text-[10px]">
                          {lastCheckedLabel(d.watchLastCheckedAt)}
                        </span>
                      </div>
                    )}

                    {/* Alegerea punctului de pornire e explicită, nu
                        implicită: pentru un serial din care ai doar primele
                        sezoane, "recuperează tot" înseamnă zeci de episoade
                        descărcate deodată — trebuie să fie o decizie luată în
                        cunoștință de cauză, nu un efect secundar. */}
                    {d.canManage && pickingWatch && !d.autoDownload && (
                      <div className="space-y-1.5">
                        <button
                          type="button"
                          onClick={() => toggleWatch(true, "forward")}
                          className="w-full rounded-lg bg-muted/60 px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-muted"
                        >
                          <span className="block font-medium text-foreground">
                            Doar de acum înainte
                          </span>
                          <span className="block text-muted-foreground">
                            Descarcă episoadele care apar din acest moment
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleWatch(true, "backfill")}
                          className="w-full rounded-lg bg-muted/60 px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-muted"
                        >
                          <span className="block font-medium text-foreground">
                            Recuperează și ce lipsește
                          </span>
                          <span className="block text-muted-foreground">
                            Descarcă și episoadele difuzate pe care nu le ai
                          </span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Cine l-a adus și cine l-a văzut, apoi episoadele.
                      Detaliile tehnice rămân la coadă. */}
                  <AudienceCard detail={d} watchedEpisodes={watchedEpisodes} />

                  <EpisodeList
                    key={d.mediaId}
                    episodes={d.episodes}
                    onOpen={(episodeId) => setOpenEpisode({ showId: mediaId!, episodeId })}
                  />
                </>
              )}

              {/* La serial, cardul stă deasupra sezoanelor (vezi mai sus). */}
              {d.type !== "tv_show" && (
                <AudienceCard detail={d} watchedEpisodes={watchedEpisodes} />
              )}

              {d.tech && (
                <div className="text-xs">
                  <button
                    type="button"
                    onClick={() => setShowTech((v) => !v)}
                    className="flex w-full items-center gap-1 py-1 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Wrench className="h-3.5 w-3.5" /> Detalii tehnice
                    <ChevronRight
                      className={`h-3.5 w-3.5 ml-auto transition-transform duration-200 ${showTech ? "rotate-90" : ""}`}
                    />
                  </button>
                  {showTech && (
                    <div className="animate-in fade-in-0 slide-in-from-top-1 duration-200 flex flex-col gap-1 rounded-lg bg-muted/40 px-2 py-1.5">
                      {[
                        d.tech.torrentName && ["Torrent", d.tech.torrentName],
                        d.tech.sizeBytes > 0 && ["Mărime", formatBytes(d.tech.sizeBytes)],
                        d.tech.categoryName && ["Categorie", d.tech.categoryName],
                        (d.tech.freeleech || d.tech.internal) && [
                          "Steaguri",
                          [d.tech.freeleech && "freeleech", d.tech.internal && "internal"]
                            .filter(Boolean)
                            .join(", "),
                        ],
                        d.tech.savePath && ["Cale disk", d.tech.savePath],
                        d.tech.addedVia && ["Adăugat via", d.tech.addedVia],
                        d.tech.completedAt && [
                          "Finalizat",
                          addedDate(
                            Math.floor(
                              new Date(`${d.tech.completedAt.replace(" ", "T")}Z`).getTime() / 1000,
                            ),
                          ),
                        ],
                        d.tech.subtitleSource && [
                          "Sursă subtitrare",
                          subtitleSourceDisplay(d.tech.subtitleSource),
                        ],
                        d.tech.subtitleDetail && ["Detaliu subtitrare", d.tech.subtitleDetail],
                        d.tech.subtitleCheckedAt && [
                          "Subtitrare verificată",
                          addedDate(
                            Math.floor(
                              new Date(`${d.tech.subtitleCheckedAt.replace(" ", "T")}Z`).getTime() /
                                1000,
                            ),
                          ),
                        ],
                        d.tech.plexRatingKey && ["Plex ratingKey", d.tech.plexRatingKey],
                        d.tech.imdbId && ["IMDb", d.tech.imdbId],
                        d.torrentHash && ["Torrent hash", d.torrentHash],
                      ]
                        .filter((row): row is [string, string] => !!row)
                        // Valorile se afișează întregi, nu tăiate. Cele lungi
                        // (detaliul subtitrării, numele torrentului) trec sub
                        // etichetă, pe toată lățimea, aliniate la stânga — un
                        // paragraf aliniat la dreapta pe 4-5 rânduri se citește
                        // greu. `wrap-anywhere` rupe și șirurile fără spații
                        // (hash, nume de release cu puncte) ca să nu iasă din
                        // chenar.
                        .map(([label, value]) =>
                          value.length > 40 ? (
                            <div key={label} className="flex flex-col gap-0.5">
                              <span className="text-muted-foreground">{label}</span>
                              <span className="wrap-anywhere text-foreground">{value}</span>
                            </div>
                          ) : (
                            <div key={label} className="flex justify-between gap-3">
                              <span className="shrink-0 text-muted-foreground">{label}</span>
                              <span className="min-w-0 wrap-anywhere text-right text-foreground">
                                {value}
                              </span>
                            </div>
                          ),
                        )}
                    </div>
                  )}
                </div>
              )}

              {d.type !== "tv_show" && (
                <div className="flex flex-col gap-2 pt-1 border-t border-border">
                  {d.torrentHash ? (
                    d.canManage ? (
                      d.status === "downloading" ? (
                        <button
                          type="button"
                          onClick={() =>
                            onRequestDelete({
                              mediaId: d.mediaId,
                              title: d.type === "movie" ? d.title : (d.show ?? d.title),
                              isSeasonPack: d.isSeasonPack,
                              isCancel: true,
                            })
                          }
                          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-muted/40 py-2 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          Anulare
                        </button>
                      ) : (
                        <>
                          <div className="flex gap-2 pt-2">
                            <button
                              type="button"
                              onClick={correctSubtitle}
                              disabled={correcting}
                              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-muted/40 py-2 text-xs font-medium text-foreground hover:bg-muted/60 transition-colors disabled:opacity-40"
                            >
                              {correcting ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Captions className="h-3.5 w-3.5" />
                              )}
                              Corectează subtitrare
                            </button>
                            <button
                              type="button"
                              onClick={deleteSubtitle}
                              disabled={deletingSubtitle}
                              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-muted/40 py-2 text-xs font-medium text-foreground hover:bg-muted/60 transition-colors disabled:opacity-40"
                            >
                              {deletingSubtitle ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <CaptionsOff className="h-3.5 w-3.5" />
                              )}
                              Șterge subtitrare
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              onRequestDelete({
                                mediaId: d.mediaId,
                                title: d.type === "movie" ? d.title : (d.show ?? d.title),
                                isSeasonPack: d.isSeasonPack,
                                isCancel: false,
                              })
                            }
                            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-muted/40 py-2 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Șterge titlul complet
                          </button>
                        </>
                      )
                    ) : (
                      <div className="pt-2 text-[11px] text-muted-foreground">
                        Doar {d.addedByUsername ?? "cel care a adăugat titlul"} sau un admin poate
                        corecta/șterge subtitrarea sau șterge titlul.
                      </div>
                    )
                  ) : (
                    <div className="pt-2 text-[11px] text-muted-foreground">
                      Nu știm ce torrent corespunde acestui titlu (a fost adăugat manual în Plex,
                      sau torrentul nu mai există în qBittorrent) — corectarea/ștergerea subtitrării
                      și ștergerea completă nu sunt disponibile.
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

// Cine l-a adus și cine l-a văzut — un singur card cu rânduri, în loc de
// patru-cinci rânduri separate, fiecare cu titlul lui. Datele scurte („28
// sept., 21:40”, „ieri, 19:45”): cele lungi rupeau rândurile în două pe telefon.
// Ceilalți spectatori stau pe toată lățimea, nume în stânga și dată în dreapta,
// primii trei la vedere și restul la „încă N”.
const OTHERS_VISIBLE = 3;

function AudienceCard({
  detail: d,
  watchedEpisodes,
}: {
  detail: PlexTitleDetail;
  watchedEpisodes: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const others = showAll ? d.watchedByOthers : d.watchedByOthers.slice(0, OTHERS_VISIBLE);
  const hidden = d.watchedByOthers.length - others.length;

  return (
    <div className="rounded-xl border border-border/60 bg-muted/30 divide-y divide-border/50 text-xs">
      <InfoRow icon={<User className="h-3.5 w-3.5" />} label="Adăugat">
        <span className="font-medium">{d.addedByUsername ?? "necunoscut"}</span>
        <span className="text-muted-foreground"> · {dayTimeLabel(d.addedAt)}</span>
      </InfoRow>
      {/* Bara stă în același rând cu „Tu”, nu separată de linie. */}
      <div>
        <InfoRow
          icon={
            d.watchedByMe ? (
              <Eye className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <EyeOff className="h-3.5 w-3.5" />
            )
          }
          label="Tu"
        >
          {d.type === "tv_show"
            ? // Pentru un serial, "văzut" n-ar spune nimic util — un episod
              // din 36 e tot "văzut".
              `${watchedEpisodes} din ${d.episodes.length} episoade`
            : d.watchedByMe
              ? d.watchedByMeAt
                ? `văzut ${dayTimeLabel(d.watchedByMeAt)}`
                : "văzut"
              : "nevăzut"}
        </InfoRow>
        {d.type === "tv_show" && d.episodes.length > 0 && (
          <div className="px-3 pb-2.5">
            <div className="h-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-emerald-400/80"
                style={{ width: `${(watchedEpisodes / d.episodes.length) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>
      {d.watchedByOthers.length === 0 ? (
        <InfoRow icon={<Users className="h-3.5 w-3.5" />} label="Alții">
          <span className="text-muted-foreground">nimeni încă</span>
        </InfoRow>
      ) : (
        <div className="px-3 py-2">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            Au mai văzut
            <span className="text-[10px]">({d.watchedByOthers.length})</span>
          </div>
          <div className="mt-1.5 space-y-1 pl-5">
            {others.map((u) => (
              <div key={u.username} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-medium">{u.username}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {dayTimeLabel(u.viewedAt)}
                </span>
              </div>
            ))}
            {(hidden > 0 || showAll) && d.watchedByOthers.length > OTHERS_VISIBLE && (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="text-[11px] font-medium text-foreground/80 transition-colors hover:text-foreground"
              >
                {showAll ? "mai puțin" : `încă ${hidden}`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function InfoRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-3 py-2">
      <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="min-w-0 text-right text-foreground">{children}</span>
    </div>
  );
}

// Descrierea, tăiată la trei rânduri. „mai mult” apare doar dacă chiar a
// tăiat ceva — măsurat după randare, nu ghicit după numărul de caractere.
function ClampedSummary({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !expanded) setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [text, expanded]);
  return (
    <div className="text-xs text-muted-foreground leading-relaxed">
      <div ref={ref} className={expanded ? "" : "line-clamp-3"}>
        {text}
      </div>
      {(clamped || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 font-medium text-foreground/80 hover:text-foreground transition-colors"
        >
          {expanded ? "mai puțin" : "mai mult"}
        </button>
      )}
    </div>
  );
}

// Rândul „Urmează…” din cardul de episoade noi — fără card propriu, stă în
// cel al urmăririi. `trailing` e alegerea calității, în dreapta rândului.
function NextEpisodeLine({ detail, trailing }: { detail: PlexTitleDetail; trailing?: ReactNode }) {
  const when = nextEpisodeWhen(detail.nextEpisodeAirDate, detail.nextEpisodeAirstamp);

  let content: ReactNode;
  if (detail.tvStatus === "Ended" && !when) {
    // Serial încheiat: spunem asta explicit, în loc să lăsăm un gol care ar
    // putea fi citit drept "încă n-am aflat".
    content = (
      <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
        <CheckCheck className="h-3.5 w-3.5 shrink-0" />
        Serial încheiat — nu mai urmează episoade
      </span>
    );
  } else if (!when || !detail.nextEpisode) {
    content = (
      <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
        <CalendarClock className="h-3.5 w-3.5 shrink-0" />
        Niciun episod nou anunțat încă
      </span>
    );
  } else {
    // „Curând” (azi – poimâine) iese în evidență: fundal colorat.
    content = (
      <span
        className={`flex min-w-0 items-center gap-2 ${
          when.soon
            ? "-mx-1 rounded-lg bg-primary/10 px-1 py-1 text-foreground"
            : "text-muted-foreground"
        }`}
      >
        <CalendarClock
          className={`h-3.5 w-3.5 shrink-0 ${when.soon ? "animate-pulse text-primary" : ""}`}
        />
        <span>
          Urmează <span className="font-medium text-foreground">{detail.nextEpisode}</span> ·{" "}
          {when.text}
        </span>
      </span>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      {content}
      {trailing}
    </div>
  );
}
