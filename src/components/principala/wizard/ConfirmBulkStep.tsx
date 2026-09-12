// Confirmarea descărcării în lot. E un pas propriu, nu un card inline pe
// ecranul de rezultat, ca să folosească același model mental ca cea pentru un
// singur torrent: aceeași săgeată de înapoi, același loc în stepper.

import type { RefObject } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import type { BulkDownloadItem, Quality } from "./types";

export function ConfirmBulkStep({
  items,
  quality,
  bulkProgress,
  cancelBulkRef,
  onCancel,
  onConfirm,
}: {
  items: BulkDownloadItem[];
  quality: Quality;
  bulkProgress: { done: number; total: number } | null;
  cancelBulkRef: RefObject<boolean>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="animate-in fade-in slide-in-from-right-2 duration-200 space-y-4">
      <div className="text-sm font-semibold">Confirmare descărcare în lot</div>
      <div className="space-y-2 rounded-xl glass-card p-3">
        <div className="text-sm text-foreground">
          Pornești {items.length} descărcări — tot ce lipsește și e disponibil pe Filelist, la
          calitatea {quality}?
        </div>
        {/* Fără înălțime maximă și scroll propriu: limita era moștenită de pe
            vremea când confirmarea în lot era un card înghesuit pe ecranul de
            rezultat. Acum, fiind pas propriu, lista curge în scroll-ul
            dialogului — un scroll în scroll e incomod pe telefon și tăia
            primul rând. */}
        <div className="space-y-1">
          {items.map((item) => (
            <div key={`${item.season}-${item.episode ?? "pack"}`} className="text-xs">
              <span className="font-medium text-foreground">{item.label}</span>{" "}
              <span className="break-all text-muted-foreground">— {item.torrent.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Cât rulează lotul, butoanele lasă locul progresului: e singurul
          moment în care dialogul nu poate fi închis, deci trebuie să se vadă
          unde s-a ajuns și să existe o ieșire. */}
      {bulkProgress ? (
        <div className="space-y-2 rounded-xl glass-card p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {bulkProgress.done}/{bulkProgress.total} adăugate
            </span>
            <button
              type="button"
              onClick={() => {
                cancelBulkRef.current = true;
                toast.info("Se oprește după descărcarea curentă");
              }}
              className="rounded-lg border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/60"
            >
              Oprește
            </button>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{
                width: `${Math.round((bulkProgress.done / Math.max(bulkProgress.total, 1)) * 100)}%`,
              }}
            />
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-border py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
          >
            Anulează
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-xl bg-primary py-2 text-sm font-semibold text-primary-foreground"
          >
            Descarcă
          </button>
        </div>
      )}
    </div>
  );
}
