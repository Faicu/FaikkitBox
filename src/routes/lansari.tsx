import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  Flame,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Search,
  Pin,
  PinOff,
  ExternalLink,
  Loader2,
  Download,
  Film,
  Tv,
  Users,
  Zap,
  HardDrive,
  ShieldCheck,
  History,
  Trash2,
  ChevronDown,
  ChevronRight,
  Bell,
  BellOff,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { PageShell } from "@/components/PageShell";
import { ServicePill } from "@/components/ServicePill";
import { ErrorCard } from "@/components/ErrorCard";
import { filelistLogQuery } from "@/lib/queries";
import { checkPlexHasTitle, getPlexEpisodesInSeason } from "@/lib/services.functions";
import { searchFilelist, downloadFilelist, deleteFilelistLogEntry } from "@/lib/filelist.functions";
import type { FilelistTorrent, FilelistCategory, FilelistLogEntry } from "@/lib/filelist.functions";
import { searchTmdb, getTmdbDetails, getTvShowCountdown, getTmdbSeasonEpisodes } from "@/lib/tmdb.functions";
import type { TmdbSearchResult, TmdbDetails, TvShowCountdown, TmdbEpisode } from "@/lib/tmdb.functions";
import { getPinnedItems, setPinnedItems, getWatchSettings, setWatchSettings } from "@/lib/pinned.functions";
import type { WatchSettings } from "@/lib/pinned.functions";
import { adminStatusQuery } from "@/lib/queries";

export const Route = createFileRoute("/lansari")({
  head: () => ({ meta: [{ title: "Lansări — Monitor Server" }] }),
  component: LansariPage,
});

function LansariPage() {
  return (
    <PageShell title="Lansări" subtitle="Film · Serial · Filelist">
      <UnifiedSearchSection />
      <FilelistSection />
      <DownloadLogSection />
    </PageShell>
  );
}

interface PinnedItem {
  id: number;
  mediaType: "movie" | "tv";
  title: string;
  originalTitle: string;
  posterUrl: string | null;
}

// ---------------------------------------------------------------------------
// Utilitar: elimină diacriticele pentru căutări externe (Filelist nu le suportă)
// ---------------------------------------------------------------------------

