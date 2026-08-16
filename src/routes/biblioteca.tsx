import { createFileRoute } from "@tanstack/react-router";

import { PageShell } from "@/components/PageShell";
import { requireAuthBeforeLoad } from "@/lib/auth/admin-route-guard";
import { BibliotecaList } from "@/components/biblioteca/BibliotecaList";

export const Route = createFileRoute("/biblioteca")({
  beforeLoad: requireAuthBeforeLoad,
  head: () => ({ meta: [{ title: "Bibliotecă — Monitor Server" }] }),
  component: BibliotecaPage,
});

function BibliotecaPage() {
  return (
    <PageShell title="Bibliotecă" subtitle="Toate filmele și serialele din Plex">
      <BibliotecaList />
    </PageShell>
  );
}
