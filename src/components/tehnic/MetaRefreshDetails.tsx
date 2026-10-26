import { Film, Tv } from "lucide-react";

import type { ActivityEntry } from "@/lib/activity-log.functions";
import { metaItems } from "./meta-items";

// O intrare `metadata_refresh` din jurnal (vezi src/lib/media/metadata-report.ts):
// ce titluri s-au schimbat și cum. Folosit inline în drawer-ul Watcher
// (Seriale și filme); în Jurnalul de activitate nu mai apare.
export function MetaRefreshDetails({ entry }: { entry: ActivityEntry }) {
  const items = metaItems(entry);
  if (items.length === 0) {
    return (
      <div className="text-[11px] text-muted-foreground">
        Totul era deja la zi — TMDB n-a adus nimic nou.
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {items.map((it, i) => (
        <div key={`${it.title}-${i}`} className="rounded-lg bg-muted/40 px-2 py-1.5 text-[11px]">
          <div className="flex items-center gap-1.5 font-medium text-foreground">
            {it.kind === "movie" ? (
              <Film className="h-3 w-3 shrink-0 text-amber-400" />
            ) : (
              <Tv className="h-3 w-3 shrink-0 text-blue-400" />
            )}
            <span className="min-w-0 truncate">{it.title}</span>
          </div>
          {it.fields && (
            <div className="mt-0.5 leading-relaxed text-muted-foreground">{it.fields}</div>
          )}
          {it.episodes && (
            <ul className="mt-0.5 space-y-0.5 leading-relaxed text-muted-foreground">
              {it.episodes.split("\n").map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
