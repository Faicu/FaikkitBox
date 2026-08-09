import { useRef, useState } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Search,
  Loader2,
  Film,
  Tv,
  CheckCircle2,
  Download,
  Pin,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";

import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { pinnedItemsQuery } from "@/lib/queries";
import { searchTmdb, getTmdbDetails } from "@/lib/tmdb.functions";
import type { TmdbSearchResult } from "@/lib/tmdb.functions";
import { checkPlexHasTitle } from "@/lib/services.functions";
import { checkFilelistForItem, downloadFilelist } from "@/lib/filelist.functions";
import type { FilelistTorrent } from "@/lib/filelist.functions";
import { setPinnedItems, setWatchSettings } from "@/lib/pinned.functions";
import { detectQuality } from "@/components/lansari/utils";

type Quality = "1080p" | "4K" | "4K HDR";
type Step = "search" | "checking" | "result";

interface CheckResult {
  imdbId: string | null;
  originalTitle: string;
  plexFound: boolean;
  plexQuality: string | null;
  torrents: FilelistTorrent[];
}

function bestTorrentForQuality(torrents: FilelistTorrent[], quality: Quality): FilelistTorrent | null {
  const matches = torrents.filter((t) => {
    const q = detectQuality(t.name);
    if (quality === "1080p") return q.is1080p;
    if (quality === "4K") return q.is4k;
    return q.is4kHdr;
  });
  if (matches.length === 0) return null;
  return [...matches].sort((a, b) => b.seeders - a.seeders)[0];
}

export function AddMediaWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: pinned = [] } = useQuery(pinnedItemsQuery);

  const searchFn = useServerFn(searchTmdb);
  const detailsFn = useServerFn(getTmdbDetails);
  const plexFn = useServerFn(checkPlexHasTitle);
  const filelistFn = useServerFn(checkFilelistForItem);
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
  const [busy, setBusy] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function reset() {
    setStep("search");
    setQuery("");
    setResults([]);
    setSelected(null);
    setCheckResult(null);
    setQuality("1080p");
    setBusy(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

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
      setCheckResult({
        imdbId: details.imdbId,
        originalTitle,
        plexFound: !!plexRes?.found,
        plexQuality: plexRes?.quality ?? null,
        torrents: filelistRes.status === "ok" ? filelistRes.torrents : [],
      });
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
      });
    } finally {
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
        handleClose();
      } else {
        toast.error("Eroare la descărcare", { id: toastId, description: res.error, duration: 8000 });
      }
    } catch (e) {
      toast.error("Eroare neașteptată", {
        id: toastId,
        description: e instanceof Error ? e.message : String(e),
        duration: 8000,
      });
    } finally {
      setBusy(false);
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
        description: `Se descarcă automat la calitatea ${quality} imediat ce apare pe Filelist.`,
        duration: 6000,
      });
      handleClose();
    } catch (e) {
      toast.error("Eroare la fixare", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  const bestMatch = checkResult ? bestTorrentForQuality(checkResult.torrents, quality) : null;

  return (
    <Drawer open={open} onOpenChange={(o) => !o && handleClose()}>
      <DrawerContent className="max-h-[90vh]">
        <DrawerHeader className="text-left pb-0">
          <DrawerTitle className="flex items-center gap-2">
            {step === "result" && (
              <button
                type="button"
                onClick={reset}
                className="rounded-lg p-1 text-muted-foreground hover:text-foreground hover:bg-muted/60"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            Adaugă film/serial
          </DrawerTitle>
        </DrawerHeader>

        <div className="space-y-3 overflow-y-auto px-4 pb-6 pt-3">
          {step === "search" && (
            <>
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
                        <img src={r.posterUrl} alt="" className="h-12 w-8 rounded object-cover shrink-0" />
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
            </>
          )}

          {step === "checking" && (
            <div className="flex flex-col items-center gap-3 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              Verific Plex și Filelist pentru „{selected?.title}”…
            </div>
          )}

          {step === "result" && selected && checkResult && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 rounded-xl bg-muted/60 p-2">
                {selected.posterUrl ? (
                  <img
                    src={selected.posterUrl}
                    alt=""
                    className="h-14 w-10 rounded object-cover shrink-0"
                  />
                ) : (
                  <div className="h-14 w-10 rounded bg-muted shrink-0 flex items-center justify-center">
                    {selected.mediaType === "movie" ? (
                      <Film className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Tv className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{selected.title}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {checkResult.originalTitle}
                    {selected.year ? ` · ${selected.year}` : ""}
                  </div>
                </div>
              </div>

              {checkResult.plexFound ? (
                <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-400">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  Deja în bibliotecă Plex
                  {checkResult.plexQuality ? ` — ${checkResult.plexQuality}` : ""}
                </div>
              ) : (
                <>
                  <div>
                    <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Calitate
                    </div>
                    <div className="flex gap-2">
                      {(["1080p", "4K", "4K HDR"] as Quality[]).map((q) => (
                        <button
                          key={q}
                          type="button"
                          onClick={() => setQuality(q)}
                          className={`flex-1 rounded-xl border px-3 py-1.5 text-sm font-medium transition-colors ${
                            quality === q
                              ? "border-primary bg-primary/15 text-primary"
                              : "border-border bg-muted/40 text-muted-foreground hover:bg-muted/60"
                          }`}
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>

                  {bestMatch ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => downloadNow(bestMatch)}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                    >
                      {busy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                      Descarcă acum — {bestMatch.name}
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <div className="rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">
                        Nu există încă un torrent la calitatea {quality} pe Filelist.
                      </div>
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
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
