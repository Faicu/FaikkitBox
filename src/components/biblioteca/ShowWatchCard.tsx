import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Download, Loader2, Radar, RefreshCw } from "lucide-react";

import { Orb } from "@/components/ui/orb";
import { BorderFlowSweep } from "@/components/BorderFlowSweep";
import type { PlexTitleDetail } from "@/lib/services/plex-title-detail";
import { setShowWatch, checkShowNow } from "@/lib/media/media.functions";
import { QualityButton, QualityChecklist } from "./QualityChecklist";
import { NextEpisodeLine } from "./TitleDetailParts";
import { lastCheckedLabel } from "./utils";

// Episoadele noi într-un card: când apare următorul și dacă ajunge singur în
// bibliotecă. `onChanged` reîmprospătează lista și fișa.
export function ShowWatchCard({
  detail: d,
  onChanged,
}: {
  detail: PlexTitleDetail;
  onChanged: () => void;
}) {
  const [savingWatch, setSavingWatch] = useState(false);
  const [checkingNow, setCheckingNow] = useState(false);
  const [pickingWatch, setPickingWatch] = useState(false);
  const [pickingQuality, setPickingQuality] = useState(false);

  const setShowWatchFn = useServerFn(setShowWatch);
  const checkShowNowFn = useServerFn(checkShowNow);

  async function toggleWatch(enabled: boolean, mode: "forward" | "backfill" = "forward") {
    setSavingWatch(true);
    const res = await setShowWatchFn({
      data: { mediaId: d.mediaId, enabled, quality: d.autoDownloadQuality ?? "1080p", mode },
    }).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    setSavingWatch(false);
    setPickingWatch(false);
    if (!res.ok) {
      toast.error("Nu am putut schimba urmărirea", { description: res.error });
      return;
    }
    toast.success(enabled ? "Urmărire pornită" : "Urmărire oprită");
    onChanged();
  }

  // Principala și rezerva se trimit împreună: două calități identice lasă
  // serialul fără rezervă (effectiveFallback).
  async function setWatchQualities(quality: string, fallbackQuality: string | null) {
    setSavingWatch(true);
    // Fără "backfill": schimbarea calității nu mută punctul de pornire înapoi.
    // Eroarea se raportează — înghițită, calitatea părea schimbată până la
    // refetch-ul care o dădea înapoi.
    const res = await setShowWatchFn({
      data: {
        mediaId: d.mediaId,
        enabled: true,
        quality,
        fallbackQuality: fallbackQuality === quality ? null : fallbackQuality,
      },
    }).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    setSavingWatch(false);
    if (!res.ok) {
      toast.error("Nu am putut schimba calitatea", { description: res.error });
      return;
    }
    onChanged();
  }

  async function checkNow() {
    setCheckingNow(true);
    const toastId = toast.loading(`Verific episoade noi pentru „${d.show ?? d.title}”…`);
    const res = await checkShowNowFn({ data: { mediaId: d.mediaId } }).catch((e) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
    }));
    setCheckingNow(false);
    if (!res.ok) {
      toast.error("Verificarea a eșuat", { id: toastId, description: res.error });
      return;
    }
    const o = res.outcome;
    if (o.downloaded.length > 0) {
      toast.success(`Pornite ${o.downloaded.length}`, {
        id: toastId,
        description: o.downloaded.join(", "),
        duration: 8000,
      });
    } else {
      toast.info("Niciun episod nou de descărcat", {
        id: toastId,
        // Motivul contează: „lipsesc 3 episoade, dar niciun torrent 1080p” ≠ „ești
        // la zi”.
        description:
          o.skipped ??
          (o.missing.length > 0 ? `Lipsesc: ${o.missing.join(", ")}` : "Ești la zi cu serialul"),
        duration: 8000,
      });
    }
    onChanged();
  }

  return (
    <div
      className={`rounded-xl border border-border bg-muted/30 p-3 space-y-2 ${d.autoDownload ? "border-flow" : ""}`}
    >
      {d.autoDownload && <BorderFlowSweep />}
      {/* Butoanele lipsesc la serialele încheiate, DAR nu și când
      urmărirea e pornită (altfel n-ai cum s-o oprești). Fără
      drepturi: starea se vede, fără butoane. */}
      {(d.autoDownload || (d.canManage && d.tvStatus !== "Ended")) && (
        <div className="flex items-center gap-2">
          {d.autoDownload ? (
            <Orb state="searching" px={18} label="Urmărit" />
          ) : (
            <Radar className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="flex-1 text-xs font-medium">
            {d.autoDownload ? "Urmărit" : "Urmărește episoade noi"}
          </span>
          {d.canManage && d.autoDownload && (
            <button
              type="button"
              onClick={checkNow}
              disabled={checkingNow}
              className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-muted/60 disabled:opacity-40"
            >
              {checkingNow ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Verifică acum
            </button>
          )}
          {!d.canManage ? null : d.autoDownload ? (
            <button
              type="button"
              onClick={() => toggleWatch(false)}
              disabled={savingWatch}
              className="rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 disabled:opacity-40"
            >
              Oprește
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setPickingWatch((v) => !v)}
              disabled={savingWatch}
              className="rounded-lg bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
            >
              Pornește
            </button>
          )}
        </div>
      )}

      {/* Următorul episod, din `media` (TMDB + ora TVmaze), redat în
      ora browserului. În dreapta, calitatea. */}
      <NextEpisodeLine
        detail={d}
        trailing={
          d.canManage && d.autoDownload ? (
            <QualityButton
              primary={d.autoDownloadQuality ?? "1080p"}
              fallback={d.autoDownloadFallbackQuality}
              open={pickingQuality}
              disabled={savingWatch}
              onToggle={() => setPickingQuality((v) => !v)}
            />
          ) : null
        }
      />

      {/* Calitățile inline, nu Popover/Select Radix — un overlay
      imbricat în vaul îngheață ecranul (c76ce30). */}
      {d.canManage && d.autoDownload && pickingQuality && (
        <QualityChecklist
          primary={d.autoDownloadQuality ?? "1080p"}
          fallback={d.autoDownloadFallbackQuality}
          disabled={savingWatch}
          onChange={setWatchQualities}
        />
      )}

      {d.autoDownload && (
        <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
          <Download className="mt-px h-3 w-3 shrink-0 text-primary" />
          <span className="flex-1">Se descarcă automat când apare pe Filelist.</span>
          <span className="shrink-0 text-[10px]">{lastCheckedLabel(d.watchLastCheckedAt)}</span>
        </div>
      )}

      {/* Punctul de pornire, explicit: „recuperează tot” poate
      însemna zeci de episoade deodată. */}
      {d.canManage && pickingWatch && !d.autoDownload && (
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => toggleWatch(true, "forward")}
            className="w-full rounded-lg bg-muted/60 px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-muted"
          >
            <span className="block font-medium text-foreground">Doar de acum înainte</span>
            <span className="block text-muted-foreground">
              Descarcă episoadele care apar din acest moment
            </span>
          </button>
          <button
            type="button"
            onClick={() => toggleWatch(true, "backfill")}
            className="w-full rounded-lg bg-muted/60 px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-muted"
          >
            <span className="block font-medium text-foreground">Recuperează și ce lipsește</span>
            <span className="block text-muted-foreground">
              Descarcă și episoadele difuzate pe care nu le ai
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
