import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { PageShell } from "@/components/PageShell";
import { DiscoverGrid } from "@/components/descopera/DiscoverGrid";
import { FeedView } from "@/components/descopera/FeedView";
import { FilterTabs, type DiscoverMode, type DiscoverTab } from "@/components/descopera/FilterTabs";
import { TopTorrentsGrid } from "@/components/descopera/TopTorrentsGrid";
import { requireAuthBeforeLoad } from "@/lib/auth/admin-route-guard";
import { DEFAULT_TOP_PERIOD, type TopPeriodHours } from "@/lib/filelist/top-torrents";
import type { DiscoverMediaType } from "@/lib/tmdb/tmdb.discover.functions";

export const Route = createFileRoute("/descopera")({
  beforeLoad: requireAuthBeforeLoad,
  head: () => ({
    meta: [{ title: "Descoperă — Monitor Server" }],
  }),
  component: DescoperaPage,
});

function DescoperaPage() {
  const [mode, setMode] = useState<DiscoverMode>("grid");
  const [sort, setSort] = useState<DiscoverTab>("trending");
  const [media, setMedia] = useState<DiscoverMediaType | "all">("all");
  const [period, setPeriod] = useState<TopPeriodHours>(DEFAULT_TOP_PERIOD);

  return (
    <PageShell title="Descoperă" subtitle="Filme · Seriale · Trailere">
      <FilterTabs
        sort={sort}
        media={media}
        mode={mode}
        period={period}
        onSortChange={setSort}
        onMediaChange={setMedia}
        onModeChange={setMode}
        onPeriodChange={setPeriod}
      />

      {sort === "filelist_top" ? (
        <TopTorrentsGrid media={media} hours={period} />
      ) : mode === "grid" ? (
        <DiscoverGrid sort={sort} media={media} />
      ) : (
        <FeedView sort={sort} media={media} />
      )}
    </PageShell>
  );
}
