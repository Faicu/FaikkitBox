import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus, LogIn, UserPlus, Sparkles } from "lucide-react";
import { useState } from "react";

import { PageShell } from "@/components/PageShell";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { AddMediaWizard } from "@/components/principala/AddMediaWizard";
import { FilelistSection } from "@/components/filelist/FilelistSection";
import { SupportWidget } from "@/components/principala/SupportWidget";
import { PlexWidget } from "@/components/principala/PlexWidget";
import { RecentWatchesWidget } from "@/components/principala/RecentWatchesWidget";
import { plexQuery, plexSessionsQuery, adminStatusQuery, recentWatchesQuery } from "@/lib/queries";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Prezentare generală — Monitor Server" },
      {
        name: "description",
        content: "Stare în timp real pentru Plex.",
      },
    ],
  }),
  component: Overview,
});

function Overview() {
  const { data: adminData } = useQuery(adminStatusQuery);
  const isAuthenticated = !!adminData?.isAuthenticated;
  const isAdmin = !!adminData?.isAdmin;
  const plex = useQuery({ ...plexQuery, enabled: isAuthenticated });
  const plexSessions = useQuery({ ...plexSessionsQuery, enabled: isAuthenticated });
  const recentWatches = useQuery({
    ...recentWatchesQuery,
    enabled: isAuthenticated,
  });
  const recentWatchItems = recentWatches.data?.status === "ok" ? recentWatches.data.items : [];
  const sessions =
    plexSessions.data?.status === "ok" ? plexSessions.data.sessions : plex.data?.sessions;
  const [plexDrawer, setPlexDrawer] = useState<"views" | "users" | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  return (
    <PageShell title="FaikkitBox" subtitle="Panou de Administrare Plex">
      {/* Contribuția lunară stă prima pentru toți cei logați, deasupra lui
          „Adaugă film/serial". */}
      {isAuthenticated && (
        <div className="mb-4">
          <SupportWidget />
        </div>
      )}

      {isAuthenticated ? (
        <button
          type="button"
          onClick={() => setWizardOpen(true)}
          className="border-flow mb-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border/60 bg-card py-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted/60 active:scale-[0.99]"
        >
          <Plus className="h-4 w-4" /> Adaugă film/serial
        </button>
      ) : (
        <div className="mb-4 rounded-2xl border border-primary/30 bg-primary/5 p-4 text-center">
          <Sparkles className="mx-auto h-6 w-6 text-primary" />
          <p className="mt-2 text-sm font-semibold text-foreground">
            Autentifică-te ca să adaugi filme și seriale
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Contul tău trebuie să corespundă unui membru din biblioteca Plex.
          </p>
          <div className="mt-3 flex gap-2">
            <Link
              to="/register"
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl glass-card glass-card-hover press-tile py-2 text-sm font-medium text-foreground"
            >
              <UserPlus className="h-4 w-4" /> Înregistrare
            </Link>
            <Link
              to="/login"
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 active:scale-[0.99]"
            >
              <LogIn className="h-4 w-4" /> Autentificare
            </Link>
          </div>
        </div>
      )}

      {isAdmin && (
        <div className="mb-4">
          <FilelistSection />
        </div>
      )}

      {isAuthenticated && (
        <PlexWidget
          data={plex.data}
          isLoading={plex.isLoading}
          sessions={sessions}
          onOpenViews={() => setPlexDrawer("views")}
          onOpenUsers={() => setPlexDrawer("users")}
        />
      )}

      {isAuthenticated && recentWatchItems.length > 0 && (
        <RecentWatchesWidget items={recentWatchItems} />
      )}

      <Drawer open={plexDrawer === "views"} onOpenChange={(o) => !o && setPlexDrawer(null)}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="text-left">
            <DrawerTitle>Vizionate Azi</DrawerTitle>
            <DrawerDescription>
              {plex.data?.status === "ok" ? `${plex.data.todayViews?.length ?? 0} vizionări` : ""}
            </DrawerDescription>
          </DrawerHeader>
          <div className="overflow-y-auto overscroll-contain px-4 pb-6">
            {plex.data?.status === "ok" && (plex.data.todayViews?.length ?? 0) > 0 ? (
              <ul className="rounded-2xl glass-card divide-y divide-border stagger-in">
                {plex.data.todayViews!.map((e, i) => {
                  const seasonEp =
                    e.season != null && e.episode != null
                      ? `S${String(e.season).padStart(2, "0")}E${String(e.episode).padStart(2, "0")}`
                      : null;
                  const heading = e.show
                    ? `${e.show}${seasonEp ? ` — ${seasonEp}` : ""}${e.title ? ` · ${e.title}` : ""}`
                    : e.title;
                  return (
                    <li key={i} className="px-3 py-2 text-sm">
                      <div className="truncate">{heading}</div>
                      <div className="mt-0.5 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span className="truncate">{e.user ?? "—"}</span>
                        <span className="tabular-nums shrink-0 pl-2">
                          {e.viewedAt > 0 ? new Date(e.viewedAt * 1000).toLocaleTimeString() : "—"}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="rounded-xl glass-card p-4 text-sm text-muted-foreground">
                Nicio vizionare azi.
              </div>
            )}
          </div>
        </DrawerContent>
      </Drawer>

      <Drawer open={plexDrawer === "users"} onOpenChange={(o) => !o && setPlexDrawer(null)}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="text-left">
            <DrawerTitle>Utilizatori activi azi</DrawerTitle>
            <DrawerDescription>
              {plex.data?.status === "ok"
                ? `${plex.data.activeUsersTodayList?.length ?? 0} utilizatori`
                : ""}
            </DrawerDescription>
          </DrawerHeader>
          <div className="overflow-y-auto overscroll-contain px-4 pb-6">
            {plex.data?.status === "ok" && (plex.data.activeUsersTodayList?.length ?? 0) > 0 ? (
              <ul className="rounded-2xl glass-card divide-y divide-border stagger-in">
                {plex.data.activeUsersTodayList!.map((u, i) => (
                  <li key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="truncate">{u.user}</span>
                    <span className="shrink-0 pl-2 text-xs font-medium tabular-nums text-muted-foreground">
                      {u.count} {u.count === 1 ? "vizionare" : "vizionări"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-xl glass-card p-4 text-sm text-muted-foreground">
                Niciun utilizator activ azi.
              </div>
            )}
          </div>
        </DrawerContent>
      </Drawer>

      {isAuthenticated && <AddMediaWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />}
    </PageShell>
  );
}
