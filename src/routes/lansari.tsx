import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, useCallback } from "react";
import { Flame, CheckCircle2, XCircle, HelpCircle, Search, Pin, PinOff, ExternalLink, Loader2, Download, Film, Tv, Users, Zap, HardDrive, ShieldCheck, History } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { PageShell } from "@/components/PageShell";
import { ServicePill } from "@/components/ServicePill";
import { ErrorCard } from "@/components/ErrorCard";
import { showStatusQuery, camatariiStatusQuery, filelistLogQuery, adminStatusQuery } from "@/lib/queries";
import type { ShowStatusData } from "@/lib/services.functions";
import { searchTvShows, getTvShowStatus } from "@/lib/tvshows.functions";
import type { TvShowSearchResult, CustomShowStatus } from "@/lib/tvshows.functions";
import { searchFilelist, downloadFilelist } from "@/lib/filelist.functions";
import type { FilelistTorrent, FilelistCategory, FilelistLogEntry } from "@/lib/filelist.functions";

export const Route = createFileRoute("/lansari")({
  head: () => ({ meta: [{ title: "Lansări — Monitor Server" }] }),
  component: LansariPage,
});

function LansariPage() {
  const { data: hotdData, isLoading: isHotdLoading } = useQuery({ ...showStatusQuery, throwOnError: false });
  const { data: camatariiData, isLoading: isCamatariiLoading } = useQuery({ ...camatariiStatusQuery, throwOnError: false });
  const { data: adminData } = useQuery({ ...adminStatusQuery, throwOnError: false });
  const isAdmin = adminData?.isAdmin ?? false;

  const status =
    isHotdLoading || isCamatariiLoading
      ? "loading"
      : hotdData?.status === "error" || camatariiData?.status === "error"
        ? "error"
        : "ok";

  return (
    <PageShell title="Lansări" subtitle="Calendar seriale" right={<ServicePill status={status} />}>
      {hotdData?.status === "error" && <ErrorCard title="House of the Dragon indisponibil" message={hotdData.error ?? "Eroare necunoscută"} />}
      {hotdData?.status === "ok" && <ShowStatusCard data={hotdData} />}
      {camatariiData?.status === "error" && <ErrorCard title="Camatarii indisponibil" message={camatariiData.error ?? "Eroare necunoscută"} />}
      {camatariiData?.status === "ok" && <ShowStatusCard data={camatariiData} />}

      <CustomShowsSection />
      <FilelistSection isAdmin={isAdmin} />
      {isAdmin && <FilelistLogSection />}    </PageShell>
  );
}

const PINNED_KEY = "faikkitbox:pinnedShows";

interface PinnedShow {
  id: number;
  name: string;
}

