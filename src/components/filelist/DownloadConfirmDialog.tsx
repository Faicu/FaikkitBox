import { useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useServerFn } from "@tanstack/react-start";
import {
  Download,
  Users,
  Zap,
  HardDrive,
  ShieldCheck,
  ExternalLink,
  Info,
  Link2,
  Loader2,
  X,
} from "lucide-react";

import type { FilelistTorrent } from "@/lib/filelist.functions";
import { formatBytes } from "@/lib/format";
import { searchLibraryTitles, type LibraryTitleMatch } from "@/lib/media/media";
import type { DownloadMediaContext } from "./use-download";

// ---------------------------------------------------------------------------
// Explicație text pentru criteriul care a găsit torrentul — vezi
// checkFilelistForItemInternal (src/lib/filelist/download.ts): căutarea se
// face exclusiv după ID IMDB.
// ---------------------------------------------------------------------------

function matchInfoText(torrent: FilelistTorrent): string | null {
  if (!torrent.matchedByImdb) return null;
  return (
    `Găsit pe Filelist prin IMDB ID${torrent.imdb ? `: "${torrent.imdb}"` : ""}.` +
    " Cel mai fiabil criteriu — potrivire exactă pe ID-ul IMDB, indiferent cum e denumită lansarea."
  );
}

// ---------------------------------------------------------------------------
// Dialog confirmare download
// ---------------------------------------------------------------------------

function matchToContext(match: LibraryTitleMatch): DownloadMediaContext {
  return {
    mediaType: match.mediaType,
    imdbId: match.imdbId,
    tmdbId: match.tmdbId,
    title: match.title,
    originalTitle: match.originalTitle,
    literalTitle: match.literalTitle,
    year: match.year,
    posterUrl: match.posterPath,
    tvStatus: match.tvStatus,
  };
}

export function DownloadConfirmDialog({
  torrent,
  label,
  onConfirm,
  onCancel,
}: {
  torrent: FilelistTorrent;
  label: string;
  onConfirm: (mediaContext?: DownloadMediaContext) => void;
  onCancel: () => void;
}) {
  const [showInfo, setShowInfo] = useState(false);
  const infoText = matchInfoText(torrent);

  const searchFn = useServerFn(searchLibraryTitles);
  const [linkQuery, setLinkQuery] = useState("");
  const [linkResults, setLinkResults] = useState<LibraryTitleMatch[]>([]);
  const [linkSearching, setLinkSearching] = useState(false);
  const [linkedTitle, setLinkedTitle] = useState<LibraryTitleMatch | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = linkQuery.trim();
    if (q.length < 2) {
      setLinkResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLinkSearching(true);
      try {
        setLinkResults(await searchFn({ data: { query: q } }));
      } finally {
        setLinkSearching(false);
      }
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [linkQuery, searchFn]);

  return (
    <DialogPrimitive.Root modal={false} open onOpenChange={(open) => !open && onCancel()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <DialogPrimitive.Content className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 space-y-4 shadow-xl outline-none">
            <DialogPrimitive.Title className="text-sm font-semibold">
              Confirmare descărcare
            </DialogPrimitive.Title>
        <DialogPrimitive.Description className="sr-only">
          Confirmă descărcarea torrentului {torrent.name}
        </DialogPrimitive.Description>
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

        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Link2 className="h-3.5 w-3.5" /> Leagă de un titlu existent (opțional)
          </div>
          {linkedTitle ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
              <span className="truncate">
                {linkedTitle.title}
                {linkedTitle.year ? ` (${linkedTitle.year})` : ""}
              </span>
              <button
                type="button"
                onClick={() => {
                  setLinkedTitle(null);
                  setLinkQuery("");
                }}
                className="shrink-0 text-emerald-300/80 hover:text-emerald-200"
                title="Anulează legarea"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="relative">
              <input
                value={linkQuery}
                onChange={(e) => setLinkQuery(e.target.value)}
                placeholder="Caută în bibliotecă…"
                className="w-full rounded-xl border border-border bg-background py-1.5 px-3 text-xs outline-none focus:ring-1 focus:ring-primary"
              />
              {linkSearching && (
                <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
              )}
              {linkResults.length > 0 && (
                <div className="absolute z-10 mt-1 max-h-40 w-full overflow-y-auto rounded-xl border border-border bg-card shadow-lg">
                  {linkResults.map((m) => (
                    <button
                      key={`${m.mediaType}-${m.mediaId}`}
                      type="button"
                      onClick={() => {
                        setLinkedTitle(m);
                        setLinkResults([]);
                      }}
                      className="block w-full truncate px-3 py-1.5 text-left text-xs hover:bg-muted"
                    >
                      {m.title}
                      {m.year ? ` (${m.year})` : ""}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            Fără legare, titlul e dedus automat după IMDb ID-ul torrentului — poate greși pentru
            spinoff-uri/reunion-uri indexate pe Filelist sub ID-ul altei producții din franciză.
          </p>
        </div>

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
            onClick={() => onConfirm(linkedTitle ? matchToContext(linkedTitle) : undefined)}
            className="flex-1 rounded-xl bg-blue-500/20 border border-blue-500/30 py-2 text-sm font-medium text-blue-400 hover:bg-blue-500/30 transition-colors flex items-center justify-center gap-1.5"
          >
            <Download className="h-4 w-4" /> Descarcă
          </button>
        </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
