import { createFileRoute } from "@tanstack/react-router";

import { PageShell } from "@/components/PageShell";
import { UnifiedSearchSection } from "@/components/lansari/sections/UnifiedSearchSection";
import { FilelistSection } from "@/components/lansari/sections/FilelistSection";
import { DownloadLogSection } from "@/components/lansari/sections/DownloadLogSection";

export const Route = createFileRoute("/lansari")({
  head: () => ({ meta: [{ title: "Lansări — Monitor Server" }] }),
  component: LansariPage,
});

function LansariPage() {
  return (
    <PageShell title="Lansări" subtitle="Film · Serial · Filelist">
      <UnifiedSearchSection />
      <FilelistSection />
      <DownloadLogSection />
    </PageShell>
  );
}