function loadPinned(): PinnedShow[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PINNED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function savePinned(list: PinnedShow[]) {
  try {
    window.localStorage.setItem(PINNED_KEY, JSON.stringify(list));
  } catch {
    // localStorage indisponibil (mod privat etc.) - fixarea pur si simplu nu persista
  }
}

function CustomShowsSection() {
  const [pinned, setPinned] = useState<PinnedShow[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TvShowSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const searchFn = useServerFn(searchTvShows);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setPinned(loadPinned());
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await searchFn({ data: { query: q } });
        setResults(r);
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, searchFn]);

  function pin(show: TvShowSearchResult) {
    if (pinned.some((p) => p.id === show.id)) return;
    const next = [...pinned, { id: show.id, name: show.name }];
    setPinned(next);
    savePinned(next);
    setQuery("");
    setResults([]);
  }

  function unpin(id: number) {
    const next = pinned.filter((p) => p.id !== id);
    setPinned(next);
    savePinned(next);
  }

  return (
    <section>
      <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <Search className="h-3.5 w-3.5" /> Caută alt serial
      </h2>

      <div className="rounded-2xl border border-border bg-card p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Numele serialului..."
            className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:ring-1 focus:ring-primary"
          />
          {searching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
        </div>

        {results.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {results.map((r) => {
              const alreadyPinned = pinned.some((p) => p.id === r.id);
              return (
                <div key={r.id} className="flex items-center gap-2 rounded-xl bg-muted/60 p-2">
                  {r.image ? (
                    <img src={r.image} alt="" className="h-10 w-7 rounded object-cover" />
                  ) : (
                    <div className="h-10 w-7 rounded bg-muted" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{r.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {[r.network, r.premiered?.slice(0, 4)].filter(Boolean).join(" · ") || "—"}
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
        {pinned.map((p) => (
          <PinnedShowCard key={p.id} id={p.id} onUnpin={() => unpin(p.id)} />
        ))}
      </div>
    </section>
  );
}

function PinnedShowCard({ id, onUnpin }: { id: number; onUnpin: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["customShowStatus", id],
    queryFn: () => getTvShowStatus({ data: { showId: id } }),
    staleTime: 0,
    refetchOnMount: "always",
  });

  if (isLoading || !data) {
    return <div className="h-24 animate-pulse rounded-2xl border border-border bg-card" />;
  }

  if (data.status === "error") {
    return (
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">Nu am putut încărca acest serial.</span>
          <button
            onClick={() => {
              onUnpin();
              qc.removeQueries({ queryKey: ["customShowStatus", id] });
            }}
            className="shrink-0 rounded-lg bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground"
          >
            <PinOff className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <ShowStatusCard
      data={data}
      imdbId={data.imdbId}
      onUnpin={() => {
        onUnpin();
        qc.removeQueries({ queryKey: ["customShowStatus", id] });
      }}
    />
  );
}

function useCountdown(targetIso: string) {
  const [remaining, setRemaining] = useState(() => new Date(targetIso).getTime() - Date.now());
  useEffect(() => {
    const id = setInterval(() => setRemaining(new Date(targetIso).getTime() - Date.now()), 1000);
    return () => clearInterval(id);
  }, [targetIso]);
  return remaining;
}

function ShowStatusCard({
  data,
  imdbId,
  onUnpin,
}: {
  data: ShowStatusData;
  imdbId?: string | null;
  onUnpin?: () => void;
}) {
  const remainingMs = useCountdown(data.next?.airDateIso ?? new Date().toISOString());
  const past = remainingMs <= 0;
  const totalSec = Math.max(0, Math.floor(remainingMs / 1000));
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  return (
    <section>
      <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <Flame className="h-3.5 w-3.5 text-orange-400" /> {data.show}
        {imdbId && (
          <a
            href={`https://www.imdb.com/title/${imdbId}/`}
            target="_blank"
            rel="noreferrer"
            className="ml-auto flex items-center gap-0.5 text-[10px] normal-case tracking-normal text-muted-foreground hover:text-foreground"
          >
            IMDb <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {onUnpin && (
          <button onClick={onUnpin} className="ml-2 text-muted-foreground hover:text-foreground" title="Scoate din listă">
            <PinOff className="h-3.5 w-3.5" />
          </button>
        )}
      </h2>
      <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
        {data.lastAired ? (
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Ultimul episod lansat</div>
            <div className="mt-1 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium">
                  E{data.lastAired.episode} — {data.lastAired.title}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {new Date(data.lastAired.airDateIso).toLocaleDateString("ro-RO", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                    timeZone: "Europe/Bucharest",
                  })}
                </div>
              </div>
              <LibraryBadge inLibrary={data.lastAired.inLibrary} />
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">Sezonul nu a început încă.</div>
        )}

        {data.next && (
          <div className="border-t border-border pt-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Următorul episod — E{data.next.episode}
            </div>
            {past ? (
              <div className="mt-1 text-sm font-medium text-emerald-400">Ar trebui să fi apărut deja</div>
            ) : (
              <div className="mt-1.5 flex items-center gap-2 tabular-nums">
                {[
                  { v: days, l: "zile" },
                  { v: hours, l: "ore" },
                  { v: minutes, l: "min" },
                  { v: seconds, l: "sec" },
                ].map((u) => (
                  <div key={u.l} className="flex-1 rounded-xl bg-muted px-2 py-1.5 text-center">
                    <div className="text-lg font-semibold leading-none">{String(u.v).padStart(2, "0")}</div>
                    <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{u.l}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-1.5 text-[11px] text-muted-foreground">
              {new Date(data.next.airDateIso).toLocaleString("ro-RO", {
                weekday: "long",
                day: "numeric",
                month: "long",
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Europe/Bucharest",
              })}{" "}
              (ora României)
            </div>
          </div>
        )}
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

function FilelistSection({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<FilelistCategory>("all");
  const [results, setResults] = useState<FilelistTorrent[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<number | null>(null);
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
        toast.error("Eroare la descărcare", { id: toastId, description: res.error, duration: 8000 });
      }
    } catch (e: any) {
      toast.error("Eroare neașteptată", { id: toastId, description: e?.message ?? String(e), duration: 8000 });
    } finally {
      setDownloading(null);
    }
  }

  const isMovie = (catId: number) => [1, 2, 3, 4, 6, 19, 26].includes(catId);

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

        {/* Eroare căutare */}
        {searchError && (
          <div className="rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-400">{searchError}</div>
        )}

        {/* Rezultate */}
        {results.length > 0 && (
          <div className="space-y-2">
            <div className="text-[11px] text-muted-foreground px-0.5">{results.length} rezultate</div>
            {results.map((t) => (
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
                    <span className="rounded bg-muted px-1.5 py-0.5 font-medium">{t.categoryName}</span>
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

                {/* Buton download — doar pentru admin */}
                {isAdmin && (
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
                )}
              </div>
            ))}
          </div>
        )}

        {/* Mesaj gol */}
        {!searching && query.trim().length >= 2 && results.length === 0 && !searchError && (
          <div className="text-center text-sm text-muted-foreground py-4">Niciun rezultat găsit.</div>
        )}
      </div>

      <DownloadLogSection />
    </section>
  );
}

function DownloadLogSection() {
  const { data: log, isLoading } = useQuery({
    ...filelistLogQuery,
    throwOnError: false,
    enabled: typeof window !== "undefined",
  });
  const isMovie = (catId: number) => [1, 2, 3, 4, 6, 19, 26].includes(catId);

  if (isLoading || !log || log.length === 0) return null;

  return (
    <div className="mt-3">
      <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <History className="h-3.5 w-3.5" /> Ultimele torrente descărcate
      </h3>
      <div className="rounded-2xl border border-border bg-card p-3">
        <div className="divide-y divide-border/60">
          {log.slice(0, 10).map((e: FilelistLogEntry) => (
            <div key={`${e.id}-${e.downloadedAt}`} className="flex items-start gap-2.5 py-2 first:pt-0 last:pb-0">
              <div className="mt-0.5 shrink-0">
                {isMovie(e.category) ? (
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
                  <span className="rounded bg-muted px-1.5 py-0.5 font-medium">{e.categoryName}</span>
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
                        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
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
