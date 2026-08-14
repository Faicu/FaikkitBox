import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { LayoutGrid, Zap } from "lucide-react";

import { PageShell } from "@/components/PageShell";
import { DiscoverGrid } from "@/components/descopera/DiscoverGrid";
import { FeedView } from "@/components/descopera/FeedView";
import { FilterTabs } from "@/components/descopera/FilterTabs";
import { requireAdminBeforeLoad } from "@/lib/admin-route-guard";
import type { DiscoverMediaType, DiscoverSort } from "@/lib/tmdb.discover.functions";

export const Route = createFileRoute("/descopera")({
  beforeLoad: requireAdminBeforeLoad,
  head: () => ({
    meta: [{ title: "Descoperă — Monitor Server" }],
  }),
  component: DescoperaPage,
});

function DescoperaPage() {
  const [mode, setMode] = useState<"grid" | "feed">("grid");
  const [sort, setSort] = useState<DiscoverSort>("trending");
  const [media, setMedia] = useState<DiscoverMediaType | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <PageShell title="Descoperă" subtitle="Filme · Seriale · Trailere">
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => setMode("grid")}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
            mode === "grid"
              ? "bg-primary text-primary-foreground"
              : "bg-muted/60 text-muted-foreground hover:text-foreground"
          }`}
        >
          <LayoutGrid className="h-3.5 w-3.5" /> Grilă
        </button>
        <button
          type="button"
          onClick={() => setMode("feed")}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
            mode === "feed"
              ? "bg-primary text-primary-foreground"
              : "bg-muted/60 text-muted-foreground hover:text-foreground"
          }`}
        >
          <Zap className="h-3.5 w-3.5" /> Feed
        </button>
      </div>

      <FilterTabs
        sort={sort}
        media={media}
        query={searchQuery}
        onSortChange={setSort}
        onMediaChange={setMedia}
        onQueryChange={setSearchQuery}
      />

      {mode === "grid" ? (
        <DiscoverGrid sort={sort} media={media} searchQuery={searchQuery} />
      ) : (
        <FeedView sort={sort} media={media} />
      )}
    </PageShell>
  );
}
