import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Search, Loader2 } from "lucide-react";

import { searchFilelist } from "@/lib/filelist.functions";
import { detectQuality } from "@/components/lansari/utils";
import type { DiscoverMediaType } from "@/lib/tmdb.discover.functions";

export function FilelistCheckButton({
  title,
  mediaType,
  isAdmin,
}: {
  title: string;
  mediaType: DiscoverMediaType;
  isAdmin: boolean;
}) {
  const [checked, setChecked] = useState(false);
  const searchFn = useServerFn(searchFilelist);

  const query = useQuery({
    queryKey: ["filelistCheck", mediaType, title],
    queryFn: () =>
      searchFn({ data: { query: title, category: mediaType === "movie" ? "movies" : "series" } }),
    enabled: checked,
  });

  if (!isAdmin) return null;

  if (!checked) {
    return (
      <button
        type="button"
        onClick={() => setChecked(true)}
        className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/60"
      >
        <Search className="h-3.5 w-3.5" /> Verifică pe Filelist
      </button>
    );
  }

  if (query.isLoading) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Se verifică...
      </div>
    );
  }

  const torrents = query.data?.status === "ok" ? query.data.torrents : [];
  const t1080 = torrents.filter((t) => detectQuality(t.name).is1080p).length;
  const t4k = torrents.filter((t) => detectQuality(t.name).is4k).length;
  const t4kHdr = torrents.filter((t) => detectQuality(t.name).is4kHdr).length;

  if (query.data?.status === "error") {
    return <div className="text-xs text-red-400">Eroare Filelist: {query.data.error}</div>;
  }

  if (torrents.length === 0) {
    return <div className="text-xs text-muted-foreground">Niciun torrent găsit pe Filelist.</div>;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {t1080 > 0 && (
        <span className="rounded-md bg-emerald-500/15 px-2 py-1 font-medium text-emerald-400">
          1080p · {t1080}
        </span>
      )}
      {t4k > 0 && (
        <span className="rounded-md bg-emerald-500/15 px-2 py-1 font-medium text-emerald-400">
          4K · {t4k}
        </span>
      )}
      {t4kHdr > 0 && (
        <span className="rounded-md bg-emerald-500/15 px-2 py-1 font-medium text-emerald-400">
          4K HDR · {t4kHdr}
        </span>
      )}
    </div>
  );
}
