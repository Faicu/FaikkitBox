import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { LayoutGrid, Zap } from "lucide-react";

import { PageShell } from "@/components/PageShell";
import { DiscoverGrid } from "@/components/descopera/DiscoverGrid";
import { FeedView } from "@/components/descopera/FeedView";
import { FilterTabs } from "@/components/descopera/FilterTabs";
import { adminStatusQuery } from "@/lib/queries";
import type { DiscoverMediaType, DiscoverSort } from "@/lib/tmdb.discover.functions";

export const Route = createFileRoute("/descopera")({
  head: () => ({
    meta: [{ title: "Descoperă — Monitor Server" }],
  }),
  component: DescoperaPage,
});

function DescoperaPage() {
  const { data: adminData } = useQuery(adminStatusQuery);
  const isAdmin = !!adminData?.isAdmin;

  const [mode, setMode] = useState<"grid" | "feed">("grid");
  const [sort, setSort] = useState<DiscoverSort>("trending");
  const [media, setMedia] = useState<DiscoverMediaType | "all">("all");

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

      <FilterTabs sort={sort} media={media} onSortChange={setSort} onMediaChange={setMedia} />

      {mode === "grid" ? (
        <DiscoverGrid sort={sort} media={media} isAdmin={isAdmin} />
      ) : (
        <FeedView sort={sort} media={media} isAdmin={isAdmin} />
      )}
    </PageShell>
  );
}
