import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { LayoutGrid, Zap } from "lucide-react";

import { PageShell } from "@/components/PageShell";
import { DiscoverGrid } from "@/components/descopera/DiscoverGrid";
import { FeedView } from "@/components/descopera/FeedView";
import { FilterTabs } from "@/components/descopera/FilterTabs";
import { requireAuthBeforeLoad } from "@/lib/auth/admin-route-guard";
import type { DiscoverMediaType, DiscoverSort } from "@/lib/tmdb/tmdb.discover.functions";

export const Route = createFileRoute("/descopera")({
  beforeLoad: requireAuthBeforeLoad,
  head: () => ({
    meta: [{ title: "Descoperă — Monitor Server" }],
  }),
  component: DescoperaPage,
});

function DescoperaPage() {
  const [mode, setMode] = useState<"grid" | "feed">("grid");
  const [sort, setSort] = useState<DiscoverSort>("trending");
  const [media, setMedia] = useState<DiscoverMediaType | "all">("all");

  return (
    <PageShell title="Descoperă" subtitle="Filme · Seriale · Trailere">
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        <button
          type="button"
          onClick={() => setMode("grid")}
          className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all active:scale-95 ${
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
          className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all active:scale-95 ${
            mode === "feed"
              ? "bg-primary text-primary-foreground"
              : "bg-muted/60 text-muted-foreground hover:text-foreground"
          }`}
        >
          <Zap className="h-3.5 w-3.5" /> Feed
        </button>
        <div className="mx-0.5 h-5 w-px shrink-0 self-center bg-border" />
        <FilterTabs sort={sort} media={media} onSortChange={setSort} onMediaChange={setMedia} />
      </div>

      {mode === "grid" ? (
        <DiscoverGrid sort={sort} media={media} />
      ) : (
        <FeedView sort={sort} media={media} />
      )}
    </PageShell>
  );
}
