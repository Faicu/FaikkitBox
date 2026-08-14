import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  PlayCircle,
  ChevronRight,
  Users,
  Tv,
  Film,
  Plus,
  LogIn,
  UserPlus,
  Music,
  Image as ImageIcon,
  Sparkles,
} from "lucide-react";
import { useState } from "react";

import { PageShell } from "@/components/PageShell";
import { ServicePill } from "@/components/ServicePill";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { AddMediaWizard } from "@/components/principala/AddMediaWizard";
import { PlexLibraryBrowse } from "@/components/principala/PlexLibraryBrowse";
import { plexQuery, plexSessionsQuery, adminStatusQuery } from "@/lib/queries";
import { formatSpeed } from "@/lib/format";

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
  const plex = useQuery(plexQuery);
  const plexSessions = useQuery(plexSessionsQuery);
  const { data: adminData } = useQuery(adminStatusQuery);
  const isAuthenticated = !!adminData?.isAuthenticated;
  const sessions =
    plexSessions.data?.status === "ok" ? plexSessions.data.sessions : plex.data?.sessions;
  const [plexDrawer, setPlexDrawer] = useState<"views" | "users" | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    fn();
  };

  return (
    <PageShell title="FaikkitBox" subtitle="Panou de Administrare Plex">
      {isAuthenticated ? (
        <button
          type="button"
          onClick={() => setWizardOpen(true)}
          className="mb-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card py-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted/60 active:scale-[0.99]"
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
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-card py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/60 active:scale-[0.99]"
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ServiceRow
          className="sm:col-span-2"
          to="/plex"
          title="Plex"
          icon={<PlayCircle className="h-5 w-5" />}
          accent="text-amber-400"
          status={plex.isLoading ? "loading" : (plex.data?.status ?? "error")}
          error={plex.data?.error}
        >
          {plex.data?.status === "ok" && (
            <div className="space-y-2 text-sm">
              {(sessions?.length ?? 0) > 0 ? (
                <div className="space-y-1.5">
                  {sessions!.map((s, i) => {
                    const pct =
                      s.durationMs > 0 ? Math.round((s.viewOffsetMs / s.durationMs) * 100) : 0;
                    const fmt = (ms: number) => {
                      const t = Math.floor(ms / 1000);
                      const h = Math.floor(t / 3600);
                      const m = Math.floor((t % 3600) / 60);
                      const sec = t % 60;
                      return h > 0
                        ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
                        : `${m}:${String(sec).padStart(2, "0")}`;
                    };
                    const isEpisode = !!s.grandparentTitle;
                    return (
                      <div key={i} className="rounded-lg bg-muted/40 px-2.5 py-2 space-y-1.5">
                        <div className="flex items-start gap-2">
                          {s.thumbPath && (
                            <img
                              src={`/api/plex-thumb?path=${encodeURIComponent(s.thumbPath)}`}
                              className="h-14 w-10 rounded object-cover shrink-0 bg-muted"
                              loading="lazy"
                              alt=""
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <div className="truncate text-sm font-semibold leading-tight">
                                {isEpisode ? s.grandparentTitle : s.title}
                              </div>
                              {s.playerState === "paused" ? (
                                <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                                  ⏸ Pauză
                                </span>
                              ) : (
                                <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                                  ▶ Redare
                                </span>
                              )}
                            </div>
                            {isEpisode && (
                              <div className="truncate text-[11px] text-muted-foreground">
                                {s.title}
                              </div>
                            )}
                            <div className="text-[11px] text-muted-foreground">
                              {s.user} · {s.player}
                            </div>
                          </div>
                        </div>
                        {s.durationMs > 0 && (
                          <div className="space-y-0.5">
                            <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                              <div
                                className="h-full rounded-full bg-amber-400 transition-all"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <div className="flex justify-between text-[10px] text-muted-foreground">
                              <span>{fmt(s.viewOffsetMs)}</span>
                              <span>{pct}%</span>
                              <span>{fmt(s.durationMs)}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1 rounded-lg bg-muted/40 py-4 text-center">
                  <Users className="h-5 w-5 text-muted-foreground/60" />
                  <div className="text-sm font-semibold">Nimeni nu se uită acum</div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={stop(() => setPlexDrawer("views"))}
                  className="rounded-lg bg-muted/40 px-2.5 py-2.5 text-center transition-colors hover:bg-muted/60 active:bg-muted"
                >
                  <div className="flex flex-col items-center">
                    <div className="text-2xl font-bold tabular-nums">
                      {String(plex.data.episodesToday ?? 0)}
                    </div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Vizionate azi
                    </div>
                  </div>
                  {(plex.data.todayViews?.length ?? 0) > 0 && (
                    <div className="mt-1.5 space-y-0.5 border-t border-border/60 pt-1.5 text-left">
                      {plex.data.todayViews!.slice(0, 5).map((v, i) => (
                        <div key={i} className="truncate text-[10px] text-muted-foreground">
                          {v.show ?? v.title}
                        </div>
                      ))}
                    </div>
                  )}
                </button>
                <button
                  type="button"
                  onClick={stop(() => setPlexDrawer("users"))}
                  className="rounded-lg bg-muted/40 px-2.5 py-2.5 text-center transition-colors hover:bg-muted/60 active:bg-muted"
                >
                  <div className="flex flex-col items-center">
                    <div className="text-2xl font-bold tabular-nums">
                      {String(plex.data.activeUsersToday ?? 0)}
                    </div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Utilizatori activi azi
                    </div>
                  </div>
                  {(plex.data.activeUsersTodayList?.length ?? 0) > 0 && (
                    <div className="mt-1.5 space-y-0.5 border-t border-border/60 pt-1.5 text-left">
                      {plex.data.activeUsersTodayList!.slice(0, 5).map((u, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between gap-1 text-[10px] text-muted-foreground"
                        >
                          <span className="truncate">{u.user}</span>
                          <span className="shrink-0 tabular-nums">{u.count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </button>
              </div>

              {plex.data.libraries.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    Biblioteci
                  </div>
                  <div className="flex flex-wrap justify-center gap-1.5">
                    {plex.data.libraries.map((lib) => (
                      <div
                        key={lib.key}
                        className="flex w-[110px] flex-col items-center gap-1 rounded-lg bg-muted/40 py-2.5 text-center"
                      >
                        {libIcon(lib.type)}
                        <div className="text-lg font-bold tabular-nums">{lib.count ?? "—"}</div>
                        <div className="truncate text-[10px] leading-tight text-muted-foreground">
                          {lib.title}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {isAuthenticated && <PlexLibraryBrowse />}
            </div>
          )}
        </ServiceRow>
      </div>

      <Drawer open={plexDrawer === "views"} onOpenChange={(o) => !o && setPlexDrawer(null)}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="text-left">
            <DrawerTitle>Vizionate Azi</DrawerTitle>
            <DrawerDescription>
              {plex.data?.status === "ok" ? `${plex.data.todayViews?.length ?? 0} vizionări` : ""}
            </DrawerDescription>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-6">
            {plex.data?.status === "ok" && (plex.data.todayViews?.length ?? 0) > 0 ? (
              <ul className="rounded-2xl border border-border bg-card divide-y divide-border">
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
              <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
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
          <div className="overflow-y-auto px-4 pb-6">
            {plex.data?.status === "ok" && (plex.data.activeUsersTodayList?.length ?? 0) > 0 ? (
              <ul className="rounded-2xl border border-border bg-card divide-y divide-border">
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
              <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
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

function ServiceRow({
  to,
  title,
  icon,
  accent,
  status,
  error,
  children,
  className,
}: {
  to: "/plex";
  title: string;
  icon: React.ReactNode;
  accent: string;
  status: "ok" | "error" | "loading";
  error?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      to={to}
      className={`block rounded-2xl border border-border bg-card p-4 active:scale-[0.99] transition-transform ${className ?? ""}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className={`${accent}`}>{icon}</span>
          <span className="font-semibold">{title}</span>
          <ServicePill status={status} />
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </div>
      {status === "error" && error && (
        <p className="mt-2 text-xs text-red-400 break-words">{error}</p>
      )}
      {children && <div className="mt-3">{children}</div>}
    </Link>
  );
}

function libIcon(type: string) {
  if (type === "movie") return <Film className="h-4 w-4 shrink-0 text-amber-400" />;
  if (type === "show") return <Tv className="h-4 w-4 shrink-0 text-blue-400" />;
  if (type === "artist") return <Music className="h-4 w-4 shrink-0 text-purple-400" />;
  if (type === "photo") return <ImageIcon className="h-4 w-4 shrink-0 text-emerald-400" />;
  return <Film className="h-4 w-4 shrink-0 text-muted-foreground" />;
}
