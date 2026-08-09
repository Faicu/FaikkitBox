import { useEffect, useRef, useState } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import {
  Search,
  Loader2,
  Film,
  Tv,
  CheckCircle2,
  Download,
  Pin,
  ArrowLeft,
  Layers,
  Clapperboard,
  ListChecks,
  Check,
} from "lucide-react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { pinnedItemsQuery } from "@/lib/queries";
import { searchTmdb, getTmdbDetails, getTmdbSeasonEpisodes } from "@/lib/tmdb.functions";
import type { TmdbEpisode } from "@/lib/tmdb.functions";
import type { TmdbSearchResult } from "@/lib/tmdb.functions";
import { checkPlexHasTitle, getPlexEpisodesInSeason } from "@/lib/services.functions";
import { checkFilelistForItem, downloadFilelist } from "@/lib/filelist.functions";
import type { FilelistTorrent } from "@/lib/filelist.functions";
import { setPinnedItems, setWatchSettings } from "@/lib/pinned.functions";
import { detectQuality, groupTorrentsBySeasonEpisode } from "@/components/lansari/utils";
import type { QualitySet } from "@/components/lansari/types";

type Quality = "1080p" | "4K" | "4K HDR";
type Step = "search" | "checking" | "tv-scope" | "result" | "done";
type TvScope = "series" | "season" | "episode";

interface CheckResult {
  imdbId: string | null;
  originalTitle: string;
  plexFound: boolean;
  plexQuality: string | null;
  torrents: FilelistTorrent[];
  seasons: Array<{ seasonNumber: number; episodeCount: number }>;
}

function pickFromSet(set: QualitySet, quality: Quality): FilelistTorrent[] {
  if (quality === "1080p") return set.t1080;
  if (quality === "4K") return set.t4k;
  return set.t4kHdr;
}

function bestOf(list: FilelistTorrent[]): FilelistTorrent | null {
  return list.length ? [...list].sort((a, b) => b.seeders - a.seeders)[0] : null;
}

function hasAny(set: QualitySet): boolean {
  return set.t1080.length > 0 || set.t4k.length > 0 || set.t4kHdr.length > 0;
}

