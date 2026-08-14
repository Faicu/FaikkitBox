import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { pinnedItemsQuery } from "@/lib/queries";
import { setPinnedItems, getWatchSettings, setWatchSettings } from "@/lib/pinned.functions";
import type { WatchSettings } from "@/lib/pinned.functions";
import type { PinnedItem } from "../types";
import { PinnedItemCard } from "../PinnedItemCard";

// ---------------------------------------------------------------------------
// Lista de fixări proprie — per utilizator, vizibilă oricui e autentificat
// (spre deosebire de bara de căutare din UnifiedSearchSection, admin-only)
// ---------------------------------------------------------------------------

export function PinnedListSection() {
  const queryClient = useQueryClient();
  const { data: pinned = [] } = useQuery(pinnedItemsQuery);
  const [watchMap, setWatchMap] = useState<Map<string, WatchSettings>>(new Map());
  const setPinnedFn = useServerFn(setPinnedItems);
  const getWatchFn = useServerFn(getWatchSettings);
  const setWatchFn = useServerFn(setWatchSettings);

  useEffect(() => {
    getWatchFn({})
      .then((settings) => {
        const map = new Map<string, WatchSettings>();
        for (const s of settings) map.set(`${s.mediaType}-${s.id}`, s);
        setWatchMap(map);
      })
      .catch(() => {});
  }, []);

  async function updateWatch(id: number, mediaType: "movie" | "tv", patch: Partial<WatchSettings>) {
    const key = `${mediaType}-${id}`;
    const current = watchMap.get(key) ?? {
      id,
      mediaType,
      watchFilelist: false,
      watchFilelistSeason: false,
      watchTmdb: false,
      autoDownload: false,
      autoDownloadQuality: "1080p" as const,
    };
    const next = { ...current, ...patch };
    // Dacă watchFilelist e dezactivat, dezactivăm și sub-toggle-urile
    if (!next.watchFilelist) {
      next.watchFilelistSeason = false;
      next.autoDownload = false;
    }
    setWatchMap((m) => new Map(m).set(key, next));
    await setWatchFn({ data: next }).catch(() => {});
  }

  async function savePinned(list: PinnedItem[]) {
    await setPinnedFn({ data: { items: list } }).catch(() => {});
    await queryClient.invalidateQueries({ queryKey: ["pinnedItems"] });
  }

  function unpin(id: number, mediaType: "movie" | "tv") {
    savePinned(pinned.filter((p) => !(p.id === id && p.mediaType === mediaType)));
  }

  if (pinned.length === 0) return null;

  return (
    <section className="space-y-3">
      {pinned.map((p) => {
        const ws = watchMap.get(`${p.mediaType}-${p.id}`) ?? {
          id: p.id,
          mediaType: p.mediaType,
          watchFilelist: false,
          watchFilelistSeason: false,
          watchTmdb: false,
          autoDownload: false,
          autoDownloadQuality: "1080p" as const,
        };
        return (
          <PinnedItemCard
            key={`${p.mediaType}-${p.id}`}
            item={p}
            watchSettings={ws}
            onWatchChange={(patch) => updateWatch(p.id, p.mediaType, patch)}
            onUnpin={() => unpin(p.id, p.mediaType)}
          />
        );
      })}
    </section>
  );
}
