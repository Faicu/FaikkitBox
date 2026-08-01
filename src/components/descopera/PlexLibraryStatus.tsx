import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

import { checkPlexHasTitle } from "@/lib/services/plex-library";
import type { DiscoverMediaType } from "@/lib/tmdb.discover.functions";

export function PlexLibraryStatus({
  title,
  originalTitle,
  mediaType,
}: {
  title: string;
  originalTitle: string;
  mediaType: DiscoverMediaType;
}) {
  const checkFn = useServerFn(checkPlexHasTitle);

  const query = useQuery({
    queryKey: ["plexHasTitle", mediaType, title, originalTitle],
    queryFn: () => checkFn({ data: { title, originalTitle, mediaType } }),
  });

  if (query.isLoading) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Se verifică în Plex...
      </div>
    );
  }

  if (!query.data) return null;

  if (query.data.found) {
    return (
      <span className="flex items-center gap-1.5 rounded-md bg-emerald-500/15 px-2 py-1 text-xs font-medium text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" />
        În librăria Plex{query.data.quality ? ` · ${query.data.quality}` : ""}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5 rounded-md bg-muted/40 px-2 py-1 text-xs font-medium text-muted-foreground">
      <XCircle className="h-3.5 w-3.5" />
      Nu e în librăria Plex
    </span>
  );
}
