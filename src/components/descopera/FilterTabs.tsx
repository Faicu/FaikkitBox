import { Search } from "lucide-react";
import type { DiscoverMediaType, DiscoverSort } from "@/lib/tmdb.discover.functions";

const sortTabs: { value: DiscoverSort; label: string }[] = [
  { value: "trending", label: "Trending" },
  { value: "popular_all_time", label: "Populare all-time" },
  { value: "newest", label: "Cele mai noi" },
];

const mediaTabs: { value: DiscoverMediaType | "all"; label: string }[] = [
  { value: "all", label: "Tot" },
  { value: "movie", label: "Filme" },
  { value: "tv", label: "Seriale" },
];

export function FilterTabs({
  sort,
  media,
  query,
  onSortChange,
  onMediaChange,
  onQueryChange,
}: {
  sort: DiscoverSort;
  media: DiscoverMediaType | "all";
  query: string;
  onSortChange: (v: DiscoverSort) => void;
  onMediaChange: (v: DiscoverMediaType | "all") => void;
  onQueryChange: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Caută un titlu..."
          className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {sortTabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => onSortChange(tab.value)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              sort === tab.value
                ? "bg-primary text-primary-foreground"
                : "bg-muted/60 text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex gap-1.5">
        {mediaTabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => onMediaChange(tab.value)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              media === tab.value
                ? "bg-primary text-primary-foreground"
                : "bg-muted/60 text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
