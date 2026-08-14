import { createFileRoute } from "@tanstack/react-router";

import { PageShell } from "@/components/PageShell";
import { requireAdminBeforeLoad } from "@/lib/admin-route-guard";
import { UnifiedSearchSection } from "@/components/lansari/sections/UnifiedSearchSection";
import { FilelistSection } from "@/components/lansari/sections/FilelistSection";
import { DownloadLogSection } from "@/components/lansari/sections/DownloadLogSection";

export const Route = createFileRoute("/lansari")({
  beforeLoad: requireAdminBeforeLoad,
  head: () => ({ meta: [{ title: "Lansări — Monitor Server" }] }),
  component: LansariPage,
});

function LansariPage() {
  return (
    <PageShell title="Lansări" subtitle="Căutare, Monitorizare și Descărcare Filme/Seriale">
      <UnifiedSearchSection />
      <FilelistSection />
      <DownloadLogSection />
    </PageShell>
  );
}