function bestTorrentForQuality(
  torrents: FilelistTorrent[],
  quality: Quality,
): FilelistTorrent | null {
  return bestOf(
    torrents.filter((t) => {
      const q = detectQuality(t.name);
      if (quality === "1080p") return q.is1080p;
      if (quality === "4K") return q.is4k;
      return q.is4kHdr;
    }),
  );
}

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
  const queryClient = useQueryClient();
  const { data: pinned = [] } = useQuery(pinnedItemsQuery);

  const searchFn = useServerFn(searchTmdb);
  const detailsFn = useServerFn(getTmdbDetails);
  const plexFn = useServerFn(checkPlexHasTitle);
  const plexSeasonFn = useServerFn(getPlexEpisodesInSeason);
  const filelistFn = useServerFn(checkFilelistForItem);
  const episodesFn = useServerFn(getTmdbSeasonEpisodes);
  const downloadFn = useServerFn(downloadFilelist);
  const setPinnedFn = useServerFn(setPinnedItems);
  const setWatchFn = useServerFn(setWatchSettings);

  const [step, setStep] = useState<Step>("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TmdbSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<TmdbSearchResult | null>(null);
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  const [quality, setQuality] = useState<Quality>("1080p");
  const [tvScope, setTvScope] = useState<TvScope>("series");
  const [tvSeason, setTvSeason] = useState<number | null>(null);
  const [tvEpisode, setTvEpisode] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);
  // Numerele episoadelor din sezonul ales care sunt deja în Plex — null
  // înainte de verificare (sau când scopul e "serial complet", unde nu
  // verificăm per-sezon). Populat în proceedToResult().
  const [plexSeasonEpisodes, setPlexSeasonEpisodes] = useState<number[] | null>(null);
  const [checkingPlexSeason, setCheckingPlexSeason] = useState(false);
  // Titlurile episoadelor sezonului ales (RO, cu fallback EN din server) —
  // cheia ține evidența pentru ce sezon sunt încărcate, ca să nu arătăm
  // titluri vechi cât timp se încarcă cele noi.
  const [episodeTitles, setEpisodeTitles] = useState<{
    season: number;
    episodes: TmdbEpisode[];
  } | null>(null);
  const [loadingEpisodeTitles, setLoadingEpisodeTitles] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function reset() {
    setStep("search");
    setQuery("");
    setResults([]);
    setSelected(null);
    setCheckResult(null);
    setQuality("1080p");
    setTvScope("series");
    setTvSeason(null);
    setTvEpisode(null);
    setBusy(false);
    setDoneMessage(null);
    setPlexSeasonEpisodes(null);
    setCheckingPlexSeason(false);
    setEpisodeTitles(null);
    setLoadingEpisodeTitles(false);
  }

  // Încarcă titlurile episoadelor sezonului ales (folosit la alegerea unui
  // episod anume și la afișarea titlului episodului în rezultat) — pornit
  // odată cu alegerea sezonului, nu abia la Continuă, ca lista de episoade
  // să aibă deja titlurile când utilizatorul ajunge acolo.
  async function selectSeason(seasonNumber: number) {
    setTvSeason(seasonNumber);
    setTvEpisode(null);
    if (!selected) return;
    setLoadingEpisodeTitles(true);
    try {
      const episodes = await episodesFn({ data: { tmdbId: selected.id, seasonNum: seasonNumber } });
      setEpisodeTitles({ season: seasonNumber, episodes });
    } catch {
      setEpisodeTitles({ season: seasonNumber, episodes: [] });
    } finally {
      setLoadingEpisodeTitles(false);
    }
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

  function onQueryChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = value.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        setResults(await searchFn({ data: { query: q } }));
      } finally {
        setSearching(false);
      }
    }, 400);
  }

  async function selectItem(item: TmdbSearchResult) {
    setSelected(item);
    setStep("checking");
    try {
      const details = await detailsFn({ data: { id: item.id, mediaType: item.mediaType } });
      const originalTitle = details.literalTitle || details.originalTitle || item.originalTitle;
      const [plexRes, filelistRes] = await Promise.all([
        plexFn({ data: { title: item.title, originalTitle, mediaType: item.mediaType } }),
        filelistFn({
          data: {
            title: item.title,
            originalTitle,
            imdbId: details.imdbId,
            mediaType: item.mediaType,
          },
        }),
      ]);
      const seasons = details.seasons
        .filter((s) => s.seasonNumber > 0)
        .map((s) => ({ seasonNumber: s.seasonNumber, episodeCount: s.episodeCount }));
      setCheckResult({
        imdbId: details.imdbId,
        originalTitle,
        plexFound: !!plexRes?.found,
        plexQuality: plexRes?.quality ?? null,
        torrents: filelistRes.status === "ok" ? filelistRes.torrents : [],
        seasons,
      });
      // Pentru seriale, "există în Plex" e la nivel de titlu — nu spune nimic
      // despre sezonul/episodul cerut (un serial în producție poate avea
      // sezoane vechi complete și unul nou parțial). Mergem mereu la alegerea
      // scopului; verificarea Plex per-sezon/episod se face după alegere,
      // în proceedToResult().
      if (item.mediaType === "tv") {
        setStep("tv-scope");
      } else {
        setStep("result");
      }
    } catch (e) {
      toast.error("Eroare la verificare", {
        description: e instanceof Error ? e.message : String(e),
      });
      setCheckResult({
        imdbId: null,
        originalTitle: item.originalTitle,
        plexFound: false,
        plexQuality: null,
        torrents: [],
        seasons: [],
      });
      setStep("result");
    }
  }

  async function downloadNow(torrent: FilelistTorrent) {
    setBusy(true);
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
        },
      });
      if (res.status === "ok") {
        toast.success("Adăugat în qBittorrent!", {
          id: toastId,
          description: `${torrent.name} → ${res.savePath}`,
          duration: 6000,
        });
        queryClient.invalidateQueries({ queryKey: ["filelistLog"] });
        return true;
      }
      toast.error("Eroare la descărcare", { id: toastId, description: res.error, duration: 8000 });
      return false;
    } catch (e) {
      toast.error("Eroare neașteptată", {
        id: toastId,
        description: e instanceof Error ? e.message : String(e),
        duration: 8000,
      });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function downloadOne(torrent: FilelistTorrent) {
    if (await downloadNow(torrent)) {
      setDoneMessage(`„${torrent.name}” a fost adăugat în qBittorrent.`);
      setStep("done");
    }
  }

  // "Serial complet" — descarcă în serie (nu paralel, ca să nu suprasolicităm
  // qBittorrent/autentificarea) pachetul de sezon găsit pentru fiecare sezon
  // detectat pe Filelist la calitatea aleasă; sezoanele fără pachet disponibil
  // rămân nedescărcate (afișate separat), nu improvizăm cu episoade individuale.
  async function downloadAllAvailableSeasons(
    seasonPacks: Array<{ season: number; torrent: FilelistTorrent }>,
  ) {
    setBusy(true);
    let okCount = 0;
    for (const { torrent } of seasonPacks) {
      // eslint-disable-next-line no-await-in-loop
      if (await downloadNow(torrent)) okCount++;
    }
    setBusy(false);
    if (okCount > 0) {
      toast.success(`${okCount}/${seasonPacks.length} sezoane adăugate în qBittorrent`);
      setDoneMessage(`${okCount}/${seasonPacks.length} sezoane adăugate în qBittorrent.`);
      setStep("done");
    }
  }

  async function pinForMonitoring() {
    if (!selected || !checkResult) return;
    setBusy(true);
    try {
      const alreadyPinned = pinned.some(
        (p) => p.id === selected.id && p.mediaType === selected.mediaType,
      );
      if (!alreadyPinned) {
        const next = [
          ...pinned,
          {
            id: selected.id,
            mediaType: selected.mediaType,
            title: selected.title,
            originalTitle: checkResult.originalTitle,
            posterUrl: selected.posterUrl ?? null,
          },
        ];
        await setPinnedFn({ data: { items: next } });
      }
      await setWatchFn({
        data: {
          id: selected.id,
          mediaType: selected.mediaType,
          watchFilelist: true,
          watchFilelistSeason: false,
          watchTmdb: false,
          watchPlex: false,
          autoDownload: true,
          autoDownloadQuality: quality,
        },
      });
      queryClient.invalidateQueries({ queryKey: ["pinnedItems"] });
      toast.success("Fixat pentru monitorizare automată", {
        description: `Se descarcă automat orice sezon nou apărut, la calitatea ${quality}.`,
        duration: 6000,
      });
      setDoneMessage(
        `Fixat pentru monitorizare automată — se descarcă orice sezon nou apărut, la calitatea ${quality}.`,
      );
      setStep("done");
    } catch (e) {
      toast.error("Eroare la fixare", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  const isTv = selected?.mediaType === "tv";
  const seasonGroups = checkResult ? groupTorrentsBySeasonEpisode(checkResult.torrents) : [];
  const selectedSeasonGroup = seasonGroups.find((g) => g.seasonNum === tvSeason) ?? null;
  const selectedSeasonMeta = checkResult?.seasons.find((s) => s.seasonNumber === tvSeason) ?? null;
  const availableSeasonsCount =
    checkResult?.seasons.filter((s) => {
      const g = seasonGroups.find((sg) => sg.seasonNum === s.seasonNumber);
      return g && hasAny(g.byQuality);
    }).length ?? 0;

  // Rezultatul concret de arătat la pasul final, în funcție de tip și scop.
  const movieMatch =
    !isTv && checkResult ? bestTorrentForQuality(checkResult.torrents, quality) : null;
  const seasonMatch =
    isTv && tvScope === "season" && selectedSeasonGroup
      ? bestOf(pickFromSet(selectedSeasonGroup.byQuality, quality))
      : null;
  const episodeMatch =
    isTv && tvScope === "episode" && selectedSeasonGroup && tvEpisode
      ? bestOf(
          pickFromSet(
            selectedSeasonGroup.episodes.get(tvEpisode) ?? { t1080: [], t4k: [], t4kHdr: [] },
            quality,
          ),
        )
      : null;
  const seriesPacks =
    isTv && tvScope === "series" && checkResult
      ? checkResult.seasons
          .map((s) => {
            const g = seasonGroups.find((sg) => sg.seasonNum === s.seasonNumber);
            const torrent = g ? bestOf(pickFromSet(g.byQuality, quality)) : null;
            return torrent ? { season: s.seasonNumber, torrent } : null;
          })
          .filter((x): x is { season: number; torrent: FilelistTorrent } => x !== null)
      : [];
  const seriesMissingSeasons =
    isTv && tvScope === "series" && checkResult
      ? checkResult.seasons
          .map((s) => s.seasonNumber)
          .filter((sn) => !seriesPacks.some((p) => p.season === sn))
      : [];

  // Pentru filme, "există în Plex" e suficient (verificare atomică). Pentru
  // seriale, folosim strict verificarea per-sezon/episod făcută la
  // proceedToResult() — nu checkResult.plexFound (la nivel de titlu, ar
  // bloca greșit un serial în producție care are doar sezoane vechi complete).
  const plexSeasonComplete =
    isTv &&
    tvScope === "season" &&
    plexSeasonEpisodes !== null &&
    !!selectedSeasonMeta &&
    plexSeasonEpisodes.length >= selectedSeasonMeta.episodeCount;
  const plexEpisodeDone =
    isTv &&
    tvScope === "episode" &&
    plexSeasonEpisodes !== null &&
    tvEpisode !== null &&
    plexSeasonEpisodes.includes(tvEpisode);
  const alreadyInPlex =
    (!isTv && !!checkResult?.plexFound) || plexSeasonComplete || plexEpisodeDone;

  const showQualityAndAction = !!checkResult && !alreadyInPlex;

  // Navigare "înapoi" reală (nu doar reset complet) — revine la pasul
  // anterior semnificativ din flux, păstrând căutarea/rezultatele deja
  // încărcate acolo unde are sens. Când wizard-ul e deschis prefill (din
  // Descoperă), nu există pas de căutare la care să te întorci — înapoi
  // închide direct.
  function goBack() {
    if (initialItem) {
      handleClose();
      return;
    }
    if (step === "tv-scope") {
      setStep("search");
      setSelected(null);
      setCheckResult(null);
      setTvScope("series");
      setTvSeason(null);
      setTvEpisode(null);
      return;
    }
    if (step === "result") {
      if (isTv) {
        setPlexSeasonEpisodes(null);
        setStep("tv-scope");
        return;
      }
      setStep("search");
      setSelected(null);
      setCheckResult(null);
      return;
    }
  }

  // Verifică Plex strict pentru sezonul ales (nu tot serialul) înainte de a
  // trece la rezultat — un serial în producție poate avea sezoane vechi
  // complete în Plex și sezonul curent doar parțial, deci "serialul există
  // în Plex" (verificare de titlu, la pasul anterior) nu spune nimic despre
  // sezonul/episodul cerut acum.
  async function proceedToResult() {
    if ((tvScope === "season" || tvScope === "episode") && tvSeason !== null && checkResult) {
      setCheckingPlexSeason(true);
      try {
        const eps = await plexSeasonFn({
          data: { showTitle: checkResult.originalTitle, season: tvSeason },
        });
        setPlexSeasonEpisodes(eps.map((e) => e.num));
      } catch {
        setPlexSeasonEpisodes([]);
      } finally {
        setCheckingPlexSeason(false);
      }
    } else {
      setPlexSeasonEpisodes(null);
    }
    setStep("result");
  }

  // Pașii afișați în indicatorul de progres — dinamici, în funcție de tip
  // (serialele au un pas în plus, "Scop") și de faptul că pasul de căutare
  // e sărit când wizard-ul a fost deschis prefill.
  const stepperSteps: Array<{ key: Step; label: string }> = [
    ...(initialItem ? [] : [{ key: "search" as Step, label: "Căutare" }]),
    { key: "checking", label: "Verificare" },
    ...(isTv ? [{ key: "tv-scope" as Step, label: "Scop" }] : []),
    { key: "result", label: "Rezultat" },
  ];
  const effectiveStep = step === "search" && initialItem ? "checking" : step;
  const stepperIndex = stepperSteps.findIndex((s) => s.key === effectiveStep);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="top-8 flex max-h-[calc(100dvh-4rem)] w-[calc(100%-2rem)] max-w-md translate-y-0 flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:w-full">
        <DialogHeader className="shrink-0 space-y-0 p-4 pb-0 text-left">
          <div className="flex items-center gap-2">
            {(step === "result" || step === "tv-scope") && (
              <button
                type="button"
                onClick={goBack}
                className="shrink-0 rounded-lg p-1 text-muted-foreground hover:text-foreground hover:bg-muted/60"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <DialogTitle className="flex-1 pr-6">Adaugă film/serial</DialogTitle>
          </div>
          {step !== "done" && stepperSteps.length > 1 && (
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
            <div className="animate-in fade-in slide-in-from-left-2 duration-200 space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => onQueryChange(e.target.value)}
                  placeholder="Introdu titlul (ca pe IMDb)..."
                  className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:ring-1 focus:ring-primary"
                />
                {searching && (
                  <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                )}
              </div>

              {results.length > 0 && (
                <div className="space-y-1.5">
                  {results.map((r) => (
                    <button
                      key={`${r.mediaType}-${r.id}`}
                      type="button"
                      onClick={() => selectItem(r)}
                      className="flex w-full items-center gap-2 rounded-xl bg-muted/60 p-2 text-left hover:bg-muted/80 transition-colors"
                    >
                      {r.posterUrl ? (
                        <img
                          src={r.posterUrl}
                          alt=""
                          className="h-12 w-8 rounded object-cover shrink-0"
                        />
                      ) : (
                        <div className="h-12 w-8 rounded bg-muted shrink-0 flex items-center justify-center">
                          {r.mediaType === "movie" ? (
                            <Film className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <Tv className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${r.mediaType === "movie" ? "bg-amber-500/15 text-amber-400" : "bg-blue-500/15 text-blue-400"}`}
                          >
                            {r.mediaType === "movie" ? "Film" : "Serial"}
                          </span>
                          <span className="truncate text-sm font-medium">{r.title}</span>
                        </div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">
                          {[r.originalTitle !== r.title ? r.originalTitle : null, r.year]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {(step === "checking" || (step === "search" && initialItem)) && (
            <div className="animate-in fade-in duration-200 space-y-4">
              <div className="relative h-28 animate-pulse overflow-hidden rounded-2xl bg-muted/40" />
              <div className="space-y-2">
                <div className="h-4 w-2/3 animate-pulse rounded bg-muted/40" />
                <div className="h-3 w-1/3 animate-pulse rounded bg-muted/40" />
              </div>
              <div className="flex items-center justify-center gap-2 pt-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Verific Plex și Filelist pentru „{selected?.title ?? initialItem?.title}”…
              </div>
            </div>
          )}

          {step === "tv-scope" && selected && checkResult && (
            <div className="animate-in fade-in slide-in-from-right-2 duration-200 space-y-4">
              <PosterHero
                posterUrl={selected.posterUrl}
                mediaType={selected.mediaType}
                title={selected.title}
                subtitle={checkResult.originalTitle}
              />
              <div className="text-sm text-muted-foreground">
                Ce vrei să descarci din{" "}
                <span className="font-medium text-foreground">{selected.title}</span>?
              </div>
              <div className="space-y-2">
                <ScopeOption
                  icon={<Layers className="h-4 w-4" />}
                  label="Serial complet"
                  description={`${availableSeasonsCount}/${checkResult.seasons.length} sezoane au deja pachet pe Filelist`}
                  meta={`${checkResult.seasons.length} sezoane`}
                  active={tvScope === "series"}
                  onClick={() => setTvScope("series")}
                />
                <ScopeOption
                  icon={<Clapperboard className="h-4 w-4" />}
                  label="Un sezon anume"
                  description="Alege sezonul de mai jos"
                  meta={`${availableSeasonsCount}/${checkResult.seasons.length} disponibile`}
                  active={tvScope === "season"}
                  onClick={() => setTvScope("season")}
                />
                <ScopeOption
                  icon={<Film className="h-4 w-4" />}
                  label="Un episod anume"
                  description="Alege sezonul și episodul"
                  active={tvScope === "episode"}
                  onClick={() => setTvScope("episode")}
                />
              </div>

              {(tvScope === "season" || tvScope === "episode") && (
                <div>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Sezon
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {checkResult.seasons.map((s) => {
                      const g = seasonGroups.find((sg) => sg.seasonNum === s.seasonNumber);
                      const available = !!g && hasAny(g.byQuality);
                      return (
                        <button
                          key={s.seasonNumber}
                          type="button"
                          onClick={() => selectSeason(s.seasonNumber)}
                          className={`relative rounded-lg border px-2.5 py-1.5 text-sm font-medium transition-colors active:scale-95 ${
                            tvSeason === s.seasonNumber
                              ? "border-primary bg-primary/15 text-primary"
                              : "border-border bg-muted/40 text-muted-foreground hover:bg-muted/60"
                          }`}
                          title={available ? "Are deja pachet pe Filelist" : undefined}
                        >
                          {available && (
                            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-400" />
                          )}
                          <div className="leading-tight">
                            S{String(s.seasonNumber).padStart(2, "0")}
                          </div>
                          <div className="text-[9px] font-normal text-muted-foreground">
                            {s.episodeCount} ep
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {tvScope === "episode" && selectedSeasonMeta && (
                <div>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Episod
                  </div>
                  {loadingEpisodeTitles && episodeTitles?.season !== tvSeason ? (
                    <div className="space-y-1.5">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="h-11 animate-pulse rounded-lg bg-muted/40" />
                      ))}
                    </div>
                  ) : (
                    <div className="max-h-56 space-y-1.5 overflow-y-auto pr-0.5">
                      {Array.from({ length: selectedSeasonMeta.episodeCount }, (_, i) => i + 1).map(
                        (ep) => {
                          const available =
                            !!selectedSeasonGroup &&
                            hasAny(
                              selectedSeasonGroup.episodes.get(ep) ?? {
                                t1080: [],
                                t4k: [],
                                t4kHdr: [],
                              },
                            );
                          const epTitle =
                            episodeTitles?.season === tvSeason
                              ? episodeTitles.episodes.find((e) => e.episodeNum === ep)?.title
                              : undefined;
                          return (
                            <button
                              key={ep}
                              type="button"
                              onClick={() => setTvEpisode(ep)}
                              className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm font-medium transition-colors active:scale-[0.98] ${
                                tvEpisode === ep
                                  ? "border-primary bg-primary/15 text-primary"
                                  : "border-border bg-muted/40 text-muted-foreground hover:bg-muted/60"
                              }`}
                              title={available ? "Are deja torrent pe Filelist" : undefined}
                            >
                              <span className="shrink-0 tabular-nums">
                                E{String(ep).padStart(2, "0")}
                              </span>
                              <span className="min-w-0 flex-1 truncate">
                                {epTitle ?? `Episodul ${ep}`}
                              </span>
                              {available && (
                                <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
                              )}
                            </button>
                          );
                        },
                      )}
                    </div>
                  )}
                </div>
              )}

              <button
                type="button"
                disabled={
                  (tvScope === "season" && tvSeason === null) ||
                  (tvScope === "episode" && (tvSeason === null || tvEpisode === null)) ||
                  checkingPlexSeason
                }
                onClick={proceedToResult}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-40"
              >
                {checkingPlexSeason && <Loader2 className="h-4 w-4 animate-spin" />}
                Continuă
              </button>
            </div>
          )}

          {step === "result" && selected && checkResult && (
            <div className="animate-in fade-in slide-in-from-right-2 duration-200 space-y-4">
              <PosterHero
                posterUrl={selected.posterUrl}
                mediaType={selected.mediaType}
                title={
                  selected.title +
                  (isTv && tvScope === "season" && tvSeason
                    ? ` — S${String(tvSeason).padStart(2, "0")}`
                    : "") +
                  (isTv && tvScope === "episode" && tvSeason && tvEpisode
                    ? ` — S${String(tvSeason).padStart(2, "0")}E${String(tvEpisode).padStart(2, "0")}`
                    : "")
                }
                subtitle={
                  isTv && tvScope === "episode" && episodeTitles?.season === tvSeason && tvEpisode
                    ? (episodeTitles.episodes.find((e) => e.episodeNum === tvEpisode)?.title ??
                      checkResult.originalTitle)
                    : checkResult.originalTitle + (selected.year ? ` · ${selected.year}` : "")
                }
              />

              {alreadyInPlex ? (
                <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-400">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  {!isTv && "Deja în bibliotecă Plex"}
                  {!isTv && checkResult.plexQuality ? ` — ${checkResult.plexQuality}` : ""}
                  {isTv && tvScope === "season" && `Sezonul ${tvSeason} e deja complet în Plex`}
                  {isTv &&
                    tvScope === "episode" &&
                    `Episodul S${String(tvSeason).padStart(2, "0")}E${String(tvEpisode).padStart(2, "0")} e deja în Plex`}
                </div>
              ) : (
                showQualityAndAction && (
                  <>
                    {isTv &&
                      tvScope === "season" &&
                      selectedSeasonMeta &&
                      plexSeasonEpisodes !== null &&
                      plexSeasonEpisodes.length > 0 && (
                        <div className="rounded-xl border border-border bg-card p-3 text-xs text-muted-foreground">
                          {plexSeasonEpisodes.length}/{selectedSeasonMeta.episodeCount} episoade
                          deja în Plex — descarci pachetul complet de sezon oricum, ca să prinzi și
                          episoadele lipsă/noi.
                        </div>
                      )}
                    <div>
                      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Calitate
                      </div>
                      <div className="flex gap-2">
                        {(
                          [
                            { q: "1080p", color: "blue" },
                            { q: "4K", color: "purple" },
                            { q: "4K HDR", color: "amber" },
                          ] as const
                        ).map(({ q, color }) => {
                          const active = quality === q;
                          const styles = {
                            blue: active
                              ? "border-blue-400/70 bg-blue-500/30 text-blue-200 shadow-sm shadow-blue-500/30"
                              : "border-blue-500/40 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 hover:text-blue-300",
                            purple: active
                              ? "border-purple-400/70 bg-purple-500/30 text-purple-200 shadow-sm shadow-purple-500/30"
                              : "border-purple-500/40 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 hover:text-purple-300",
                            amber: active
                              ? "border-amber-400/70 bg-amber-500/30 text-amber-200 shadow-sm shadow-amber-500/30"
                              : "border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 hover:text-amber-300",
                          };
                          return (
                            <button
                              key={q}
                              type="button"
                              onClick={() => setQuality(q)}
                              className={`flex-1 rounded-xl border px-3 py-1.5 text-sm font-medium transition-colors active:scale-95 ${styles[color]}`}
                            >
                              {q}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Film */}
                    {!isTv && movieMatch && (
                      <DownloadAction
                        busy={busy}
                        label="Descarcă acum"
                        torrentName={movieMatch.name}
                        onClick={() => downloadOne(movieMatch)}
                      />
                    )}
                    {!isTv && !movieMatch && (
                      <NotFoundWithPin
                        quality={quality}
                        busy={busy}
                        onPin={pinForMonitoring}
                        label="filmul"
                      />
                    )}

                    {/* Sezon */}
                    {isTv && tvScope === "season" && seasonMatch && (
                      <DownloadAction
                        busy={busy}
                        label="Descarcă sezonul"
                        torrentName={seasonMatch.name}
                        onClick={() => downloadOne(seasonMatch)}
                      />
                    )}
                    {isTv && tvScope === "season" && !seasonMatch && (
                      <NotFoundWithPin
                        quality={quality}
                        busy={busy}
                        onPin={pinForMonitoring}
                        label="serialul"
                      />
                    )}

                    {/* Episod */}
                    {isTv && tvScope === "episode" && episodeMatch && (
                      <DownloadAction
                        busy={busy}
                        label="Descarcă episodul"
                        torrentName={episodeMatch.name}
                        onClick={() => downloadOne(episodeMatch)}
                      />
                    )}
                    {isTv && tvScope === "episode" && !episodeMatch && (
                      <NotFoundWithPin
                        quality={quality}
                        busy={busy}
                        onPin={pinForMonitoring}
                        label="serialul"
                      />
                    )}

                    {/* Serial complet */}
                    {isTv && tvScope === "series" && (
                      <div className="space-y-2">
                        {seriesPacks.length > 0 && (
                          <div className="rounded-xl border border-border bg-card p-3 text-sm">
                            <div className="mb-1 font-medium">Sezoane disponibile acum:</div>
                            <div className="text-muted-foreground">
                              {seriesPacks
                                .map((p) => `S${String(p.season).padStart(2, "0")}`)
                                .join(", ")}
                            </div>
                          </div>
                        )}
                        {seriesMissingSeasons.length > 0 && (
                          <div className="rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">
                            Încă nu au pachet complet la {quality}:{" "}
                            {seriesMissingSeasons
                              .map((s) => `S${String(s).padStart(2, "0")}`)
                              .join(", ")}
                          </div>
                        )}
                        {seriesPacks.length > 0 && (
                          <ActionButton
                            busy={busy}
                            icon={<Download className="h-4 w-4" />}
                            label={`Descarcă ${seriesPacks.length} sezon(oane) disponibile`}
                            onClick={() => downloadAllAvailableSeasons(seriesPacks)}
                          />
                        )}
                        {seriesMissingSeasons.length > 0 && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={pinForMonitoring}
                            className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-muted/40 py-2.5 text-sm font-semibold text-foreground hover:bg-muted/60 disabled:opacity-50"
                          >
                            {busy ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Pin className="h-4 w-4" />
                            )}
                            Fixează pentru monitorizare automată ({quality})
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )
              )}
            </div>
          )}

          {step === "done" && (
            <div className="animate-in fade-in zoom-in-95 duration-300 flex flex-col items-center gap-4 py-8 text-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-400" />
              <p className="text-sm text-muted-foreground">{doneMessage}</p>
              <div className="flex w-full flex-col gap-2">
                <Link
                  to="/lansari"
                  onClick={handleClose}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground"
                >
                  <ListChecks className="h-4 w-4" /> Vezi în Lansări
                </Link>
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-muted/40 py-2.5 text-sm font-semibold text-foreground hover:bg-muted/60"
                >
                  Închide
                </button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ScopeOption({
  icon,
  label,
  description,
  meta,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  meta?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors active:scale-[0.98] ${
        active ? "border-primary bg-primary/10" : "border-border bg-muted/40 hover:bg-muted/60"
      }`}
    >
      <span className={active ? "text-primary" : "text-muted-foreground"}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      {meta && (
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {meta}
        </span>
      )}
    </button>
  );
}

function ActionButton({
  busy,
  icon,
  label,
  onClick,
}: {
  busy: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {label}
    </button>
  );
}

// Numele torrentului merge SUB buton, nu în el — un nume lung fără spații
// (ex. "Game.of.Thrones.S05.1080p...") nu are unde să se rupă în interiorul
// unui buton flex, forțând scroll orizontal pe tot drawer-ul.
function DownloadAction({
  busy,
  label,
  torrentName,
  onClick,
}: {
  busy: boolean;
  label: string;
  torrentName: string;
  onClick: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <ActionButton
        busy={busy}
        icon={<Download className="h-4 w-4" />}
        label={label}
        onClick={onClick}
      />
      <p className="break-all text-center text-xs text-muted-foreground">{torrentName}</p>
    </div>
  );
}

function NotFoundWithPin({
  quality,
  busy,
  onPin,
  label,
}: {
  quality: Quality;
  busy: boolean;
  onPin: () => void;
  label: "filmul" | "serialul";
}) {
  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">
        Nu există încă la calitatea {quality} pe Filelist.
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={onPin}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-muted/40 py-2.5 text-sm font-semibold text-foreground hover:bg-muted/60 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pin className="h-4 w-4" />}
        Fixează {label} pentru monitorizare automată ({quality})
      </button>
    </div>
  );
}

function PosterHero({
  posterUrl,
  mediaType,
  title,
  subtitle,
}: {
  posterUrl: string | null;
  mediaType: "movie" | "tv";
  title: string;
  subtitle: string;
}) {
  return (
    <div className="relative h-28 overflow-hidden rounded-2xl bg-muted/60">
      {posterUrl && (
        <img
          src={posterUrl}
          alt=""
          className="absolute inset-0 h-full w-full scale-110 object-cover opacity-30 blur-md"
        />
      )}
      <div className="relative flex h-full items-center gap-3 p-3">
        {posterUrl ? (
          <img
            src={posterUrl}
            alt=""
            className="h-full w-16 shrink-0 rounded-lg object-cover shadow-lg"
          />
        ) : (
          <div className="flex h-full w-16 shrink-0 items-center justify-center rounded-lg bg-muted">
            {mediaType === "movie" ? (
              <Film className="h-5 w-5 text-muted-foreground" />
            ) : (
              <Tv className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <span
            className={`mb-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${
              mediaType === "movie"
                ? "bg-amber-500/15 text-amber-400"
                : "bg-blue-500/15 text-blue-400"
            }`}
          >
            {mediaType === "movie" ? "Film" : "Serial"}
          </span>
          <div className="truncate text-base font-bold leading-tight">{title}</div>
          <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
        </div>
      </div>
    </div>
  );
}
