import type { ReactNode } from "react";
import { Star, Film, Tv } from "lucide-react";

import { formatCompact } from "@/lib/format";
import type { DiscoverTitle } from "@/lib/tmdb/tmdb.discover.functions";

// Card de poster din grilele Descoperă (TMDB și Top Filelist). `badge` apare
// în colțul din dreapta-sus — folosit de Top Filelist pentru seederi/episod.
export function PosterCard({
  item,
  onClick,
  badge,
}: {
  item: DiscoverTitle;
  onClick: () => void;
  badge?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="poster-tilt group relative aspect-[2/3] overflow-hidden rounded-xl border border-border bg-muted/40 text-left"
    >
      {item.posterUrl ? (
        <img src={item.posterUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          {item.mediaType === "movie" ? (
            <Film className="h-6 w-6 text-muted-foreground/40" />
          ) : (
            <Tv className="h-6 w-6 text-muted-foreground/40" />
          )}
        </div>
      )}
      {badge && (
        <div className="absolute right-1.5 top-1.5 flex flex-col items-end gap-1">{badge}</div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-2 pt-6">
        <div className="line-clamp-2 text-[11px] font-medium leading-tight text-white">
          {item.originalTitle}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-white/70">
          {item.year && <span>{item.year}</span>}
          {item.imdbRating != null && (
            <span className="flex items-center gap-0.5" title="Rating IMDb">
              <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
              <span className="font-semibold text-white">{item.imdbRating.toFixed(1)}</span>
              {item.imdbVotes != null && (
                <span className="text-white/50">({formatCompact(item.imdbVotes)})</span>
              )}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