function stripDiacritics(str: string): string {
  return str.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// ---------------------------------------------------------------------------
// Detectare calitate torrent
// ---------------------------------------------------------------------------

function detectQuality(name: string) {
  const n = name.toLowerCase();
  const is4k = /2160p|4k/.test(n);
  const is4kHdr = is4k && /hdr/.test(n);
  const is1080p = /1080p/.test(n);
  return { is1080p, is4k: is4k && !is4kHdr, is4kHdr };
}

// ---------------------------------------------------------------------------
// Buton download calitate
// ---------------------------------------------------------------------------

function TorrentPickerDialog({
  label,
  torrents,
  onPick,
  onCancel,
}: {
  label: string;
  torrents: FilelistTorrent[];
  onPick: (t: FilelistTorrent) => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 space-y-3 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="text-sm font-semibold">Alege torrent {label}</div>
        <div className="space-y-2">
          {torrents.map((t) => (
            <button
              key={t.id}
              onClick={() => onPick(t)}
              className="w-full text-left rounded-xl border border-border bg-muted/40 hover:bg-muted/80 p-3 space-y-1.5 transition-colors"
            >
              <div className="text-xs font-medium break-words leading-snug">{t.name}</div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><HardDrive className="h-3 w-3" /> {formatBytes(t.size)}</span>
                <span className="flex items-center gap-1 text-emerald-400"><Users className="h-3 w-3" /> {t.seeders}</span>
                {t.freeleech && <span className="flex items-center gap-1 text-yellow-400"><Zap className="h-3 w-3" /> Freeleech</span>}
                {t.internal && <span className="flex items-center gap-1 text-purple-400"><ShieldCheck className="h-3 w-3" /> Internal</span>}
                {t.upload_date && <span>{new Date(t.upload_date).toLocaleDateString("ro-RO")}</span>}
              </div>
            </button>
          ))}
        </div>
        <button onClick={onCancel} className="w-full rounded-xl border border-border py-2 text-sm text-muted-foreground hover:bg-muted transition-colors">
          Anulează
        </button>
      </div>
    </div>
  );
}

function QualityDownloadButton({
  label,
  torrents,
  plexQuality,
  downloading,
  onDownload,
}: {
  label: string;
  torrents: FilelistTorrent[];
  plexQuality?: string | null;
  downloading: number | null;
  onDownload: (t: FilelistTorrent, label: string) => void;
}) {
  const [showPicker, setShowPicker] = useState(false);

  const inPlex = plexQuality === label;
  const available = torrents.length > 0;
  const isLoading = available && torrents.some((t) => downloading === t.id);

  const colorClass = inPlex
    ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30 opacity-70 cursor-default"
    : label === "4K HDR"
    ? "bg-purple-500/15 text-purple-400 hover:bg-purple-500/25 border-purple-500/30"
    : label === "4K"
    ? "bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 border-blue-500/30"
    : "bg-slate-500/15 text-slate-300 hover:bg-slate-500/25 border-slate-500/30";

  function handleClick() {
    if (inPlex || !available || isLoading) return;
    if (torrents.length > 1) {
      setShowPicker(true);
    } else {
      onDownload(torrents[0], label);
    }
  }

  const sizeLabel = available
    ? torrents.length > 1
      ? `${torrents.length} torrente`
      : formatBytes(torrents[0].size)
    : null;

  const titleText = inPlex
    ? `Ai deja ${label} în Plex`
    : available
    ? torrents.length > 1
      ? `${torrents.length} torrente disponibile — apasă pentru a alege`
      : `${torrents[0].name} — ${formatBytes(torrents[0].size)}`
    : `Indisponibil ${label}`;

  return (
    <>
      {showPicker && (
        <TorrentPickerDialog
          label={label}
          torrents={torrents}
          onPick={(t) => { setShowPicker(false); onDownload(t, label); }}
          onCancel={() => setShowPicker(false)}
        />
      )}
      <button
        onClick={handleClick}
        disabled={(!available && !inPlex) || isLoading}
        className={`flex flex-col items-center gap-0.5 rounded-xl border px-3 py-2 text-[11px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${colorClass}`}
        title={titleText}
      >
        {isLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : inPlex ? (
          <CheckCircle2 className="h-3.5 w-3.5" />
        ) : (
          <Download className="h-3.5 w-3.5" />
        )}
        <span>{label}</span>
        {inPlex ? (
          <span className="text-[10px] font-normal">În Plex</span>
        ) : sizeLabel ? (
          <span className="text-[10px] font-normal text-muted-foreground">{sizeLabel}</span>
        ) : null}
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------
// Secțiune de căutare unificată (TMDB)
// ---------------------------------------------------------------------------

function UnifiedSearchSection() {
  const { data: adminData } = useQuery(adminStatusQuery);
  const isAdmin = !!adminData?.isAdmin;
  const [pinned, setPinned] = useState<PinnedItem[]>([]);
  const [watchMap, setWatchMap] = useState<Map<string, WatchSettings>>(new Map());
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TmdbSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const searchFn = useServerFn(searchTmdb);
  const getPinnedFn = useServerFn(getPinnedItems);
  const setPinnedFn = useServerFn(setPinnedItems);
  const getWatchFn = useServerFn(getWatchSettings);
  const setWatchFn = useServerFn(setWatchSettings);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getPinnedFn({}).then(setPinned).catch(() => {});
    getWatchFn({}).then((settings) => {
      const map = new Map<string, WatchSettings>();
      for (const s of settings) map.set(`${s.mediaType}-${s.id}`, s);
      setWatchMap(map);
    }).catch(() => {});
  }, []);

  async function updateWatch(id: number, mediaType: "movie" | "tv", patch: Partial<WatchSettings>) {
    const key = `${mediaType}-${id}`;
    const current = watchMap.get(key) ?? { id, mediaType, watchFilelist: false, watchFilelistSeason: false, watchTmdb: false, watchPlex: false, autoDownload: false, autoDownloadQuality: "1080p" as const };
    const next = { ...current, ...patch };
    // Dacă watchFilelist e dezactivat, dezactivăm și sub-toggle-urile
    if (!next.watchFilelist) { next.watchFilelistSeason = false; next.autoDownload = false; }
    setWatchMap((m) => new Map(m).set(key, next));
    await setWatchFn({ data: next }).catch(() => {});
  }

  async function savePinned(list: PinnedItem[]) {
    setPinned(list);
    await setPinnedFn({ data: { items: list } }).catch(() => {});
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await searchFn({ data: { query: q } });
        setResults(r);
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, searchFn]);

  function pin(item: TmdbSearchResult) {
    if (pinned.some((p) => p.id === item.id && p.mediaType === item.mediaType)) return;
    const next = [...pinned, { id: item.id, mediaType: item.mediaType, title: item.title, originalTitle: item.originalTitle, posterUrl: item.posterUrl ?? null }];
    savePinned(next);
    setQuery("");
    setResults([]);
  }

  function unpin(id: number, mediaType: "movie" | "tv") {
    savePinned(pinned.filter((p) => !(p.id === id && p.mediaType === mediaType)));
  }

  return (
    <section>
      <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <Search className="h-3.5 w-3.5" /> Caută film sau serial
      </h2>

      <div className="rounded-2xl border border-border bg-card p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Titlu film sau serial..."
            className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:ring-1 focus:ring-primary"
          />
          {searching && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>

        {results.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {results.map((r) => {
              const alreadyPinned = pinned.some((p) => p.id === r.id && p.mediaType === r.mediaType);
              return (
                <div key={`${r.mediaType}-${r.id}`} className="flex items-center gap-2 rounded-xl bg-muted/60 p-2">
                  {r.posterUrl ? (
                    <img src={r.posterUrl} alt="" className="h-12 w-8 rounded object-cover shrink-0" />
                  ) : (
                    <div className="h-12 w-8 rounded bg-muted shrink-0 flex items-center justify-center">
                      {r.mediaType === "movie" ? <Film className="h-4 w-4 text-muted-foreground" /> : <Tv className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${r.mediaType === "movie" ? "bg-amber-500/15 text-amber-400" : "bg-blue-500/15 text-blue-400"}`}>
                        {r.mediaType === "movie" ? "Film" : "Serial"}
                      </span>
                      <span className="truncate text-sm font-medium">{r.title}</span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {[r.originalTitle !== r.title ? r.originalTitle : null, r.year].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                  <button
                    onClick={() => pin(r)}
                    disabled={alreadyPinned}
                    className="flex shrink-0 items-center gap-1 rounded-lg bg-primary/15 px-2 py-1 text-[11px] font-medium text-primary disabled:opacity-40"
                  >
                    <Pin className="h-3.5 w-3.5" /> {alreadyPinned ? "Fixat" : "Fixează"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-3 space-y-3">
        {pinned.map((p) => {
          const ws = watchMap.get(`${p.mediaType}-${p.id}`) ?? { id: p.id, mediaType: p.mediaType, watchFilelist: false, watchFilelistSeason: false, watchTmdb: false, watchPlex: false, autoDownload: false, autoDownloadQuality: "1080p" as const };
          return (
            <PinnedItemCard
              key={`${p.mediaType}-${p.id}`}
              item={p}
              watchSettings={ws}
              isAdmin={isAdmin}
              onWatchChange={(patch) => updateWatch(p.id, p.mediaType, patch)}
              onUnpin={() => unpin(p.id, p.mediaType)}
            />
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Card item fixat — router spre Movie sau Show
// ---------------------------------------------------------------------------

function PinnedItemCard({ item, watchSettings, isAdmin, onWatchChange, onUnpin }: {
  item: PinnedItem;
  watchSettings: WatchSettings;
  isAdmin: boolean;
  onWatchChange: (patch: Partial<WatchSettings>) => void;
  onUnpin: () => void;
}) {
  const detailsFn = useServerFn(getTmdbDetails);
  const plexFn = useServerFn(checkPlexHasTitle);
  const plexSeasonFn = useServerFn(getPlexEpisodesInSeason);
  const tmdbSeasonFn = useServerFn(getTmdbSeasonEpisodes);
  const filelistFn = useServerFn(searchFilelist);
  const countdownFn = useServerFn(getTvShowCountdown);

  const { data: details, isLoading: detailsLoading } = useQuery({
    queryKey: ["tmdbDetails", item.mediaType, item.id],
    queryFn: () => detailsFn({ data: { id: item.id, mediaType: item.mediaType } }),
    staleTime: 5 * 60_000,
  });

  // Pentru filme: checkPlexHasTitle simplu
  const { data: inPlexMovie, isLoading: plexMovieLoading } = useQuery({
    queryKey: ["plexHasTitle", item.mediaType, item.id],
    queryFn: () => plexFn({ data: { title: item.title, originalTitle: item.originalTitle, mediaType: item.mediaType } }),
    staleTime: 5 * 60_000,
    enabled: item.mediaType === "movie",
  });

  const origTitle = stripDiacritics(details?.originalTitle || item.originalTitle || item.title);

  const { data: filelistData, isLoading: filelistLoading } = useQuery({
    queryKey: ["filelistForItem", item.mediaType, item.id, origTitle],
    queryFn: () => filelistFn({ data: { query: origTitle, category: item.mediaType === "movie" ? "movies" : "series" } }),
    staleTime: 2 * 60_000,
    enabled: !!origTitle,
  });

  const { data: countdown, isLoading: countdownLoading } = useQuery({
    queryKey: ["tvCountdown", item.id],
    queryFn: () => countdownFn({ data: { imdbId: details?.imdbId ?? null, showTitle: item.title } }),
    staleTime: 5 * 60_000,
    enabled: item.mediaType === "tv" && !!details,
  });

  // Pentru seriale: status Plex bazat pe ultimul sezon difuzat
  // Dacă TVmaze nu găsește serialul, folosim ultimul sezon din TMDB details
  const latestSeasonFromTmdb = details && details.seasons.length > 0
    ? details.seasons[details.seasons.length - 1].seasonNumber
    : null;
  const latestSeason = countdown?.status === "ok"
    ? (countdown.lastAired?.season ?? latestSeasonFromTmdb)
    : latestSeasonFromTmdb;
  // Preferăm originalTitle (TMDB păstrează diacriticele), apoi showName din TVmaze, apoi title
  const showTitleForPlex = item.originalTitle || countdown?.showName || item.title;

  const { data: plexSeasonEps, isLoading: plexSeasonLoading } = useQuery({
    queryKey: ["plexSeasonEps", showTitleForPlex, latestSeason],
    queryFn: () => plexSeasonFn({ data: { showTitle: showTitleForPlex, season: latestSeason! } }),
    staleTime: 5 * 60_000,
    enabled: item.mediaType === "tv" && latestSeason !== null,
  });

  const { data: tmdbSeasonEps, isLoading: tmdbSeasonLoading } = useQuery({
    queryKey: ["tmdbSeasonEps", item.id, latestSeason],
    queryFn: () => tmdbSeasonFn({ data: { tmdbId: item.id, seasonNum: latestSeason! } }),
    staleTime: 60 * 60_000,
    enabled: item.mediaType === "tv" && latestSeason !== null,
  });

  // Calculează statusul Plex pentru ultimul sezon
  let tvPlexStatus: "complet" | "incomplet" | "lipsa" | null = null;
  if (item.mediaType === "tv" && latestSeason !== null && plexSeasonEps !== undefined && tmdbSeasonEps !== undefined) {
    const plexSet = new Set((plexSeasonEps).map((e) => e.num));
    const airedEpNums = tmdbSeasonEps.filter((e) => e.aired).map((e) => e.episodeNum);
    const epList = airedEpNums.length > 0 ? airedEpNums : [];
    if (epList.length === 0) {
      tvPlexStatus = plexSeasonEps.length > 0 ? "complet" : "lipsa";
    } else if (epList.every((n) => plexSet.has(n))) {
      tvPlexStatus = "complet";
    } else if (epList.some((n) => plexSet.has(n))) {
      tvPlexStatus = "incomplet";
    } else {
      tvPlexStatus = "lipsa";
    }
  }

  const isLoading = detailsLoading || (item.mediaType === "movie" ? plexMovieLoading : false);

  if (isLoading) {
    return <div className="h-32 animate-pulse rounded-2xl border border-border bg-card" />;
  }

  const torrents = filelistData?.status === "ok" ? filelistData.torrents : [];

  if (item.mediaType === "movie") {
    return (
      <MovieCard
        item={item}
        details={details ?? null}
        plexInfo={inPlexMovie ?? null}
        torrents={torrents}
        filelistLoading={filelistLoading}
        watchSettings={watchSettings}
        isAdmin={isAdmin}
        onWatchChange={onWatchChange}
        onUnpin={onUnpin}
      />
    );
  }

  return (
    <ShowCard
      item={item}
      details={details ?? null}
      tvPlexStatus={tvPlexStatus}
      tvPlexLoading={plexSeasonLoading || tmdbSeasonLoading || countdownLoading}
      plexSeasonEps={plexSeasonEps ?? []}
      torrents={torrents}
      filelistLoading={filelistLoading}
      countdown={countdown ?? null}
      countdownLoading={countdownLoading}
      watchSettings={watchSettings}
      isAdmin={isAdmin}
      onWatchChange={onWatchChange}
      onUnpin={onUnpin}
    />
  );
}

// ---------------------------------------------------------------------------
// MovieCard
// ---------------------------------------------------------------------------

function MovieCard({
  item,
  details,
  plexInfo,
  torrents,
  filelistLoading,
  watchSettings,
  isAdmin,
  onWatchChange,
  onUnpin,
}: {
  item: PinnedItem;
  details: TmdbDetails | null;
  plexInfo: { found: boolean; quality: string | null } | null;
  torrents: FilelistTorrent[];
  filelistLoading: boolean;
  watchSettings: WatchSettings;
  isAdmin: boolean;
  onWatchChange: (patch: Partial<WatchSettings>) => void;
  onUnpin: () => void;
}) {
  const qc = useQueryClient();
  const downloadFn = useServerFn(downloadFilelist);
  const [downloading, setDownloading] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<{ torrent: FilelistTorrent; label: string } | null>(null);

  const imdbId = details?.imdbId ?? null;
  const plexStatus = plexInfo?.found === true ? "complet" : plexInfo?.found === false ? "lipsa" : null;
  const plexQuality = plexInfo?.quality ?? null;

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
        },
      });
      if (res.status === "ok") {
        toast.success("Adăugat în qBittorrent!", { id: toastId, description: `${torrent.name} → ${res.savePath}`, duration: 6000 });
        qc.invalidateQueries({ queryKey: ["filelistLog"] });
      } else {
        toast.error("Eroare la descărcare", { id: toastId, description: res.error, duration: 8000 });
      }
    } catch (e: any) {
      toast.error("Eroare neașteptată", { id: toastId, description: e?.message ?? String(e), duration: 8000 });
    } finally {
      setDownloading(null);
    }
  }

  const t1080 = torrents.filter((t) => detectQuality(t.name).is1080p);
  const t4k = torrents.filter((t) => detectQuality(t.name).is4k);
  const t4kHdr = torrents.filter((t) => detectQuality(t.name).is4kHdr);

  return (
    <>
      {confirm && (
        <DownloadConfirmDialog
          torrent={confirm.torrent}
          label={confirm.label}
          onConfirm={() => { handleDownload(confirm.torrent); setConfirm(null); }}
          onCancel={() => setConfirm(null)}
        />
      )}
      <section>
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          {/* Header cu poster */}
          <div className="flex gap-3 p-3 pb-0">
            {item.posterUrl ? (
              <img src={item.posterUrl} alt="" className="h-24 w-16 rounded-xl object-cover shrink-0 shadow-md" />
            ) : (
              <div className="h-24 w-16 rounded-xl bg-muted shrink-0 flex items-center justify-center">
                <Film className="h-6 w-6 text-muted-foreground/40" />
              </div>
            )}
            <div className="flex flex-col justify-between min-w-0 py-0.5 flex-1">
              <div>
                <div className="flex items-start gap-1">
                  <span className="font-semibold text-sm leading-tight line-clamp-2 flex-1">{item.title}</span>
                  <button onClick={() => { onUnpin(); qc.removeQueries({ queryKey: ["tmdbDetails", "movie", item.id] }); }}
                    className="shrink-0 text-muted-foreground hover:text-foreground mt-0.5" title="Scoate din listă">
                    <PinOff className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400">Film</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {imdbId && (
                  <a href={`https://www.imdb.com/title/${imdbId}/`} target="_blank" rel="noreferrer"
                    className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground">
                    IMDb <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                )}
              </div>
            </div>
          </div>
          <div className="p-3 pt-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground uppercase tracking-wide">Plex</span>
            <div className="flex items-center gap-2">
              {plexStatus === "complet" ? (
                <>
                  {plexQuality && <span className="text-[11px] text-muted-foreground">{plexQuality}</span>}
                  <span className="flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" /> În bibliotecă
                  </span>
                </>
              ) : plexStatus === "lipsa" ? (
                <span className="flex items-center gap-1 rounded-lg bg-muted/60 px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                  <XCircle className="h-3.5 w-3.5" /> Lipsă din Plex
                </span>
              ) : (
                <span className="h-7 w-28 animate-pulse rounded-lg bg-muted/40" />
              )}
            </div>
          </div>
          {isAdmin && (
            <div className="border-t border-border pt-3">
              <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <Download className="h-3 w-3" /> Descarcă de pe Filelist
                {filelistLoading && <Loader2 className="h-3 w-3 animate-spin ml-1" />}
              </div>
              {!filelistLoading && torrents.length === 0 ? (
                <div className="text-xs text-muted-foreground">Niciun torrent găsit pe Filelist.</div>
              ) : (
                <div className="flex gap-2">
                  <QualityDownloadButton label="1080p" torrents={t1080} plexQuality={plexQuality} downloading={downloading} onDownload={(t, l) => setConfirm({ torrent: t, label: l })} />
                  <QualityDownloadButton label="4K" torrents={t4k} plexQuality={plexQuality} downloading={downloading} onDownload={(t, l) => setConfirm({ torrent: t, label: l })} />
                  <QualityDownloadButton label="4K HDR" torrents={t4kHdr} plexQuality={plexQuality} downloading={downloading} onDownload={(t, l) => setConfirm({ torrent: t, label: l })} />
                </div>
              )}
            </div>
          )}
          <WatchTogglePanel mediaType="movie" settings={watchSettings} isAdmin={isAdmin} onChange={onWatchChange} />
          </div>
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// ShowCard
// ---------------------------------------------------------------------------

function useCountdown(targetIso: string) {
  const [remaining, setRemaining] = useState(() => new Date(targetIso).getTime() - Date.now());
  useEffect(() => {
    const id = setInterval(() => setRemaining(new Date(targetIso).getTime() - Date.now()), 1000);
    return () => clearInterval(id);
  }, [targetIso]);
  return remaining;
}

function CountdownDisplay({ airDateIso }: { airDateIso: string }) {
  const remainingMs = useCountdown(airDateIso);
  const past = remainingMs <= 0;
  const totalSec = Math.max(0, Math.floor(remainingMs / 1000));
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  if (past) {
    return <div className="mt-1 text-sm font-medium text-emerald-400">Ar trebui să fi apărut deja</div>;
  }
  return (
    <>
      <div className="mt-1.5 flex items-center gap-2 tabular-nums">
        {[{ v: days, l: "zile" }, { v: hours, l: "ore" }, { v: minutes, l: "min" }, { v: seconds, l: "sec" }].map((u) => (
          <div key={u.l} className="flex-1 rounded-xl bg-muted px-2 py-1.5 text-center">
            <div className="text-lg font-semibold leading-none">{String(u.v).padStart(2, "0")}</div>
            <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{u.l}</div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 text-[11px] text-muted-foreground">
        {new Date(airDateIso).toLocaleString("ro-RO", {
          weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
          timeZone: "Europe/Bucharest",
        })}{" "}(ora României)
      </div>
    </>
  );
}

// Grupare torrente pe sezoane — ambele moduri pot coexista pe același sezon
interface QualitySet {
  t1080: FilelistTorrent[];
  t4k: FilelistTorrent[];
  t4kHdr: FilelistTorrent[];
}

interface SeasonGroup {
  seasonNum: number;
  byQuality: QualitySet;                          // pack sezon întreg (poate fi gol)
  episodes: Map<number, QualitySet>;              // episoade individuale (poate fi gol)
}

function emptyQualitySet(): QualitySet {
  return { t1080: [], t4k: [], t4kHdr: [] };
}

function groupTorrentsBySeasonEpisode(torrents: FilelistTorrent[]): SeasonGroup[] {
  const seasonMap = new Map<number, SeasonGroup>();

  for (const t of torrents) {
    const seasonMatch = t.name.match(/S(\d{2})/i);
    if (!seasonMatch) continue;
    const seasonNum = parseInt(seasonMatch[1], 10);
    if (seasonNum === 0) continue;

    if (!seasonMap.has(seasonNum)) {
      seasonMap.set(seasonNum, {
        seasonNum,
        byQuality: emptyQualitySet(),
        episodes: new Map(),
      });
    }

    const group = seasonMap.get(seasonNum)!;
    const epMatch = t.name.match(/S\d{2}E(\d{2})/i);
    const q = detectQuality(t.name);

    if (epMatch) {
      const epNum = parseInt(epMatch[1], 10);
      if (!group.episodes.has(epNum)) {
        group.episodes.set(epNum, emptyQualitySet());
      }
      const ep = group.episodes.get(epNum)!;
      if (q.is1080p) ep.t1080.push(t);
      if (q.is4k) ep.t4k.push(t);
      if (q.is4kHdr) ep.t4kHdr.push(t);
    } else {
      const bq = group.byQuality;
      if (q.is1080p) bq.t1080.push(t);
      if (q.is4k) bq.t4k.push(t);
      if (q.is4kHdr) bq.t4kHdr.push(t);
    }
  }

  return Array.from(seasonMap.values()).sort((a, b) => a.seasonNum - b.seasonNum);
}

// ---------------------------------------------------------------------------
// Dialog confirmare download
// ---------------------------------------------------------------------------

function DownloadConfirmDialog({
  torrent,
  label,
  onConfirm,
  onCancel,
}: {
  torrent: FilelistTorrent;
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 space-y-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="text-sm font-semibold">Confirmare descărcare</div>
        <div className="space-y-2 text-xs text-muted-foreground">
          <div className="font-medium text-foreground break-words">{torrent.name}</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
            <span className="flex items-center gap-1"><HardDrive className="h-3 w-3" /> {formatBytes(torrent.size)}</span>
            <span className="flex items-center gap-1 text-emerald-400"><Users className="h-3 w-3" /> {torrent.seeders} seederi</span>
            <span className="flex items-center gap-1 text-orange-400"><Users className="h-3 w-3" /> {torrent.leechers} leecheri</span>
            {torrent.freeleech && <span className="flex items-center gap-1 text-yellow-400"><Zap className="h-3 w-3" /> Freeleech</span>}
            {torrent.internal && <span className="flex items-center gap-1 text-purple-400"><ShieldCheck className="h-3 w-3" /> Internal</span>}
          </div>
          <div className="flex items-center gap-1.5 pt-1">
            <span className="rounded bg-muted px-1.5 py-0.5 font-medium">{torrent.categoryName}</span>
            <span className="rounded bg-blue-500/15 px-1.5 py-0.5 font-medium text-blue-400">{label}</span>
            {torrent.upload_date && <span>{new Date(torrent.upload_date).toLocaleDateString("ro-RO")}</span>}
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={onCancel} className="flex-1 rounded-xl border border-border py-2 text-sm text-muted-foreground hover:bg-muted transition-colors">
            Anulează
          </button>
          <button onClick={onConfirm} className="flex-1 rounded-xl bg-blue-500/20 border border-blue-500/30 py-2 text-sm font-medium text-blue-400 hover:bg-blue-500/30 transition-colors flex items-center justify-center gap-1.5">
            <Download className="h-4 w-4" /> Descarcă
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panoul de notificări watch (toggle-uri per tip)
// ---------------------------------------------------------------------------

function WatchTogglePanel({
  mediaType,
  settings,
  isAdmin,
  onChange,
}: {
  mediaType: "movie" | "tv";
  settings: WatchSettings;
  isAdmin: boolean;
  onChange: (patch: Partial<WatchSettings>) => void;
}) {
  const anyEnabled = settings.watchFilelist || settings.watchTmdb || settings.watchPlex;
  const qualities: Array<"1080p" | "4K" | "4K HDR"> = ["1080p", "4K", "4K HDR"];

  function Toggle({ toggleKey, label }: { toggleKey: keyof Pick<WatchSettings, "watchFilelist" | "watchFilelistSeason" | "watchTmdb" | "watchPlex">; label: string }) {
    const on = settings[toggleKey] as boolean;
    return (
      <button
        onClick={() => onChange({ [toggleKey]: !on })}
        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
          on
            ? "bg-primary/15 border-primary/30 text-primary"
            : "bg-muted/40 border-border text-muted-foreground hover:text-foreground"
        }`}
      >
        {on ? <Bell className="h-3 w-3" /> : <BellOff className="h-3 w-3" />}
        {label}
      </button>
    );
  }

  return (
    <div className="border-t border-border pt-3 space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        {anyEnabled ? <Bell className="h-3 w-3 text-primary" /> : <BellOff className="h-3 w-3" />}
        Notificări automate · la fiecare 3 ore
      </div>

      {/* Rând 1: Filelist (admin) + TMDB + Plex */}
      <div className="flex flex-wrap gap-2">
        {isAdmin && <Toggle toggleKey="watchFilelist" label="Torrent nou Filelist" />}
        {mediaType === "tv" && <Toggle toggleKey="watchTmdb" label="Episod nou lansat" />}
        <Toggle toggleKey="watchPlex" label={mediaType === "tv" ? "Episod nou în Plex" : "Film adăugat în Plex"} />
      </div>

      {/* Rând 2: opțiuni Filelist (doar admin) */}
      {isAdmin && settings.watchFilelist && (
        <div className="flex flex-wrap gap-2 pl-3 border-l-2 border-primary/20">
          {mediaType === "tv" && <Toggle toggleKey="watchFilelistSeason" label="Doar sezonul curent" />}
          <button
            onClick={() => onChange({ autoDownload: !settings.autoDownload })}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
              settings.autoDownload
                ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                : "bg-muted/40 border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            <Download className="h-3 w-3" />
            Descarcă automat
          </button>
          {settings.autoDownload && (
            <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
              {qualities.map((q) => (
                <button
                  key={q}
                  onClick={() => onChange({ autoDownloadQuality: q })}
                  className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                    settings.autoDownloadQuality === q
                      ? "bg-emerald-500/25 text-emerald-400"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badge status Plex (3 variante)
// ---------------------------------------------------------------------------

function PlexStatusBadge({ status }: { status: "complet" | "incomplet" | "lipsa" }) {
  if (status === "complet") return (
    <span className="flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2 py-1 text-[11px] font-medium text-emerald-400">
      <CheckCircle2 className="h-3.5 w-3.5" /> Complet în Plex
    </span>
  );
  if (status === "incomplet") return (
    <span className="flex items-center gap-1 rounded-lg bg-yellow-500/15 px-2 py-1 text-[11px] font-medium text-yellow-400">
      <HelpCircle className="h-3.5 w-3.5" /> Lipsesc episoade
    </span>
  );
  return (
    <span className="flex items-center gap-1 rounded-lg bg-red-500/15 px-2 py-1 text-[11px] font-medium text-red-400">
      <XCircle className="h-3.5 w-3.5" /> Lipsă din Plex
    </span>
  );
}

// SeasonPanel — accordion cu ambele moduri + confirmare download + status Plex complet
function SeasonPanel({
  showTitle,
  tmdbId,
  group,
  downloading,
  onDownload,
}: {
  showTitle: string;
  tmdbId: number;
  group: SeasonGroup;
  downloading: number | null;
  onDownload: (t: FilelistTorrent) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ torrent: FilelistTorrent; label: string } | null>(null);
  const plexFn = useServerFn(getPlexEpisodesInSeason);
  const tmdbSeasonFn = useServerFn(getTmdbSeasonEpisodes);

  const { data: plexEpisodes, isLoading: plexLoading } = useQuery({
    queryKey: ["plexSeasonEps", showTitle, group.seasonNum],
    queryFn: () => plexFn({ data: { showTitle, season: group.seasonNum } }),
    enabled: isOpen,
    staleTime: 5 * 60_000,
  });

  const { data: tmdbEpisodes, isLoading: tmdbLoading } = useQuery({
    queryKey: ["tmdbSeasonEps", tmdbId, group.seasonNum],
    queryFn: () => tmdbSeasonFn({ data: { tmdbId, seasonNum: group.seasonNum } }),
    enabled: isOpen,
    staleTime: 60 * 60_000,
  });

  const loading = plexLoading || tmdbLoading;
  // Map epNum → { quality, watched }
  const plexMap = new Map<number, { quality: string | null; watched: boolean }>(
    (plexEpisodes ?? []).map((e) => [e.num, { quality: e.quality, watched: e.watched }])
  );
  const airedEps: TmdbEpisode[] = (tmdbEpisodes ?? []).filter((e) => e.aired);
  const filelistEpNums = Array.from(group.episodes.keys()).sort((a, b) => a - b);
  const episodeList: number[] = airedEps.length > 0
    ? airedEps.map((e) => e.episodeNum)
    : filelistEpNums;

  const allInPlex = episodeList.length > 0 && episodeList.every((n) => plexMap.has(n));
  const someInPlex = !allInPlex && episodeList.some((n) => plexMap.has(n));
  const noneInPlex = episodeList.length > 0 && !episodeList.some((n) => plexMap.has(n));
  const missingCount = episodeList.filter((n) => !plexMap.has(n)).length;
  const unwatchedCount = episodeList.filter((n) => plexMap.has(n) && !plexMap.get(n)!.watched).length;

  const hasPackTorrents = group.byQuality.t1080.length > 0 || group.byQuality.t4k.length > 0 || group.byQuality.t4kHdr.length > 0;
  const hasEpisodeTorrents = group.episodes.size > 0;

  function requestDownload(t: FilelistTorrent, label: string) {
    setConfirm({ torrent: t, label });
  }

  // Badge pe butonul închis
  let closedBadge: React.ReactNode = null;
  if (plexEpisodes !== undefined && !loading && episodeList.length > 0) {
    if (allInPlex) closedBadge = <PlexStatusBadge status="complet" />;
    else if (someInPlex) closedBadge = <PlexStatusBadge status="incomplet" />;
    else closedBadge = <PlexStatusBadge status="lipsa" />;
  }

  const plexSet = new Set(plexMap.keys()); // pentru verificări rapide în render

  return (
    <>
      {confirm && (
        <DownloadConfirmDialog
          torrent={confirm.torrent}
          label={confirm.label}
          onConfirm={() => { onDownload(confirm.torrent); setConfirm(null); }}
          onCancel={() => setConfirm(null)}
        />
      )}
      <div className="rounded-xl border border-border/60 overflow-hidden">
        <button
          onClick={() => setIsOpen((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium hover:bg-muted/50 transition-colors"
        >
          <span>Sezon {String(group.seasonNum).padStart(2, "0")}</span>
          <div className="flex items-center gap-2">
            {!isOpen && closedBadge}
            {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </div>
        </button>

        {isOpen && (
          <div className="border-t border-border/60 p-3 space-y-3">
            {loading && (
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Verifică Plex și episoade...
              </div>
            )}

            {!loading && (
              <>
                {/* Status general */}
                {episodeList.length > 0 && (
                  allInPlex ? (
                    <div className="flex items-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 py-1.5 text-[11px] font-medium text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Complet — toate cele {episodeList.length} episoade sunt în Plex
                    </div>
                  ) : someInPlex ? (
                    <div className="flex items-center gap-1.5 rounded-lg bg-yellow-500/15 px-3 py-1.5 text-[11px] font-medium text-yellow-400">
                      <HelpCircle className="h-3.5 w-3.5" />
                      Incomplet — {plexSet.size}/{episodeList.length} episoade în Plex, lipsesc {missingCount}
                    </div>
                  ) : noneInPlex ? (
                    <div className="flex items-center gap-1.5 rounded-lg bg-red-500/15 px-3 py-1.5 text-[11px] font-medium text-red-400">
                      <XCircle className="h-3.5 w-3.5" />
                      Lipsă — niciun episod în Plex
                    </div>
                  ) : null
                )}

                {/* Pack sezon întreg — apare dacă există și sezonul NU e complet */}
                {hasPackTorrents && !allInPlex && (
                  <div className="space-y-1.5">
                    <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Sezon complet (pack)</div>
                    <div className="flex gap-2">
                      <QualityDownloadButton label="1080p" torrents={group.byQuality.t1080} downloading={downloading} onDownload={requestDownload} />
                      <QualityDownloadButton label="4K" torrents={group.byQuality.t4k} downloading={downloading} onDownload={requestDownload} />
                      <QualityDownloadButton label="4K HDR" torrents={group.byQuality.t4kHdr} downloading={downloading} onDownload={requestDownload} />
                    </div>
                  </div>
                )}

                {/* Episoade individuale */}
                {(hasEpisodeTorrents || episodeList.length > 0) && (
                  <div className="space-y-2">
                    {hasPackTorrents && <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Episoade individuale</div>}
                    {episodeList.map((epNum) => {
                      const epData = plexMap.get(epNum);
                      const inPlex = plexSet.has(epNum);
                      const q = group.episodes.get(epNum);
                      const tmdbEp = airedEps.find((e) => e.episodeNum === epNum);
                      return (
                        <div key={epNum} className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium w-8 shrink-0 text-muted-foreground">E{String(epNum).padStart(2, "0")}</span>
                            {tmdbEp && <span className="text-xs text-muted-foreground truncate flex-1">{tmdbEp.title}</span>}
                            {inPlex && (
                              <span className="shrink-0 flex items-center gap-1 text-[10px] text-emerald-400">
                                <CheckCircle2 className="h-3 w-3" />
                                {epData?.quality ?? "Complet"}
                              </span>
                            )}
                            {inPlex && !epData?.watched && (
                              <span className="shrink-0 flex items-center gap-0.5 text-[10px] font-medium text-orange-400">
                                <HelpCircle className="h-3 w-3" /> Nevăzut
                              </span>
                            )}
                          </div>
                          {q && (
                            <div className="pl-10 flex gap-1.5">
                              <QualityDownloadButton label="1080p" torrents={q.t1080} plexQuality={epData?.quality ?? null} downloading={downloading} onDownload={requestDownload} />
                              <QualityDownloadButton label="4K" torrents={q.t4k} plexQuality={epData?.quality ?? null} downloading={downloading} onDownload={requestDownload} />
                              <QualityDownloadButton label="4K HDR" torrents={q.t4kHdr} plexQuality={epData?.quality ?? null} downloading={downloading} onDownload={requestDownload} />
                            </div>
                          )}
                          {!inPlex && !q && (
                            <div className="pl-10">
                              <PlexStatusBadge status="lipsa" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function ShowCard({
  item,
  details,
  tvPlexStatus,
  tvPlexLoading,
  plexSeasonEps,
  torrents,
  filelistLoading,
  countdown,
  countdownLoading,
  watchSettings,
  isAdmin,
  onWatchChange,
  onUnpin,
}: {
  item: PinnedItem;
  details: TmdbDetails | null;
  tvPlexStatus: "complet" | "incomplet" | "lipsa" | null;
  tvPlexLoading: boolean;
  plexSeasonEps: { num: number; quality: string | null; watched: boolean }[];
  torrents: FilelistTorrent[];
  filelistLoading: boolean;
  countdown: TvShowCountdown | null;
  countdownLoading: boolean;
  watchSettings: WatchSettings;
  isAdmin: boolean;
  onWatchChange: (patch: Partial<WatchSettings>) => void;
  onUnpin: () => void;
}) {
  const qc = useQueryClient();
  const downloadFn = useServerFn(downloadFilelist);
  const [downloading, setDownloading] = useState<number | null>(null);

  const imdbId = details?.imdbId ?? countdown?.imdbId ?? null;
  const showTitle = countdown?.showName || item.title;

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
        },
      });
      if (res.status === "ok") {
        toast.success("Adăugat în qBittorrent!", { id: toastId, description: `${torrent.name} → ${res.savePath}`, duration: 6000 });
        qc.invalidateQueries({ queryKey: ["filelistLog"] });
      } else {
        toast.error("Eroare la descărcare", { id: toastId, description: res.error, duration: 8000 });
      }
    } catch (e: any) {
      toast.error("Eroare neașteptată", { id: toastId, description: e?.message ?? String(e), duration: 8000 });
    } finally {
      setDownloading(null);
    }
  }

  const seasonGroups = groupTorrentsBySeasonEpisode(torrents);

  return (
    <section>
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        {/* Header cu poster */}
        <div className="flex gap-3 p-3 pb-0">
          {item.posterUrl ? (
            <img src={item.posterUrl} alt="" className="h-24 w-16 rounded-xl object-cover shrink-0 shadow-md" />
          ) : (
            <div className="h-24 w-16 rounded-xl bg-muted shrink-0 flex items-center justify-center">
              <Tv className="h-6 w-6 text-muted-foreground/40" />
            </div>
          )}
          <div className="flex flex-col justify-between min-w-0 py-0.5 flex-1">
            <div>
              <div className="flex items-start gap-1">
                <span className="font-semibold text-sm leading-tight line-clamp-2 flex-1">{item.title}</span>
                <button onClick={() => { onUnpin(); qc.removeQueries({ queryKey: ["tmdbDetails", "tv", item.id] }); }}
                  className="shrink-0 text-muted-foreground hover:text-foreground mt-0.5" title="Scoate din listă">
                  <PinOff className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400">Serial</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {imdbId && (
                  <a href={`https://www.imdb.com/title/${imdbId}/`} target="_blank" rel="noreferrer"
                    className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground">
                    IMDb <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                )}
              </div>
              {tvPlexLoading ? (
                <div className="h-4 w-16 animate-pulse rounded bg-muted" />
              ) : (
                <PlexStatusBadge status={tvPlexStatus ?? "lipsa"} />
              )}
            </div>
          </div>
        </div>
        <div className="p-3 pt-3 space-y-3">
        {/* Countdown + ultimul episod */}
        {countdownLoading ? (
          <div className="h-8 animate-pulse rounded-xl bg-muted" />
        ) : countdown?.status === "ok" && countdown.lastAired ? (
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Ultimul episod lansat</div>
            <div className="mt-1 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium text-sm">
                  S{String(countdown.lastAired.season).padStart(2, "0")}E{String(countdown.lastAired.episode).padStart(2, "0")} — {countdown.lastAired.title}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {new Date(countdown.lastAired.airDateIso).toLocaleDateString("ro-RO", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Bucharest" })}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <LibraryBadge inLibrary={countdown.lastAired.inLibrary} />
                {countdown.lastAired.inLibrary && (() => {
                  const ep = plexSeasonEps.find((e) => e.num === countdown.lastAired!.episode);
                  if (!ep) return null;
                  return (
                    <>
                      {ep.quality && <span className="text-[10px] text-muted-foreground">{ep.quality}</span>}
                      {ep.watched
                        ? <span className="text-[10px] text-emerald-400/70">Văzut</span>
                        : <span className="flex items-center gap-0.5 text-[10px] font-medium text-orange-400"><HelpCircle className="h-3 w-3" /> Nevăzut</span>}
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        ) : null}

        {/* Secțiunea Filelist — doar pentru admin */}
        {isAdmin && (
          <div className="border-t border-border pt-3">
            <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
              <Download className="h-3 w-3" /> Descarcă de pe Filelist
              {filelistLoading && <Loader2 className="h-3 w-3 animate-spin ml-1" />}
            </div>
            {!filelistLoading && torrents.length === 0 ? (
              <div className="text-xs text-muted-foreground">Niciun torrent găsit pe Filelist.</div>
            ) : seasonGroups.length === 0 && !filelistLoading ? (
              <div className="text-xs text-muted-foreground">Niciun torrent cu sezon detectat.</div>
            ) : (
              <div className="space-y-1.5">
                {seasonGroups.map((group) => (
                  <SeasonPanel
                    key={group.seasonNum}
                    showTitle={showTitle}
                    tmdbId={item.id}
                    group={group}
                    downloading={downloading}
                    onDownload={handleDownload}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        <WatchTogglePanel mediaType="tv" settings={watchSettings} isAdmin={isAdmin} onChange={onWatchChange} />

        {/* Următorul episod — jos, după Filelist */}
        {countdown?.status === "ok" && countdown.next && (
          <div className="border-t border-border pt-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Următorul episod — S{String(countdown.next.season).padStart(2, "0")}E{String(countdown.next.episode).padStart(2, "0")}
            </div>
            <CountdownDisplay airDateIso={countdown.next.airDateIso} />
          </div>
        )}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Secțiunea FileList Search
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function FilelistSection() {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<FilelistCategory>("all");
  const [results, setResults] = useState<FilelistTorrent[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<number | null>(null);
  const [qualityFilters, setQualityFilters] = useState<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchFn = useServerFn(searchFilelist);
  const downloadFn = useServerFn(downloadFilelist);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearchError(null);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      try {
        const res = await searchFn({ data: { query: q, category } });
        if (res.status === "error") {
          setSearchError(res.error ?? "Eroare necunoscută");
          setResults([]);
        } else {
          setResults(res.torrents);
        }
      } catch (e: any) {
        setSearchError(e?.message ?? String(e));
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, category, searchFn]);

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
        },
      });
      if (res.status === "ok") {
        toast.success(`Adăugat în qBittorrent!`, {
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
    } catch (e: any) {
      toast.error("Eroare neașteptată", {
        id: toastId,
        description: e?.message ?? String(e),
        duration: 8000,
      });
    } finally {
      setDownloading(null);
    }
  }

  const isMovie = (catId: number, catName = "") =>
    [1, 2, 3, 4, 6, 19, 26].includes(catId) ||
    (catId === 0 && /film|movie/i.test(catName));

  return (
    <section>
      <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <Download className="h-3.5 w-3.5 text-blue-400" /> Caută pe FileList.io
      </h2>

      <div className="rounded-2xl border border-border bg-card p-3 space-y-3">
        {/* Search input + category filter */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Film sau serial..."
              className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:ring-1 focus:ring-primary"
            />
            {searching && (
              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as FilelistCategory)}
            className="rounded-xl border border-border bg-background px-2 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="all">Toate</option>
            <option value="movies">Filme</option>
            <option value="series">Seriale</option>
          </select>
        </div>

        {/* Filtre calitate */}
        <div className="flex gap-2">
          {(
            [
              { label: "1080p", color: "blue" },
              { label: "4K", color: "purple" },
            ] as const
          ).map(({ label, color }) => {
            const active = qualityFilters.has(label);
            const styles = {
              blue: active
                ? "border-blue-400/70 bg-blue-500/30 text-blue-200 shadow-sm shadow-blue-500/30"
                : "border-blue-500/40 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 hover:text-blue-300",
              purple: active
                ? "border-purple-400/70 bg-purple-500/30 text-purple-200 shadow-sm shadow-purple-500/30"
                : "border-purple-500/40 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 hover:text-purple-300",
            };
            return (
              <button
                key={label}
                onClick={() => {
                  setQualityFilters((prev) => {
                    const next = new Set(prev);
                    if (next.has(label)) next.delete(label);
                    else next.add(label);
                    return next;
                  });
                }}
                className={`rounded-lg border px-3 py-1 text-xs font-semibold tracking-wide transition-all ${styles[color]}`}
              >
                {label}
              </button>
            );
          })}
          {qualityFilters.size > 0 && (
            <span className="self-center text-[11px] text-muted-foreground ml-1">
              {qualityFilters.size === 2
                ? "Afișez 1080p + 4K"
                : `Afișez doar ${[...qualityFilters][0]}`}
            </span>
          )}
        </div>

        {/* Eroare căutare */}
        {searchError && (
          <div className="rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {searchError}
          </div>
        )}

        {/* Rezultate */}
        {results.length > 0 &&
          (() => {
            const displayed =
              qualityFilters.size === 0
                ? results
                : results.filter((t) => {
                    const name = t.name.toLowerCase();
                    return [...qualityFilters].some((f) =>
                      f === "4K"
                        ? name.includes("2160p") || name.includes("4k")
                        : name.includes("1080p"),
                    );
                  });
            return (
              <div className="space-y-2">
                <div className="text-[11px] text-muted-foreground px-0.5">
                  {displayed.length} {qualityFilters.size > 0 ? `din ${results.length}` : ""}{" "}
                  rezultate
                </div>
                {displayed.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-start gap-2.5 rounded-xl bg-muted/50 border border-border/50 p-2.5"
                  >
                    {/* Tip */}
                    <div className="mt-0.5 shrink-0">
                      {isMovie(t.category) ? (
                        <Film className="h-4 w-4 text-amber-400" />
                      ) : (
                        <Tv className="h-4 w-4 text-blue-400" />
                      )}
                    </div>

                    {/* Info */}
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="text-sm font-medium leading-tight break-words">{t.name}</div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                        <span className="rounded bg-muted px-1.5 py-0.5 font-medium">
                          {t.categoryName}
                        </span>
                        <span className="flex items-center gap-0.5">
                          <HardDrive className="h-3 w-3" /> {formatBytes(t.size)}
                        </span>
                        <span className="flex items-center gap-0.5 text-emerald-400">
                          <Users className="h-3 w-3" /> {t.seeders}S
                        </span>
                        <span className="flex items-center gap-0.5 text-orange-400">
                          <Users className="h-3 w-3" /> {t.leechers}L
                        </span>
                        {t.freeleech && (
                          <span className="flex items-center gap-0.5 rounded bg-yellow-500/15 px-1.5 py-0.5 font-medium text-yellow-400">
                            <Zap className="h-3 w-3" /> Freeleech
                          </span>
                        )}
                        {t.internal && (
                          <span className="flex items-center gap-0.5 rounded bg-purple-500/15 px-1.5 py-0.5 font-medium text-purple-400">
                            <ShieldCheck className="h-3 w-3" /> Internal
                          </span>
                        )}
                        {t.upload_date && (
                          <span>{new Date(t.upload_date).toLocaleDateString("ro-RO")}</span>
                        )}
                      </div>
                    </div>

                    {/* Buton download */}
                    <button
                      onClick={() => handleDownload(t)}
                      disabled={downloading === t.id}
                      className="shrink-0 flex items-center gap-1 rounded-lg bg-blue-500/15 px-2.5 py-1.5 text-[11px] font-medium text-blue-400 hover:bg-blue-500/25 disabled:opacity-50 transition-colors"
                      title={`Descarcă în ${isMovie(t.category) ? "Filme" : "Seriale"}`}
                    >
                      {downloading === t.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                      {isMovie(t.category) ? "Film" : "Serial"}
                    </button>
                  </div>
                ))}
              </div>
            );
          })()}

        {/* Mesaj gol */}
        {!searching && query.trim().length >= 2 && results.length === 0 && !searchError && (
          <div className="text-center text-sm text-muted-foreground py-4">
            Niciun rezultat găsit.
          </div>
        )}
      </div>
    </section>
  );
}

function DownloadLogSection() {
  const queryClient = useQueryClient();
  const { data: log, isLoading } = useQuery(filelistLogQuery);
  const deleteFn = useServerFn(deleteFilelistLogEntry);
  const isMovie = (catId: number, catName = "") =>
    [1, 2, 3, 4, 6, 19, 26].includes(catId) ||
    (catId === 0 && /film|movie/i.test(catName));

  async function handleDelete(id: number, name: string, hasHash: boolean) {
    const msg = hasHash
      ? `Ștergi torrentul din log, din qBittorrent și fișierele de pe disk?\n\n${name}`
      : `Ștergi intrarea din log?\n\n${name}`;
    if (!confirm(msg)) return;
    const res = await deleteFn({ data: { id } });
    queryClient.invalidateQueries({ queryKey: ["filelistLog"] });
    if (hasHash) {
      if (res.qbitDeleted) toast.success("Torrent și fișiere șterse din qBittorrent");
      else toast.warning("Șters din log, dar nu am putut șterge din qBittorrent (poate deja șters)");
    }
  }

  if (isLoading || !log || log.length === 0) return null;

  return (
    <div className="mt-3">
      <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <History className="h-3.5 w-3.5" /> Ultimele torrente descărcate
      </h3>
      <div className="rounded-2xl border border-border bg-card p-3">
        <div className="divide-y divide-border/60">
          {log.slice(0, 10).map((e: FilelistLogEntry) => (
            <div
              key={`${e.id}-${e.downloadedAt}`}
              className="flex items-start gap-2.5 py-2 first:pt-0 last:pb-0"
            >
              <div className="mt-0.5 shrink-0">
                {isMovie(e.category, e.categoryName) ? (
                  <Film className="h-4 w-4 text-amber-400" />
                ) : (
                  <Tv className="h-4 w-4 text-blue-400" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium leading-tight break-words">{e.name}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span>
                    {new Date(e.downloadedAt).toLocaleString("ro-RO", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "Europe/Bucharest",
                    })}
                  </span>
                  <span className="rounded bg-muted px-1.5 py-0.5 font-medium">
                    {e.categoryName}
                  </span>
                  {e.size > 0 && (
                    <span className="flex items-center gap-0.5">
                      <HardDrive className="h-3 w-3" /> {formatBytes(e.size)}
                    </span>
                  )}
                  {e.freeleech && (
                    <span className="flex items-center gap-0.5 rounded bg-yellow-500/15 px-1.5 py-0.5 font-medium text-yellow-400">
                      <Zap className="h-3 w-3" /> Freeleech
                    </span>
                  )}
                  {e.internal && (
                    <span className="flex items-center gap-0.5 rounded bg-purple-500/15 px-1.5 py-0.5 font-medium text-purple-400">
                      <ShieldCheck className="h-3 w-3" /> Internal
                    </span>
                  )}
                </div>
                <div className="mt-1">
                  {e.completedAt ? (
                    <span className="flex items-center gap-1 text-[11px] text-emerald-400">
                      <CheckCircle2 className="h-3 w-3" /> Complet —{" "}
                      {new Date(e.completedAt).toLocaleString("ro-RO", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "Europe/Bucharest",
                      })}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[11px] text-amber-400">
                      <Loader2 className="h-3 w-3 animate-spin" /> În descărcare...
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => handleDelete(e.id, e.name, !!e.torrentHash)}
                className="shrink-0 mt-0.5 rounded-lg p-1.5 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                title={e.torrentHash ? "Șterge din log + qBit + disk" : "Șterge din log"}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LibraryBadge({ inLibrary }: { inLibrary: boolean | null }) {
  if (inLibrary === true) {
    return (
      <span className="flex shrink-0 items-center gap-1 rounded-lg bg-emerald-500/15 px-2 py-1 text-[11px] font-medium text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" /> În bibliotecă
      </span>
    );
  }
  if (inLibrary === false) {
    return (
      <span className="flex shrink-0 items-center gap-1 rounded-lg bg-red-500/15 px-2 py-1 text-[11px] font-medium text-red-400">
        <XCircle className="h-3.5 w-3.5" /> Nu e încă
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-1 rounded-lg bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
      <HelpCircle className="h-3.5 w-3.5" /> Necunoscut
    </span>
  );
}
