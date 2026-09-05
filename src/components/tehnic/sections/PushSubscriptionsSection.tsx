import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BellRing, Laptop, Smartphone, Trash2, Globe, AppWindow } from "lucide-react";
import { toast } from "sonner";

import {
  listPushSubscriptions,
  deletePushSubscription,
  type PushSubscriptionRow,
} from "@/lib/notifications/push.functions";
import { formatDateTime, relativeTime } from "../utils";

/**
 * Nume citibil din user-agent. Deliberat grosier: ne interesează doar să
 * deosebim dispozitivele între ele într-o listă de 2-3 intrări, nu să facem
 * detecție exactă de browser.
 */
function deviceLabel(ua: string | null): string {
  if (!ua) return "Dispozitiv necunoscut";
  const mobile = /Android|iPhone|iPad|Mobile/i.test(ua);
  let os = "necunoscut";
  if (/Android/i.test(ua)) os = "Android";
  else if (/iPhone|iPad|iOS/i.test(ua)) os = "iOS";
  else if (/Windows/i.test(ua)) os = "Windows";
  else if (/Mac OS X|Macintosh/i.test(ua)) os = "macOS";
  else if (/Linux/i.test(ua)) os = "Linux";

  let browser = "";
  // Ordinea contează: Edge/Opera conțin și "Chrome" în UA.
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/OPR\/|Opera/i.test(ua)) browser = "Opera";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Chrome\//i.test(ua)) browser = "Chrome";
  else if (/Safari\//i.test(ua)) browser = "Safari";

  return [os, browser].filter(Boolean).join(" · ") + (mobile ? "" : "");
}

function isMobile(ua: string | null): boolean {
  return !!ua && /Android|iPhone|iPad|Mobile/i.test(ua);
}

export function PushSubscriptionsSection() {
  const qc = useQueryClient();
  const list = useServerFn(listPushSubscriptions);
  const del = useServerFn(deletePushSubscription);
  const [myTail, setMyTail] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["pushSubscriptions"],
    queryFn: () => list(),
  });

  // Coada endpoint-ului propriu, ca să putem marca rândul acestui dispozitiv.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setMyTail(sub ? sub.endpoint.slice(-12) : null))
      .catch(() => setMyTail(null));
  }, []);

  const remove = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => {
      toast.success("Abonament șters");
      setConfirmId(null);
      qc.invalidateQueries({ queryKey: ["pushSubscriptions"] });
    },
    onError: (e) => toast.error(`Ștergere eșuată: ${(e as Error).message}`),
  });

  const rows: PushSubscriptionRow[] = data ?? [];

  return (
    <section className="space-y-2">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        <BellRing className="h-3.5 w-3.5" /> Abonamente notificări ({rows.length})
      </h2>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-16 skeleton-sweep rounded-2xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl glass-card p-4 text-sm text-muted-foreground">
          Niciun dispozitiv abonat la notificări.
        </div>
      ) : (
        // Copiii direcți sunt div-uri simple, fără clasă care să seteze
        // `animation` pe element — altfel stagger-ul i-ar lăsa invizibili.
        <div className="rounded-2xl glass-card divide-y divide-border/50 stagger-in">
          {rows.map((r) => {
            const isMe = myTail != null && r.endpointTail === myTail;
            const standalone = r.displayMode === "standalone" || r.displayMode === "fullscreen";
            const known = r.displayMode != null;
            return (
              <div key={r.id} className="px-3 py-3">
                <div className="flex items-start gap-3">
                  <div className="shrink-0 pt-0.5">
                    {isMobile(r.userAgent) ? (
                      <Smartphone className="h-4 w-4 text-sky-400" />
                    ) : (
                      <Laptop className="h-4 w-4 text-purple-400" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium leading-tight">
                        {deviceLabel(r.userAgent)}
                      </span>
                      {isMe && (
                        <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                          <span className="live-dot" aria-hidden />
                          acest dispozitiv
                        </span>
                      )}
                      {known ? (
                        <span
                          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            standalone
                              ? "bg-primary/20 text-primary"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {standalone ? (
                            <>
                              <AppWindow className="h-2.5 w-2.5" /> PWA
                            </>
                          ) : (
                            <>
                              <Globe className="h-2.5 w-2.5" /> Browser
                            </>
                          )}
                        </span>
                      ) : (
                        <span
                          className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                          title="Abonament creat înainte ca aplicația să rețină contextul. Reabonează-te ca să apară."
                        >
                          context necunoscut
                        </span>
                      )}
                    </div>

                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      Înregistrat {formatDateTime(r.createdAt)}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {r.lastSeenAt
                        ? `Ultima trimitere acceptată ${relativeTime(r.lastSeenAt)}`
                        : "Nicio trimitere încă"}
                      <span className="ml-1.5 font-mono opacity-60">…{r.endpointTail}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setConfirmId(confirmId === r.id ? null : r.id)}
                    disabled={remove.isPending}
                    title="Șterge abonamentul"
                    className="press-tile shrink-0 rounded-md border border-red-500/30 bg-red-500/10 p-1.5 text-red-400 hover:bg-red-500/20 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Confirmare inline — un Dialog/AlertDialog aici ar putea ajunge
                    imbricat într-un Drawer și îngheța ecranul (vezi istoricul din
                    AddMediaWizard), așa că rămâne UI simplu. */}
                {confirmId === r.id && (
                  <div className="mt-2 animate-in fade-in-0 slide-in-from-top-1 duration-200 rounded-xl border border-red-500/30 bg-red-500/10 p-2.5">
                    <p className="text-xs text-muted-foreground">
                      {isMe
                        ? "Ștergi abonamentul acestui dispozitiv — nu vei mai primi notificări aici până nu le reactivezi."
                        : "Dispozitivul nu va mai primi notificări. Se poate reabona oricând din aplicație."}
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => remove.mutate(r.id)}
                        disabled={remove.isPending}
                        className="press-tile rounded-lg bg-red-500/20 px-2.5 py-1 text-xs font-medium text-red-400 hover:bg-red-500/30 disabled:opacity-50"
                      >
                        Șterge
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmId(null)}
                        className="press-tile rounded-lg bg-muted px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted/70"
                      >
                        Renunță
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
