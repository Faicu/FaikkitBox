import { Film, Pin, Tv } from "lucide-react";

import type { WatchingItem } from "@/lib/services/plex-browse";
import { addedDate } from "./utils";

// Secțiune distinctă, deasupra listei principale de Bibliotecă — titluri
// DOAR fixate (nimic descărcat/în Plex încă). Complet separată și în DB:
// nu există niciun rând `media` în spate, sursa e direct `pinned_items`
// (vezi getPlexLibraryBrowse). De îndată ce apare ceva descărcat/în Plex
// pentru un titlu de-aici, dispare din secțiunea asta și apare în lista
// principală (cu badge-ul "Urmărești" în drawer-ul lui).
export function WatchingSection({
  items,
  onSelect,
}: {
  items: WatchingItem[];
  onSelect: (item: WatchingItem) => void;
}) {
  if (items.length === 0) return null;

  return (
    <div className="rounded-2xl border border-sky-500/20 bg-sky-500/5 p-3">
      <div className="mb-2 flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-sky-400">
        <Pin className="h-3.5 w-3.5" /> Urmărite ({items.length})
      </div>
      <div className="space-y-1">
        {items.map((item) => (
          <button
            key={`${item.mediaType}-${item.tmdbId}`}
            type="button"
            onClick={() => onSelect(item)}
            className="flex w-full items-center gap-2 rounded-lg bg-card/60 px-2 py-1.5 text-left transition-colors hover:bg-card active:bg-muted"
          >
            {item.posterUrl ? (
              <img
                src={item.posterUrl}
                className="h-8 w-8 shrink-0 rounded object-cover bg-muted"
                loading="lazy"
                alt=""
              />
            ) : item.mediaType === "movie" ? (
              <Film className="h-3.5 w-3.5 shrink-0 text-amber-400" />
            ) : (
              <Tv className="h-3.5 w-3.5 shrink-0 text-blue-400" />
            )}
            <span className="min-w-0 flex-1 truncate text-xs">{item.title}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {addedDate(item.addedAt)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
