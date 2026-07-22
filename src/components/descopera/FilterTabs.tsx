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
  onSortChange,
  onMediaChange,
}: {
  sort: DiscoverSort;
  media: DiscoverMediaType | "all";
  onSortChange: (v: DiscoverSort) => void;
  onMediaChange: (v: DiscoverMediaType | "all") => void;
}) {
  return (
    <div className="space-y-2">
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
