import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Download, Film, Loader2, RefreshCw, Search, User } from "lucide-react";

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { getWantedMovieDetail, setMovieWatch, checkMovieNow } from "@/lib/media/media.functions";
import { Orb } from "@/components/ui/orb";
import { dayTimeLabel, lastCheckedLabel } from "./utils";
import { QualityButton, QualityChecklist } from "./QualityChecklist";

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
  const [checking, setChecking] = useState(false);
  const [pickingQuality, setPickingQuality] = useState(false);
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

  // Principala și rezerva vin împreună din lista de bifat (QualityChecklist).
  async function setQualities(quality: string, fallbackQuality: string | null) {
    if (!d?.tmdbId) return;
    setBusy(true);
    try {
      const res = await setMovieWatchFn({
        data: { tmdbId: d.tmdbId, enabled: true, quality, fallbackQuality },
      }).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
      if (!res.ok) {
        toast.error("Nu am putut schimba calitatea", { description: res.error });
        return;
      }
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function checkNow() {
    if (!d) return;
    setBusy(true);
    setChecking(true);
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
      setChecking(false);
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

            {/* Același card ca la serialele urmărite (TitleDetailDrawer):
                stare + acțiuni, ce se caută + calitatea, apoi ultima
                verificare. */}
            <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3 border-flow">
              <div className="flex items-center gap-2">
                <Orb state="searching" px={18} label="Așteptat" />
                <span className="flex-1 text-xs font-medium">Așteptat</span>
                {/* Butoanele stau aici, nu în rândul din listă: acolo erau
                    trei ținte de atins într-un rând de câțiva milimetri. */}
                {d.canManage && (
                  <>
                    <button
                      type="button"
                      onClick={checkNow}
                      disabled={busy}
                      className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-muted/60 disabled:opacity-40"
                    >
                      {checking ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3" />
                      )}
                      Verifică acum
                    </button>
                    <button
                      type="button"
                      onClick={stopWatch}
                      disabled={busy}
                      className="rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 disabled:opacity-40"
                    >
                      Oprește
                    </button>
                  </>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                  <Search className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Se caută pe Filelist</span>
                </span>
                {d.canManage ? (
                  <QualityButton
                    primary={d.quality}
                    fallback={d.fallbackQuality}
                    open={pickingQuality}
                    disabled={busy}
                    onToggle={() => setPickingQuality((v) => !v)}
                  />
                ) : (
                  <span className="shrink-0 text-[11px] font-medium">
                    {d.quality}
                    {d.fallbackQuality ? ` + ${d.fallbackQuality}` : ""}
                  </span>
                )}
              </div>

              {/* Inline, nu Popover Radix — un overlay imbricat în Drawer-ul
                  vaul îngheață ecranul (vezi commit c76ce30). */}
              {d.canManage && pickingQuality && (
                <QualityChecklist
                  primary={d.quality}
                  fallback={d.fallbackQuality}
                  disabled={busy}
                  onChange={setQualities}
                />
              )}

              {/* Prima verificare vine la un minut după adăugare, apoi din 12
                  în 12 ore; la prima descărcare reușită urmărirea se stinge. */}
              <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
                <Download className="mt-px h-3 w-3 shrink-0 text-primary" />
                <span className="flex-1">Se descarcă automat când apare pe Filelist.</span>
                <span className="shrink-0 text-[10px]">
                  {d.lastCheckedAt
                    ? lastCheckedLabel(d.lastCheckedAt)
                    : "Prima verificare în curând"}
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-border/60 bg-muted/30 text-xs">
              <div className="flex items-start justify-between gap-3 px-3 py-2">
                <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
                  <User className="h-3.5 w-3.5" />
                  Adăugat
                </span>
                <span className="min-w-0 text-right">
                  <span className="font-medium">{d.requestedByUsername ?? "necunoscut"}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    ·{" "}
                    {dayTimeLabel(
                      Math.floor(new Date(`${d.addedAt.replace(" ", "T")}Z`).getTime() / 1000),
                      false,
                    )}
                  </span>
                </span>
              </div>
            </div>
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}
