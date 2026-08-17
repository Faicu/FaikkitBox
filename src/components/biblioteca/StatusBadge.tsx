import { Download } from "lucide-react";

import type { PlexBrowseItem } from "@/lib/services/plex-browse";

export function StatusBadge({
  status,
  progress,
}: {
  status: PlexBrowseItem["status"];
  progress?: number | null;
}) {
  if (status === "downloading") {
    return (
      <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
        <Download className="h-2.5 w-2.5" /> Se descarcă
        {progress != null && ` · ${progress.toFixed(0)}%`}
      </span>
    );
  }
  return null;
}
