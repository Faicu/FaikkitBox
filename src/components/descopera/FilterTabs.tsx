import type { ReactNode } from "react";
import { Clock, Flame, LayoutGrid, Magnet, Sparkles, Trophy, Zap } from "lucide-react";

import type { DiscoverMediaType, DiscoverSort } from "@/lib/tmdb/tmdb.discover.functions";
import { TOP_PERIODS, type TopPeriodHours } from "@/lib/filelist/top-torrents";

// Taburile de sursă: sortările TMDB + „Top Filelist" (torrentele populare).
export type DiscoverTab = DiscoverSort | "filelist_top";
export type DiscoverMode = "grid" | "feed";

const sourceTabs: { value: DiscoverTab; label: string; icon: ReactNode }[] = [
  { value: "trending", label: "Trending", icon: <Flame className="h-4 w-4" /> },
  { value: "popular_all_time", label: "Populare", icon: <Trophy className="h-4 w-4" /> },
  { value: "newest", label: "Noi", icon: <Sparkles className="h-4 w-4" /> },
  { value: "filelist_top", label: "Filelist", icon: <Magnet className="h-4 w-4" /> },
];

const mediaTabs: { value: DiscoverMediaType | "all"; label: string }[] = [
  { value: "all", label: "Tot" },
  { value: "movie", label: "Filme" },
  { value: "tv", label: "Seriale" },
];

const modeTabs: { value: DiscoverMode; label: ReactNode; title: string }[] = [
  { value: "grid", label: <LayoutGrid className="h-3.5 w-3.5" />, title: "Grilă" },
  { value: "feed", label: <Zap className="h-3.5 w-3.5" />, title: "Feed" },
];

// Control segmentat: opțiuni de lățime egală într-o capsulă, cu un indicator
// care alunecă sub opțiunea activă.
function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  className = "",
}: {
  options: { value: T; label: ReactNode; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  return (
    <div className={`relative flex rounded-full bg-muted/60 p-0.5 ${className}`}>
      <span
        aria-hidden
        className="absolute inset-y-0.5 left-0.5 rounded-full bg-primary shadow-sm transition-transform duration-300 ease-out"
        style={{
          width: `calc((100% - 4px) / ${options.length})`,
          transform: `translateX(${index * 100}%)`,
        }}
      />
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          title={o.title}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`relative z-10 flex flex-1 items-center justify-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-medium transition-colors active:scale-95 ${
            o.value === value
              ? "text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function FilterTabs({
  sort,
  media,
  mode,
  period,
  onSortChange,
  onMediaChange,
  onModeChange,
  onPeriodChange,
}: {
  sort: DiscoverTab;
  media: DiscoverMediaType | "all";
  mode: DiscoverMode;
  period: TopPeriodHours;
  onSortChange: (v: DiscoverTab) => void;
  onMediaChange: (v: DiscoverMediaType | "all") => void;
  onModeChange: (v: DiscoverMode) => void;
  onPeriodChange: (v: TopPeriodHours) => void;
}) {
  const isFilelist = sort === "filelist_top";
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-4 gap-2">
        {sourceTabs.map((tab) => {
          const active = sort === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              aria-pressed={active}
              onClick={() => onSortChange(tab.value)}
              className={`flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-medium transition-all active:scale-95 ${
                active
                  ? "bg-primary text-primary-foreground shadow-md shadow-primary/25"
                  : "glass-card glass-card-hover text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <Segmented className="flex-1" options={mediaTabs} value={media} onChange={onMediaChange} />
        {/* Feed-ul e construit pe trailere TMDB — Top Filelist n-are echivalent. */}
        {!isFilelist && (
          <Segmented
            className="w-[5.5rem] shrink-0"
            options={modeTabs}
            value={mode}
            onChange={onModeChange}
          />
        )}
      </div>

      {isFilelist && (
        <div className="flex items-center gap-2 animate-in fade-in slide-in-from-top-1">
          <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <Segmented
            className="flex-1"
            options={TOP_PERIODS.map((p) => ({ value: p.hours, label: p.label }))}
            value={period}
            onChange={onPeriodChange}
          />
        </div>
      )}
    </div>
  );
}
