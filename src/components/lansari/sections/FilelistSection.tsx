import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Search,
  Download,
  Loader2,
  HardDrive,
  Users,
  Zap,
  ShieldCheck,
  Film,
  Tv,
} from "lucide-react";

import { searchFilelist } from "@/lib/filelist.functions";
import type { FilelistCategory, FilelistTorrent } from "@/lib/filelist.functions";
import { formatBytes } from "@/lib/format";
import { useDownload } from "../hooks";

// ---------------------------------------------------------------------------
// Secțiunea FileList Search
// ---------------------------------------------------------------------------

export function FilelistSection() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<FilelistCategory>("all");
  const [results, setResults] = useState<FilelistTorrent[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [qualityFilters, setQualityFilters] = useState<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchFn = useServerFn(searchFilelist);
  const { downloading, handleDownload } = useDownload();

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
      } catch (e) {
        setSearchError(e instanceof Error ? e.message : String(e));
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, category, searchFn]);

  const isMovie = (catId: number, catName = "") =>
    [1, 2, 3, 4, 6, 19, 26].includes(catId) || (catId === 0 && /film|movie/i.test(catName));

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
