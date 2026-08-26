import type { DiscoverMediaType, DiscoverSort } from "@/lib/tmdb/tmdb.discover.functions";

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

function Tab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-all active:scale-95 ${
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted/60 text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

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
    <>
      {sortTabs.map((tab) => (
        <Tab
          key={tab.value}
          label={tab.label}
          active={sort === tab.value}
          onClick={() => onSortChange(tab.value)}
        />
      ))}
      <div className="mx-0.5 h-5 w-px shrink-0 self-center bg-border" />
      {mediaTabs.map((tab) => (
        <Tab
          key={tab.value}
          label={tab.label}
          active={media === tab.value}
          onClick={() => onMediaChange(tab.value)}
        />
      ))}
    </>
  );
}
