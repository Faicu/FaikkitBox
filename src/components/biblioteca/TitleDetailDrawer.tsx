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
  Search,
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
import { FileReport } from "@/components/tehnic/SubtitleFixDrawer";
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
import { BorderFlowSweep } from "@/components/BorderFlowSweep";
import { ScheduledDeleteCard } from "./ScheduledDelete";

// Peste prag, „Se procesează” nu mai e o scanare Plex în curs (legarea reușește
// de obicei în primul minut).
const PROCESSING_HINT_AFTER_MS = 30 * 60 * 1000;

// Drawer-ul de detalii al unui titlu — independent de listă: primește doar
// mediaId și își ține singur starea. Confirmarea ștergerii complete stă la
// nivelul listei, ca overlay simplu (un AlertDialog Radix imbricat îngheață
// ecranul, c76ce30).
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
    // Ștergerea doar se programează până atunci (formatul SQLite, UTC).
    delayedUntil: string | null;
    // Admin: confirmarea oferă și ștergerea pe loc.
    canDeleteImmediately: boolean;
    // Ștergerea e deja programată — confirmarea e doar pentru „Șterge acum”.
    alreadyScheduled: boolean;
  }) => void;
}) {
  const queryClient = useQueryClient();
  const [correcting, setCorrecting] = useState(false);
  const [deletingSubtitle, setDeletingSubtitle] = useState(false);
  const [showTech, setShowTech] = useState(false);
  // Serial → episod în ACELAȘI drawer, cu buton înapoi — un overlay Radix
  // imbricat în vaul îngheață ecranul (c76ce30). Perechea (serial, episod), nu
  // doar episodul: ștergerea pune mediaId pe null din afară, fără onOpenChange,
  // iar episodul rămânea agățat pentru următorul titlu deschis.
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

  // Serialul rămâne titlul de bază; un episod deschis devine subiectul. Fără
  // titlu de bază (șters), episodul nu mai are context.
  const openEpisodeId = openEpisode?.showId === mediaId ? openEpisode.episodeId : null;
  const activeId = mediaId == null ? null : (openEpisodeId ?? mediaId);

  const detail = useQuery({
    queryKey: ["plexTitleDetail", activeId],
    queryFn: () => getPlexTitleDetail({ data: { mediaId: activeId! } }),
    enabled: !!activeId,
    // Progres live cât titlul se descarcă sau așteaptă indexarea; se oprește la
    // "in_library". La seriale, pulsul rapid doar cât măcar un episod are un
    // procent care urcă — un episod blocat definitiv ținea altfel pulsul de
    // 2,5s pornit la nesfârșit.
    refetchInterval: (query) => {
      const d = query.state.data;
      if (d?.status !== "ok") return false;
      const { status, type } = d.detail;
      if (status !== "downloading" && status !== "processing") return false;
      if (type !== "tv_show") return 2500;
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
    // Ambele niveluri: o schimbare pe episod se vede și în lista serialului.
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

  // Principala și rezerva se trimit împreună: două calități identice lasă
  // serialul fără rezervă (effectiveFallback).
  async function setWatchQualities(quality: string, fallbackQuality: string | null) {
    if (!d) return;
    setSavingWatch(true);
    // Fără "backfill": schimbarea calității nu mută punctul de pornire înapoi.
    // Eroarea se raportează — înghițită, calitatea părea schimbată până la
    // refetch-ul care o dădea înapoi.
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
        // Motivul contează: „lipsesc 3 episoade, dar niciun torrent 1080p” ≠ „ești
        // la zi”.
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
                  {d.originalTitle &&
                    d.originalTitle !== (d.type === "movie" ? d.title : (d.show ?? d.title)) && (
                      // pr-1: `truncate` ar tăia aplecarea ultimei litere italice.
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
                  {/* Ține de FIȘIER (film, episod, pachet), nu de serial; doar
                      descărcările noi au ID-ul. */}
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
              {/* Cadrul episodului, în partea care se derulează — în antetul fix
                  ocupa prea mult. */}
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
                  {/* Episoadele noi într-un card: când apare următorul și dacă
                      ajunge singur în bibliotecă. */}
                  <div
                    className={`rounded-xl border border-border bg-muted/30 p-3 space-y-2 ${d.autoDownload ? "border-flow" : ""}`}
                  >
                    {d.autoDownload && <BorderFlowSweep />}
                    {/* Butoanele lipsesc la serialele încheiate, DAR nu și când
                        urmărirea e pornită (altfel n-ai cum s-o oprești). Fără
                        drepturi: starea se vede, fără butoane. */}
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

                    {/* Următorul episod, din `media` (TMDB + ora TVmaze), redat în
                        ora browserului. În dreapta, calitatea. */}
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

                    {/* Calitățile inline, nu Popover/Select Radix — un overlay
                        imbricat în vaul îngheață ecranul (c76ce30). */}
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

                    {/* Punctul de pornire, explicit: „recuperează tot” poate
                        însemna zeci de episoade deodată. */}
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

                  {/* Cine l-a adus și cine l-a văzut, apoi episoadele; detaliile
                      tehnice la coadă. */}
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
                        // Cu raport structurat, sursa și detaliul sunt mai jos.
                        !d.tech.subtitleReport &&
                          d.tech.subtitleSource && [
                            "Sursă subtitrare",
                            subtitleSourceDisplay(d.tech.subtitleSource),
                          ],
                        !d.tech.subtitleReport &&
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
                        // Valorile lungi (detaliul subtitrării, torrentul) trec sub
                        // etichetă, pe toată lățimea, aliniate la stânga;
                        // `wrap-anywhere` rupe și șirurile fără spații.
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
                      {d.tech.subtitleReport && (
                        <div className="mt-1 flex flex-col gap-1.5 border-t border-border/60 pt-1.5">
                          <span className="text-muted-foreground">Subtitrare</span>
                          <FileReport
                            file={d.tech.subtitleReport.file}
                            rejected={d.tech.subtitleReport.rejected}
                            showEpisode={false}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {d.type !== "tv_show" && (
                <div className="flex flex-col gap-2 pt-1 border-t border-border">
                  {/* Pentru oricine: oricine poate renunța la ștergere. */}
                  {d.torrentHash && d.deleteScheduled && (
                    <div className="pt-2">
                      <ScheduledDeleteCard
                        mediaId={d.mediaId}
                        at={d.deleteScheduled.at}
                        byUsername={d.deleteScheduled.byUsername}
                        isCancel={d.status === "downloading"}
                        onCancelled={invalidateAfterMutation}
                        onDeleteNow={
                          d.canDeleteImmediately
                            ? () =>
                                onRequestDelete({
                                  mediaId: d.mediaId,
                                  title: d.type === "movie" ? d.title : (d.show ?? d.title),
                                  isSeasonPack: d.isSeasonPack,
                                  isCancel: d.status === "downloading",
                                  delayedUntil: d.deleteScheduled!.at,
                                  canDeleteImmediately: true,
                                  alreadyScheduled: true,
                                })
                            : undefined
                        }
                      />
                    </div>
                  )}
                  {d.torrentHash ? (
                    d.canManage ? (
                      d.status === "downloading" ? (
                        d.deleteScheduled ? null : (
                          <button
                            type="button"
                            onClick={() =>
                              onRequestDelete({
                                mediaId: d.mediaId,
                                title: d.type === "movie" ? d.title : (d.show ?? d.title),
                                isSeasonPack: d.isSeasonPack,
                                isCancel: true,
                                delayedUntil: d.deleteDelayedUntil,
                                canDeleteImmediately: d.canDeleteImmediately,
                                alreadyScheduled: false,
                              })
                            }
                            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-muted/40 py-2 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            Anulare
                          </button>
                        )
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
                          {!d.deleteScheduled && (
                            <button
                              type="button"
                              onClick={() =>
                                onRequestDelete({
                                  mediaId: d.mediaId,
                                  title: d.type === "movie" ? d.title : (d.show ?? d.title),
                                  isSeasonPack: d.isSeasonPack,
                                  isCancel: false,
                                  delayedUntil: d.deleteDelayedUntil,
                                  canDeleteImmediately: d.canDeleteImmediately,
                                  alreadyScheduled: false,
                                })
                              }
                              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-muted/40 py-2 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Șterge titlul complet
                            </button>
                          )}
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

// Cine l-a adus și cine l-a văzut, într-un card. Date scurte („28 sept.,
// 21:40”) — cele lungi rupeau rândurile pe telefon. Primii trei spectatori la
// vedere, restul la „încă N”.
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

// Descrierea, la trei rânduri; „mai mult” doar dacă a tăiat ceva (măsurat
// după randare).
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

// Rândul „Urmează…” din cardul urmăririi; `trailing` = calitatea, în dreapta.
function NextEpisodeLine({ detail, trailing }: { detail: PlexTitleDetail; trailing?: ReactNode }) {
  const when = nextEpisodeWhen(detail.nextEpisodeAirDate, detail.nextEpisodeAirstamp);

  let content: ReactNode;
  if (detail.tvStatus === "Ended" && !when) {
    // Serial încheiat — spus explicit, nu un gol care pare „încă nu știm”.
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

// Data în formatul SQLite (UTC) → „22 oct.".
function retryDay(v: string): string {
  return new Date(`${v.replace(" ", "T")}Z`).toLocaleDateString("ro-RO", {
    day: "numeric",
    month: "short",
  });
}

function SubtitleRetryLine({ retry }: { retry: NonNullable<PlexTitleDetail["subtitleRetry"]> }) {
  if (retry.state === "ended") {
    return (
      <div className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
        <CaptionsOff className="mt-px h-3 w-3 shrink-0" />
        <span>
          Căutarea automată a subtitrării s-a încheiat pe {retryDay(retry.until)} — poți încerca din
          nou cu „Corectează subtitrare”.
        </span>
      </div>
    );
  }
  // Același format ca „Verificat azi, 20:54" de la urmărirea serialelor.
  const checked = retry.lastCheckedAt
    ? ` · ${lastCheckedLabel(retry.lastCheckedAt).toLowerCase()}`
    : "";
  return (
    <div
      className={`flex items-start gap-1.5 text-[11px] leading-snug ${
        retry.kind === "approximate" ? "text-amber-400/90" : "text-teal-400/90"
      }`}
    >
      <Search className="mt-px h-3 w-3 shrink-0" />
      <span>
        {retry.kind === "approximate"
          ? "Se caută zilnic o subtitrare mai bună"
          : "Se caută zilnic subtitrare RO"}
        , până pe {retryDay(retry.until)}
        <span className="text-muted-foreground">{checked}</span>
      </span>
    </div>
  );
}
