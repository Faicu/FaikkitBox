import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Film, Tag, User, CalendarClock, RefreshCw, XCircle } from "lucide-react";

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { getWantedMovieDetail, setMovieWatch, checkMovieNow } from "@/lib/media/media.functions";
import { Orb } from "@/components/ui/orb";
import { relativeTime } from "@/components/tehnic/utils";

// Detaliile unui film așteptat. Drawer propriu, nu TitleDetailDrawer: acela e
// construit în jurul Plex-ului, episoadelor și subtitrărilor, care aici nu
// există — ar fi ieșit un ecran cu jumătate din secțiuni goale.
export function WantedMovieDrawer({
  mediaId,
  onClose,
}: {
  mediaId: number | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const detailFn = useServerFn(getWantedMovieDetail);
  const setMovieWatchFn = useServerFn(setMovieWatch);
  const checkNowFn = useServerFn(checkMovieNow);

  const { data: d, isLoading } = useQuery({
    queryKey: ["wanted-movie", mediaId],
    queryFn: () => detailFn({ data: { mediaId: mediaId! } }),
    enabled: mediaId != null,
  });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["wanted-movies"] });
    queryClient.invalidateQueries({ queryKey: ["wanted-movie", mediaId] });
  }

  async function stopWatch() {
    if (!d?.tmdbId) return;
    setBusy(true);
    try {
      const res = await setMovieWatchFn({
        data: { tmdbId: d.tmdbId, enabled: false },
      }).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
      if (!res.ok) {
        toast.error("Nu am putut opri urmărirea", { description: res.error });
        return;
      }
      refresh();
      toast.success(`Nu mai aștepți „${d.title}”`);
      // Rândul tocmai a fost șters — drawer-ul n-ar mai avea ce afișa.
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function checkNow() {
    if (!d) return;
    setBusy(true);
    try {
      const res = await checkNowFn({ data: { mediaId: d.mediaId } }).catch((e) => ({
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      }));
      if (!res.ok) {
        toast.error("Verificarea a eșuat", { description: res.error });
        return;
      }
      refresh();
      if (res.outcome.downloaded) {
        queryClient.invalidateQueries({ queryKey: ["plexLibraryBrowse"] });
        toast.success(`„${d.title}” a apărut — descărcare pornită`);
        onClose();
      } else {
        toast.info(res.outcome.skipped ?? "încă nimic");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open={mediaId != null} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="pb-2 text-left">
          <DrawerTitle className="flex items-center gap-2 text-base">
            <Orb state="searching" px={18} />
            <span className="min-w-0 flex-1 truncate">{d?.title ?? "Se încarcă…"}</span>
          </DrawerTitle>
          <DrawerDescription className="text-left">
            {d?.originalTitle && d.originalTitle !== d.title ? d.originalTitle : "Film așteptat"}
            {d?.year ? ` · ${d.year}` : ""}
          </DrawerDescription>
        </DrawerHeader>

        {isLoading && <div className="px-4 pb-6 text-xs text-muted-foreground">Se încarcă…</div>}

        {d && (
          <div className="max-h-[65vh] space-y-2.5 overflow-y-auto overscroll-contain px-4 pb-6 stagger-in">
            <div className="flex gap-3">
              {d.posterPath ? (
                <img
                  src={d.posterPath}
                  className="h-32 w-[86px] shrink-0 rounded-lg bg-muted object-cover"
                  alt=""
                />
              ) : (
                <div className="flex h-32 w-[86px] shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Film className="h-6 w-6 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0 flex-1 space-y-1.5">
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-400">
                  <Tag className="h-3 w-3" />
                  {d.quality}
                </span>
                {d.genres.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {d.genres.map((g) => (
                      <span
                        key={g}
                        className="rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      >
                        {g}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {d.overview && (
              <p className="rounded-2xl glass-card p-3 text-xs leading-relaxed text-muted-foreground">
                {d.overview}
              </p>
            )}

            <div className="rounded-2xl glass-card divide-y divide-border/50 text-xs">
              <Row icon={<User className="h-3.5 w-3.5" />} label="Adăugat de">
                {d.requestedByUsername ?? "necunoscut"}
              </Row>
              <Row icon={<CalendarClock className="h-3.5 w-3.5" />} label="Adăugat">
                {relativeTime(`${d.addedAt.replace(" ", "T")}Z`)}
              </Row>
              <Row icon={<RefreshCw className="h-3.5 w-3.5" />} label="Ultima verificare">
                {d.lastCheckedAt
                  ? relativeTime(`${d.lastCheckedAt.replace(" ", "T")}Z`)
                  : "prima verificare în curând"}
              </Row>
            </div>

            <div className="rounded-2xl glass-card p-3 text-[11px] leading-relaxed text-muted-foreground">
              Se caută pe Filelist strict după IMDb ({d.imdbId ?? "lipsă"}), la calitatea{" "}
              {d.quality}. Prima verificare vine la un minut după adăugare, apoi din 12 în 12 ore.
              Când filmul apare, descărcarea pornește singură și urmărirea se oprește.
            </div>

            {/* Butoanele stau aici, nu în rândul din listă: acolo erau trei
                ținte de atins într-un rând de câțiva milimetri. */}
            {d.canManage && (
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={checkNow}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                >
                  <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
                  Verifică acum
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={stopWatch}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 disabled:opacity-40"
                >
                  <XCircle className="h-4 w-4" />
                  Oprește
                </button>
              </div>
            )}
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1 text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}
