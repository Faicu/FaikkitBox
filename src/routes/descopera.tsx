import { createFileRoute } from "@tanstack/react-router";

import { PageShell } from "@/components/PageShell";
import { DiscoverGrid } from "@/components/descopera/DiscoverGrid";

export const Route = createFileRoute("/descopera")({
  head: () => ({
    meta: [{ title: "Descoperă — Monitor Server" }],
  }),
  component: DescoperaPage,
});

function DescoperaPage() {
  return (
    <PageShell title="Descoperă" subtitle="Filme · Seriale · Trailere">
      <DiscoverGrid />
    </PageShell>
  );
}
