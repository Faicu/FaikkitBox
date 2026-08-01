import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, Pin } from "lucide-react";

import { addPinnedItem } from "@/lib/pinned.functions";
import { pinnedItemsQuery } from "@/lib/queries";
import type { DiscoverMediaType } from "@/lib/tmdb.discover.functions";

export function PinToLansariButton({
  id,
  title,
  originalTitle,
  posterUrl,
  mediaType,
  isAdmin,
}: {
  id: number;
  title: string;
  originalTitle: string;
  posterUrl: string | null;
  mediaType: DiscoverMediaType;
  isAdmin: boolean;
}) {
  const queryClient = useQueryClient();
  const addPinnedFn = useServerFn(addPinnedItem);
  const [pinning, setPinning] = useState(false);

  const pinnedQuery = useQuery({ ...pinnedItemsQuery, enabled: isAdmin });

  if (!isAdmin) return null;

  const isPinned = pinnedQuery.data?.some((p) => p.id === id && p.mediaType === mediaType) ?? false;

  const handlePin = async () => {
    setPinning(true);
    try {
      await addPinnedFn({ data: { id, mediaType, title, originalTitle, posterUrl } });
      await queryClient.invalidateQueries({ queryKey: ["pinnedItems"] });
    } finally {
      setPinning(false);
    }
  };

  if (isPinned) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400">
        <Check className="h-3.5 w-3.5" /> Fixat în Lansări
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handlePin}
      disabled={pinning || pinnedQuery.isLoading}
      className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/60 disabled:opacity-50"
    >
      {pinning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pin className="h-3.5 w-3.5" />}
      Fixează în Lansări
    </button>
  );
}
