import { useState } from "react";
import {
  CheckCircle2,
  XCircle,
  HelpCircle,
  Loader2,
  Download,
  Users,
  Zap,
  HardDrive,
  ShieldCheck,
} from "lucide-react";

import type { FilelistTorrent } from "@/lib/filelist.functions";
import { formatBytes } from "@/lib/format";
import { useCountdown } from "./hooks";

// ---------------------------------------------------------------------------
// Buton download calitate
// ---------------------------------------------------------------------------

export function TorrentPickerDialog({
  label,
  torrents,
  onPick,
  onCancel,
}: {
  label: string;
  torrents: FilelistTorrent[];
  onPick: (t: FilelistTorrent) => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 space-y-3 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-semibold">Alege torrent {label}</div>
        <div className="space-y-2">
          {torrents.map((t) => (
            <button
              key={t.id}
              onClick={() => onPick(t)}
              className="w-full text-left rounded-xl border border-border bg-muted/40 hover:bg-muted/80 p-3 space-y-1.5 transition-colors"
            >
              <div className="text-xs font-medium break-words leading-snug">{t.name}</div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <HardDrive className="h-3 w-3" /> {formatBytes(t.size)}
                </span>
                <span className="flex items-center gap-1 text-emerald-400">
                  <Users className="h-3 w-3" /> {t.seeders}
                </span>
                {t.freeleech && (
                  <span className="flex items-center gap-1 text-yellow-400">
                    <Zap className="h-3 w-3" /> Freeleech
                  </span>
                )}
                {t.internal && (
                  <span className="flex items-center gap-1 text-purple-400">
                    <ShieldCheck className="h-3 w-3" /> Internal
                  </span>
                )}
                {t.upload_date && (
                  <span>{new Date(t.upload_date).toLocaleDateString("ro-RO")}</span>
                )}
              </div>
            </button>
          ))}
        </div>
        <button
          onClick={onCancel}
          className="w-full rounded-xl border border-border py-2 text-sm text-muted-foreground hover:bg-muted transition-colors"
        >
          Anulează
        </button>
      </div>
    </div>
  );
}

export function QualityDownloadButton({
  label,
  torrents,
  plexQuality,
  downloading,
  onDownload,
}: {
  label: string;
  torrents: FilelistTorrent[];
  plexQuality?: string | null;
  downloading: number | null;
  onDownload: (t: FilelistTorrent, label: string) => void;
}) {
  const [showPicker, setShowPicker] = useState(false);

  const inPlex = plexQuality === label;
  const available = torrents.length > 0;
  const isLoading = available && torrents.some((t) => downloading === t.id);

  const colorClass = inPlex
    ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30 opacity-70 cursor-default"
    : label === "4K HDR"
      ? "bg-purple-500/15 text-purple-400 hover:bg-purple-500/25 border-purple-500/30"
      : label === "4K"
        ? "bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 border-blue-500/30"
        : "bg-slate-500/15 text-slate-300 hover:bg-slate-500/25 border-slate-500/30";

  function handleClick() {
    if (inPlex || !available || isLoading) return;
    if (torrents.length > 1) {
      setShowPicker(true);
    } else {
      onDownload(torrents[0], label);
    }
  }

  const sizeLabel = available
    ? torrents.length > 1
      ? `${torrents.length} torrente`
      : formatBytes(torrents[0].size)
    : null;

  const titleText = inPlex
    ? `Ai deja ${label} în Plex`
    : available
      ? torrents.length > 1
        ? `${torrents.length} torrente disponibile — apasă pentru a alege`
        : `${torrents[0].name} — ${formatBytes(torrents[0].size)}`
      : `Indisponibil ${label}`;

  return (
    <>
      {showPicker && (
        <TorrentPickerDialog
          label={label}
          torrents={torrents}
          onPick={(t) => {
            setShowPicker(false);
            onDownload(t, label);
          }}
          onCancel={() => setShowPicker(false)}
        />
      )}
      <button
        onClick={handleClick}
        disabled={(!available && !inPlex) || isLoading}
        className={`flex flex-col items-center gap-0.5 rounded-xl border px-3 py-2 text-[11px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${colorClass}`}
        title={titleText}
      >
        {isLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : inPlex ? (
          <CheckCircle2 className="h-3.5 w-3.5" />
        ) : (
          <Download className="h-3.5 w-3.5" />
        )}
        <span>{label}</span>
        {inPlex ? (
          <span className="text-[10px] font-normal">În Plex</span>
        ) : sizeLabel ? (
          <span className="text-[10px] font-normal text-muted-foreground">{sizeLabel}</span>
        ) : null}
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------
// Badge status Plex (3 variante)
// ---------------------------------------------------------------------------

export function PlexStatusBadge({ status }: { status: "complet" | "incomplet" | "lipsa" }) {
  if (status === "complet")
    return (
      <span className="flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2 py-1 text-[11px] font-medium text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" /> Complet în Plex
      </span>
    );
  if (status === "incomplet")
    return (
      <span className="flex items-center gap-1 rounded-lg bg-yellow-500/15 px-2 py-1 text-[11px] font-medium text-yellow-400">
        <HelpCircle className="h-3.5 w-3.5" /> Lipsesc episoade
      </span>
    );
  return (
    <span className="flex items-center gap-1 rounded-lg bg-red-500/15 px-2 py-1 text-[11px] font-medium text-red-400">
      <XCircle className="h-3.5 w-3.5" /> Lipsă din Plex
    </span>
  );
}

export function CountdownDisplay({ airDateIso }: { airDateIso: string }) {
  const remainingMs = useCountdown(airDateIso);
  const past = remainingMs <= 0;
  const totalSec = Math.max(0, Math.floor(remainingMs / 1000));
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  if (past) {
    return (
      <div className="mt-1 text-sm font-medium text-emerald-400">Ar trebui să fi apărut deja</div>
    );
  }
  return (
    <>
      <div className="mt-1.5 flex items-center gap-2 tabular-nums">
        {[
          { v: days, l: "zile" },
          { v: hours, l: "ore" },
          { v: minutes, l: "min" },
          { v: seconds, l: "sec" },
        ].map((u) => (
          <div key={u.l} className="flex-1 rounded-xl bg-muted px-2 py-1.5 text-center">
            <div className="text-lg font-semibold leading-none">{String(u.v).padStart(2, "0")}</div>
            <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              {u.l}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 text-[11px] text-muted-foreground">
        {new Date(airDateIso).toLocaleString("ro-RO", {
          weekday: "long",
          day: "numeric",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Europe/Bucharest",
        })}{" "}
        (ora României)
      </div>
    </>
  );
}

export function LibraryBadge({ inLibrary }: { inLibrary: boolean | null }) {
  if (inLibrary === true) {
    return (
      <span className="flex shrink-0 items-center gap-1 rounded-lg bg-emerald-500/15 px-2 py-1 text-[11px] font-medium text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" /> În biblioteca Plex
      </span>
    );
  }
  if (inLibrary === false) {
    return (
      <span className="flex shrink-0 items-center gap-1 rounded-lg bg-red-500/15 px-2 py-1 text-[11px] font-medium text-red-400">
        <XCircle className="h-3.5 w-3.5" /> Nu e în Plex
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-1 rounded-lg bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
      <HelpCircle className="h-3.5 w-3.5" /> Necunoscut
    </span>
  );
}
