import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { PageShell } from "@/components/PageShell";
import { DiscoverGrid } from "@/components/descopera/DiscoverGrid";
import { FeedView } from "@/components/descopera/FeedView";
import { FilterTabs, type DiscoverMode, type DiscoverTab } from "@/components/descopera/FilterTabs";
import { TopTorrentsGrid } from "@/components/descopera/TopTorrentsGrid";
import { requireAuthBeforeLoad } from "@/lib/auth/admin-route-guard";
import { DEFAULT_TOP_PERIOD, type TopPeriodHours } from "@/lib/filelist/top-torrents";
import { adminStatusQuery } from "@/lib/queries";
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
  const [selectedSort, setSort] = useState<DiscoverTab>("trending");
  const [media, setMedia] = useState<DiscoverMediaType | "all">("all");
  const [period, setPeriod] = useState<TopPeriodHours>(DEFAULT_TOP_PERIOD);
  const { data: adminData } = useQuery(adminStatusQuery);
  const isAdmin = !!adminData?.isAdmin;
  // Top Filelist e doar pentru admin; dacă statutul se schimbă cu tabul deschis,
  // se revine la Trending în loc de o grilă cu eroare.
  const sort = selectedSort === "filelist_top" && !isAdmin ? "trending" : selectedSort;

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
        isAdmin={isAdmin}
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
