import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Film,
  Tv,
  HardDrive,
  Zap,
  ShieldCheck,
  CheckCircle2,
  Loader2,
  OctagonX,
  Trash2,
  Captions,
  FolderOpen,
} from "lucide-react";

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { resolveTorrentDisplayName } from "@/lib/filelist.functions";
import type { FilelistLogEntry } from "@/lib/filelist.functions";
import { isMovieCategory } from "@/lib/filelist/categories";
import { formatBytes } from "@/lib/format";

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("ro-RO", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Bucharest",
  });
}

export function DownloadLogEntryDrawer({
  entry,
  onClose,
  onCorrectSubtitle,
  correcting,
  onDelete,
}: {
  entry: FilelistLogEntry;
  onClose: () => void;
  onCorrectSubtitle: () => void;
  correcting: boolean;
  onDelete: () => void;
}) {
  const nameFn = useServerFn(resolveTorrentDisplayName);
  const { data: displayName } = useQuery({
    queryKey: ["torrentDisplayName", entry.id, entry.name, entry.imdb],
    queryFn: () => nameFn({ data: { torrentName: entry.name, imdb: entry.imdb ?? null } }),
    staleTime: 60 * 60_000,
    enabled: !!entry.imdb,
  });

  const isMovie = isMovieCategory(entry.category);
  const isActive = entry.completedAt === null;
  const title = displayName ?? entry.name;

  return (
    <Drawer
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DrawerContent>
        <DrawerHeader className="pb-2">
          <DrawerTitle className="flex items-center gap-2 text-base">
            {isMovie ? (
              <Film className="h-4 w-4 text-amber-400 shrink-0" />
            ) : (
              <Tv className="h-4 w-4 text-blue-400 shrink-0" />
            )}
            <span className="break-words">{title}</span>
          </DrawerTitle>
          {title !== entry.name && (
            <DrawerDescription className="text-left break-words font-mono text-[11px] mt-1">
              {entry.name}
            </DrawerDescription>
          )}
        </DrawerHeader>

        <div className="px-4 pb-6 space-y-4 overflow-y-auto max-h-[60vh]">
          <div>
            {isActive ? (
              <span className="flex items-center gap-1 text-xs text-amber-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> În descărcare...
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" /> Complet — {fmtDate(entry.completedAt!)}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
            <span className="rounded bg-muted px-1.5 py-0.5 font-medium">{entry.categoryName}</span>
            {entry.size > 0 && (
              <span className="flex items-center gap-1">
                <HardDrive className="h-3 w-3" /> {formatBytes(entry.size)}
              </span>
            )}
            {entry.freeleech && (
              <span className="flex items-center gap-1 rounded bg-yellow-500/15 px-1.5 py-0.5 font-medium text-yellow-400">
                <Zap className="h-3 w-3" /> Freeleech
              </span>
            )}
            {entry.internal && (
              <span className="flex items-center gap-1 rounded bg-purple-500/15 px-1.5 py-0.5 font-medium text-purple-400">
                <ShieldCheck className="h-3 w-3" /> Internal
              </span>
            )}
          </div>

          <div className="space-y-1 text-xs text-muted-foreground">
            <div>Adăugat: {fmtDate(entry.downloadedAt)}</div>
            {entry.savePath && (
              <div className="flex items-start gap-1.5">
                <FolderOpen className="h-3 w-3 shrink-0 mt-0.5" />
                <span className="break-all font-mono text-[11px]">{entry.savePath}</span>
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onCorrectSubtitle}
              disabled={!entry.torrentHash || correcting}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-muted/40 py-2 text-xs font-medium text-foreground hover:bg-muted/60 transition-colors disabled:opacity-40"
              title={
                entry.torrentHash
                  ? "Verifică/corectează subtitrarea română pentru acest item"
                  : "Hash indisponibil — nu pot verifica subtitrarea"
              }
            >
              {correcting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Captions className="h-3.5 w-3.5" />
              )}
              Corectează subtitrare
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-muted/40 py-2 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
              title={
                isActive
                  ? "Oprește descărcarea în curs"
                  : entry.torrentHash
                    ? "Șterge din log + qBit + disk"
                    : "Șterge din log"
              }
            >
              {isActive ? <OctagonX className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
              {isActive ? "Oprește" : "Șterge"}
            </button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
