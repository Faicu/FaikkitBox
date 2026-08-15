import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Search, Pin, Loader2, Film, Tv } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";

import { pinnedItemsQuery } from "@/lib/queries";
import { searchTmdb } from "@/lib/tmdb.functions";
import type { TmdbSearchResult } from "@/lib/tmdb.functions";
import { setPinnedItems } from "@/lib/pinned.functions";
import type { PinnedItem } from "../types";

// ---------------------------------------------------------------------------
// Secțiune de căutare unificată (TMDB) — disponibilă tuturor utilizatorilor
// autentificați (fixarea unui rezultat necesită doar autentificare, nu admin)
// ---------------------------------------------------------------------------

export function UnifiedSearchSection() {
  const queryClient = useQueryClient();
  const { data: pinned = [] } = useQuery(pinnedItemsQuery);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TmdbSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const searchFn = useServerFn(searchTmdb);
  const setPinnedFn = useServerFn(setPinnedItems);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function savePinned(list: PinnedItem[]) {
    await setPinnedFn({ data: { items: list } }).catch(() => {});
    await queryClient.invalidateQueries({ queryKey: ["pinnedItems"] });
  }

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

  function pin(item: TmdbSearchResult) {
    if (pinned.some((p) => p.id === item.id && p.mediaType === item.mediaType)) return;
    const next = [
      ...pinned,
      {
        id: item.id,
        mediaType: item.mediaType,
        title: item.title,
        originalTitle: item.originalTitle,
        posterUrl: item.posterUrl ?? null,
      },
    ];
    savePinned(next);
    setQuery("");
    setResults([]);
  }

  return (
    <section>
      <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <Search className="h-3.5 w-3.5" /> Caută orice film sau serial
      </h2>

      <div className="rounded-2xl border border-border bg-card p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Introdu titlul..."
            className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:ring-1 focus:ring-primary"
          />
          {searching && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>

        {results.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {results.map((r) => {
              const alreadyPinned = pinned.some(
                (p) => p.id === r.id && p.mediaType === r.mediaType,
              );
              return (
                <div
                  key={`${r.mediaType}-${r.id}`}
                  className="flex items-center gap-2 rounded-xl bg-muted/60 p-2"
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
    </section>
  );
}
