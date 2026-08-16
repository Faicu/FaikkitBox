import { Search, Loader2, Film, Tv } from "lucide-react";

import type { TmdbSearchResult } from "@/lib/tmdb/tmdb.functions";

export function SearchStep({
  query,
  onQueryChange,
  searching,
  results,
  onSelect,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  searching: boolean;
  results: TmdbSearchResult[];
  onSelect: (item: TmdbSearchResult) => void;
}) {
  return (
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
              onClick={() => onSelect(r)}
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
    </div>
  );
}
