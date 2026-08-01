import { useState } from "react";
import { Download, Users, Zap, HardDrive, ShieldCheck, ExternalLink, Info } from "lucide-react";

import type { FilelistTorrent } from "@/lib/filelist.functions";
import { formatBytes } from "@/lib/format";

// ---------------------------------------------------------------------------
// Explicație text pentru criteriul care a găsit torrentul — vezi
// checkFilelistForItemInternal (src/lib/filelist/download.ts) pentru logica
// de căutare (IMDB ID → titlu original → titlu englez).
// ---------------------------------------------------------------------------

function matchInfoText(torrent: FilelistTorrent): string | null {
  if (!torrent.matchedVia) return null;

  if (torrent.matchedVia === "titles_match") {
    let text = "Titlul original și titlul englez/internațional sunt identice pentru acest titlu";
    if (torrent.matchedQuery) text += `: "${torrent.matchedQuery}"`;
    text +=
      ". Găsit pe Filelist prin potrivire de text în numele lansării (nu are ID IMDB pe Filelist" +
      (torrent.imdb ? ", deși are unul asociat: " + torrent.imdb : "") +
      ").";
    return text;
  }

  const criteriuLabel =
    torrent.matchedVia === "imdb"
      ? "IMDB ID"
      : torrent.matchedVia === "original_title"
        ? "titlul original"
        : "titlul englez/internațional";

  let text = `Găsit pe Filelist prin ${criteriuLabel}`;
  if (torrent.matchedQuery) text += `: "${torrent.matchedQuery}"`;
  text += ".";

  if (torrent.matchedVia === "imdb") {
    text +=
      " Cel mai fiabil criteriu — potrivire exactă pe ID-ul IMDB, indiferent cum e denumită lansarea.";
  } else {
    text += ` Torrentul a fost identificat prin potrivire de text în numele lansării (nu are ID IMDB pe Filelist${
      torrent.imdb ? ", deși are unul asociat: " + torrent.imdb : ""
    }).`;
  }

  return text;
}

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
  const [showInfo, setShowInfo] = useState(false);
  const infoText = matchInfoText(torrent);

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

        {infoText && (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setShowInfo((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-medium text-blue-400 hover:text-blue-300"
            >
              <Info className="h-3.5 w-3.5" /> Info Căutare
            </button>
            {showInfo && (
              <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 text-xs text-muted-foreground">
                {infoText}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <a
            href={`https://filelist.io/details.php?id=${torrent.id}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center justify-center rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors"
            title="Vezi pe filelist.io"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
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
