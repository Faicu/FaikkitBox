import { createFileRoute } from "@tanstack/react-router";

import { PageShell } from "@/components/PageShell";
import { requireAuthBeforeLoad } from "@/lib/auth/admin-route-guard";
import { BibliotecaList } from "@/components/biblioteca/BibliotecaList";

// `?titlu=<mediaId>` deschide direct drawer-ul unui titlu — folosit de
// rândurile de torrent din Jurnalul de activitate.
export const Route = createFileRoute("/biblioteca")({
  validateSearch: (search: Record<string, unknown>): { titlu?: number } => {
    const id = Number(search.titlu);
    return Number.isInteger(id) && id > 0 ? { titlu: id } : {};
  },
  beforeLoad: requireAuthBeforeLoad,
  head: () => ({ meta: [{ title: "Bibliotecă — Monitor Server" }] }),
  component: BibliotecaPage,
});

function BibliotecaPage() {
  const { titlu } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <PageShell title="Bibliotecă" subtitle="Toate filmele și serialele din Plex">
      <BibliotecaList
        openMediaId={titlu ?? null}
        // Parametrul se consumă o dată: drawer-ul rămâne deschis din starea
        // listei, iar un refresh/înapoi nu-l mai redeschide.
        onOpenHandled={() => navigate({ search: {}, replace: true })}
      />
    </PageShell>
  );
}
