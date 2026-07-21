import { Download, Users, Zap, HardDrive, ShieldCheck } from "lucide-react";

import type { FilelistTorrent } from "@/lib/filelist.functions";
import { formatBytes } from "@/lib/format";

// ---------------------------------------------------------------------------
// Dialog confirmare download
// ---------------------------------------------------------------------------

export function DownloadConfirmDialog({
  torrent,
  label,
  onConfirm,
  onCancel,
}: {
  torrent: FilelistTorrent;
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 space-y-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-semibold">Confirmare descărcare</div>
        <div className="space-y-2 text-xs text-muted-foreground">
          <div className="font-medium text-foreground break-words">{torrent.name}</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
            <span className="flex items-center gap-1">
              <HardDrive className="h-3 w-3" /> {formatBytes(torrent.size)}
            </span>
            <span className="flex items-center gap-1 text-emerald-400">
              <Users className="h-3 w-3" /> {torrent.seeders} seederi
            </span>
            <span className="flex items-center gap-1 text-orange-400">
              <Users className="h-3 w-3" /> {torrent.leechers} leecheri
            </span>
            {torrent.freeleech && (
              <span className="flex items-center gap-1 text-yellow-400">
                <Zap className="h-3 w-3" /> Freeleech
              </span>
            )}
            {torrent.internal && (
              <span className="flex items-center gap-1 text-purple-400">
                <ShieldCheck className="h-3 w-3" /> Internal
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 pt-1">
            <span className="rounded bg-muted px-1.5 py-0.5 font-medium">
              {torrent.categoryName}
            </span>
            <span className="rounded bg-blue-500/15 px-1.5 py-0.5 font-medium text-blue-400">
              {label}
            </span>
            {torrent.upload_date && (
              <span>{new Date(torrent.upload_date).toLocaleDateString("ro-RO")}</span>
            )}
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <button
            onClick={onCancel}
            className="flex-1 rounded-xl border border-border py-2 text-sm text-muted-foreground hover:bg-muted transition-colors"
          >
            Anulează
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-xl bg-blue-500/20 border border-blue-500/30 py-2 text-sm font-medium text-blue-400 hover:bg-blue-500/30 transition-colors flex items-center justify-center gap-1.5"
          >
            <Download className="h-4 w-4" /> Descarcă
          </button>
        </div>
      </div>
    </div>
  );
}
