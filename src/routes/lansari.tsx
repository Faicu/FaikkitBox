import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { PageShell } from "@/components/PageShell";
import { requireAuthBeforeLoad } from "@/lib/admin-route-guard";
import { adminStatusQuery } from "@/lib/queries";
import { UnifiedSearchSection } from "@/components/lansari/sections/UnifiedSearchSection";
import { PinnedListSection } from "@/components/lansari/sections/PinnedListSection";
import { FilelistSection } from "@/components/lansari/sections/FilelistSection";
import { DownloadLogSection } from "@/components/lansari/sections/DownloadLogSection";

export const Route = createFileRoute("/lansari")({
  beforeLoad: requireAuthBeforeLoad,
  head: () => ({ meta: [{ title: "Lansări — Monitor Server" }] }),
  component: LansariPage,
});

function LansariPage() {
  const { data: adminData } = useQuery(adminStatusQuery);
  const isAdmin = !!adminData?.isAdmin;

  return (
    <PageShell title="Lansări" subtitle="Căutare, Monitorizare și Descărcare Filme/Seriale">
      {isAdmin && (
        <>
          <UnifiedSearchSection />
          <FilelistSection />
        </>
      )}
      <PinnedListSection />
      <DownloadLogSection />
    </PageShell>
  );
}
