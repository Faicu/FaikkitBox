import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Mail,
  Phone,
  ShieldCheck,
  Clock,
  Film,
  Tv,
  LogIn,
  Calendar,
  Monitor,
  PlayCircle,
  Download,
  CheckCircle2,
  Loader2,
} from "lucide-react";

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { getUserDetail } from "@/lib/auth/users.functions";
import { formatDateTime as fmtDate } from "./utils";

function episodeCode(season: number | null, episode: number | null): string | null {
  return season != null && episode != null
    ? `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`
    : null;
}

export function UserDetailDrawer({ userId, onClose }: { userId: number; onClose: () => void }) {
  const detailFn = useServerFn(getUserDetail);
  const { data: user, isLoading } = useQuery({
    queryKey: ["userDetail", userId],
    queryFn: () => detailFn({ data: { id: userId } }),
  });

  return (
    <Drawer
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DrawerContent className="max-h-[90vh]">
        <DrawerHeader className="text-left pb-2">
          <DrawerTitle className="flex items-center gap-2">
            {user?.username ?? "Se încarcă..."}
            {user?.role === "admin" && (
              <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                <ShieldCheck className="h-3 w-3" /> Admin
              </span>
            )}
            {user?.status === "pending" && (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                În așteptare
              </span>
            )}
          </DrawerTitle>
          <DrawerDescription>Detalii cont, fixări și istoric autentificări</DrawerDescription>
        </DrawerHeader>

        <div className="space-y-4 overflow-y-auto overscroll-contain px-4 pb-6">
          {isLoading || !user ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Se încarcă...</div>
          ) : (
            <>
              {/* Contact */}
              <div className="rounded-2xl border border-border bg-card p-3 space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="break-all">{user.email ?? "—"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span>{user.phone ?? "—"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs text-muted-foreground">
                    Creat: {fmtDate(user.createdAt)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs text-muted-foreground">
                    Ultima autentificare: {fmtDate(user.lastLoginAt)}
                  </span>
                </div>
              </div>

              {/* Legătură Plex */}
              <div>
                <h3 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Legătură Plex
                </h3>
                {user.plexUsername ? (
                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3 text-sm space-y-1">
                    <div className="font-medium">{user.plexUsername}</div>
                    {user.plexEmail && (
                      <div className="text-xs text-muted-foreground">{user.plexEmail}</div>
                    )}
                    {user.plexAccountId != null && (
                      <div className="text-[10px] text-muted-foreground">
                        ID Plex: {user.plexAccountId}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-border bg-card p-3 text-xs text-muted-foreground">
                    Niciun cont Plex asociat.
                  </div>
                )}
              </div>

              {/* Titluri descărcate */}
              <div>
                <h3 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                  <Download className="h-3 w-3" /> Titluri descărcate ({user.downloads.length})
                </h3>
                {user.downloads.length === 0 ? (
                  <div className="rounded-2xl border border-border bg-card p-3 text-xs text-muted-foreground">
                    Nicio descărcare atribuită acestui cont (doar descărcările de după activarea
                    urmăririi apar aici).
                  </div>
                ) : (
                  <div className="rounded-2xl border border-border bg-card divide-y divide-border/50">
                    {user.downloads.map((d) => (
                      <div key={d.id} className="flex items-center gap-2.5 px-3 py-2">
                        {d.posterUrl ? (
                          <img
                            src={d.posterUrl}
                            alt=""
                            className="h-12 w-8 rounded object-cover shrink-0"
                          />
                        ) : (
                          <div className="flex h-12 w-8 shrink-0 items-center justify-center rounded bg-muted">
                            {d.mediaType === "movie" ? (
                              <Film className="h-3.5 w-3.5 text-muted-foreground" />
                            ) : (
                              <Tv className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">
                            {d.title}
                            {episodeCode(d.season, d.episode) && (
                              <span className="text-muted-foreground">
                                {" "}
                                — {episodeCode(d.season, d.episode)}
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                            {d.quality && <span>{d.quality}</span>}
                            {d.quality && <span>·</span>}
                            {d.completedAt ? (
                              <span className="flex items-center gap-0.5 text-emerald-400">
                                <CheckCircle2 className="h-2.5 w-2.5" /> {fmtDate(d.completedAt)}
                              </span>
                            ) : (
                              <span className="flex items-center gap-0.5 text-amber-400">
                                <Loader2 className="h-2.5 w-2.5 animate-spin" /> în curs
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Activitate Plex */}
              <div>
                <h3 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                  <PlayCircle className="h-3 w-3" /> Activitate Plex ({user.plexActivity.length})
                </h3>
                {!user.plexUsername ? (
                  <div className="rounded-2xl border border-border bg-card p-3 text-xs text-muted-foreground">
                    Fără cont Plex asociat.
                  </div>
                ) : user.plexActivity.length === 0 ? (
                  <div className="rounded-2xl border border-border bg-card p-3 text-xs text-muted-foreground">
                    Nicio activitate recentă (sau cache-ul Plex nu e încă populat).
                  </div>
                ) : (
                  <div className="rounded-2xl border border-border bg-card divide-y divide-border/50">
                    {user.plexActivity.map((e, i) => (
                      <div key={i} className="flex items-start gap-2 px-3 py-2 text-xs">
                        <div className="mt-0.5 shrink-0">
                          {e.type === "movie" ? (
                            <Film className="h-3.5 w-3.5 text-amber-400" />
                          ) : (
                            <Tv className="h-3.5 w-3.5 text-blue-400" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">
                            {e.show
                              ? `${e.show}${
                                  e.season != null && e.episode != null
                                    ? ` — S${String(e.season).padStart(2, "0")}E${String(e.episode).padStart(2, "0")}`
                                    : ""
                                }`
                              : e.title}
                          </div>
                          {e.show && (
                            <div className="truncate text-[10px] text-muted-foreground">
                              {e.title}
                            </div>
                          )}
                          <div className="text-[10px] text-muted-foreground">
                            {new Date(e.viewedAt * 1000).toLocaleString("ro-RO", {
                              day: "numeric",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                              timeZone: "Europe/Bucharest",
                            })}
                            {e.player ? ` · ${e.player}` : ""}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Istoric autentificări */}
              <div>
                <h3 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                  <LogIn className="h-3 w-3" /> Istoric autentificări ({user.logins.length})
                </h3>
                {user.logins.length === 0 ? (
                  <div className="rounded-2xl border border-border bg-card p-3 text-xs text-muted-foreground">
                    Nicio autentificare înregistrată încă.
                  </div>
                ) : (
                  <div className="rounded-2xl border border-border bg-card divide-y divide-border/50">
                    {user.logins.map((l) => (
                      <div key={l.id} className="px-3 py-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{fmtDate(l.loggedInAt)}</span>
                          <span className="text-muted-foreground">{l.ip ?? "IP necunoscut"}</span>
                        </div>
                        {l.userAgent && (
                          <div className="mt-0.5 flex items-start gap-1 text-[10px] text-muted-foreground">
                            <Monitor className="h-3 w-3 shrink-0 mt-0.5" />
                            <span className="break-all">{l.userAgent}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
