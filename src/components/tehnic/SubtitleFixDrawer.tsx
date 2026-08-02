import { Captions, CheckCircle2, CircleDashed, AlertTriangle, XCircle } from "lucide-react";

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import type { ActivityEntry } from "@/lib/activity-log";

interface SubtitleRunItemMeta {
  torrentName: string;
  outcome: string;
  detail: string;
  release?: string;
  path?: string;
}

const CORRECTED_OUTCOMES = new Set([
  "renamed_srt",
  "reencoded_srt",
  "downloaded_opensubtitles",
  "downloaded_opensubtitles_approximate",
]);
const OK_OUTCOMES = new Set(["already_embedded"]);
const APPROXIMATE_OUTCOMES = new Set(["downloaded_opensubtitles_approximate"]);

function outcomeIcon(outcome: string) {
  if (APPROXIMATE_OUTCOMES.has(outcome)) {
    return <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />;
  }
  if (CORRECTED_OUTCOMES.has(outcome)) {
    return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />;
  }
  if (OK_OUTCOMES.has(outcome)) {
    return <CircleDashed className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />;
  }
  return <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />;
}

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

export function SubtitleFixDrawer({
  entry,
  onClose,
}: {
  entry: ActivityEntry;
  onClose: () => void;
}) {
  const rawItems = (entry.meta?.items as SubtitleRunItemMeta[] | undefined) ?? [];
  const corrected = rawItems.filter((it) => CORRECTED_OUTCOMES.has(it.outcome));
  const ok = rawItems.filter((it) => OK_OUTCOMES.has(it.outcome));
  const rest = rawItems.filter((it) => !CORRECTED_OUTCOMES.has(it.outcome) && !OK_OUTCOMES.has(it.outcome));
  const ordered = [...corrected, ...ok, ...rest];

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
            <Captions className="h-4 w-4 text-teal-400 shrink-0" />
            Subtitrare română
          </DrawerTitle>
          <DrawerDescription className="text-left text-sm font-medium text-foreground leading-snug mt-1">
            {entry.message}
          </DrawerDescription>
        </DrawerHeader>

        <div className="px-4 pb-6 space-y-4 overflow-y-auto max-h-[60vh]">
          <div className="text-xs text-muted-foreground">{fmtDate(entry.timestamp)}</div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 text-emerald-400 px-2 py-0.5 font-medium">
              <CheckCircle2 className="h-3 w-3" /> {corrected.length} corectate
            </span>
            <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground">
              <CircleDashed className="h-3 w-3" /> {ok.length} deja ok
            </span>
            <span className="flex items-center gap-1 rounded-full bg-red-500/15 text-red-400 px-2 py-0.5 font-medium">
              <XCircle className="h-3 w-3" /> {rest.length} sărite/eșuate
            </span>
            <span className="ml-auto text-muted-foreground">Total: {rawItems.length}</span>
          </div>

          {ordered.length === 0 ? (
            <div className="text-xs text-muted-foreground">Fără detalii disponibile pentru această rulare.</div>
          ) : (
            <div className="rounded-xl border border-border divide-y divide-border/50 overflow-hidden">
              {ordered.map((it, i) => (
                <div key={`${it.torrentName}-${i}`} className="flex items-start gap-2 px-3 py-2 text-xs">
                  {outcomeIcon(it.outcome)}
                  <div className="min-w-0 flex-1">
                    <div className="font-medium break-words text-foreground">{it.torrentName}</div>
                    <div className="mt-0.5 text-muted-foreground break-words">{it.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
