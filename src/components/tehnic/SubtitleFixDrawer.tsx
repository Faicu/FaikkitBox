import {
  Captions,
  CheckCircle2,
  CircleDashed,
  AlertTriangle,
  XCircle,
  ArchiveRestore,
  Replace,
} from "lucide-react";
import type { ReactNode } from "react";

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import type { ActivityEntry } from "@/lib/activity-log.functions";
import {
  CORRECTED_OUTCOMES as CORRECTED_OUTCOMES_LIST,
  OK_OUTCOMES as OK_OUTCOMES_LIST,
  APPROXIMATE_OUTCOMES as APPROXIMATE_OUTCOMES_LIST,
  SHORT_LABELS,
  SUBTITLE_SOURCE_LABELS,
  type SubtitleFileReport,
  type SubtitleOutcome,
  type SubtitleRejectionReport,
  type SubtitleSource,
} from "@/lib/filelist/subtitle-outcomes";
import { formatDateTime as fmtDate } from "./utils";

interface SubtitleRunItemMeta {
  torrentName: string;
  displayTitle?: string;
  outcome: string;
  detail: string;
  release?: string;
  path?: string;
  matchedCriteria?: number;
  maxCriteria?: number;
  syncScore?: number;
  syncOffset?: number;
  syncGood?: boolean;
}

const CORRECTED_OUTCOMES = new Set<string>(CORRECTED_OUTCOMES_LIST);
const OK_OUTCOMES = new Set<string>(OK_OUTCOMES_LIST);
const APPROXIMATE_OUTCOMES = new Set<string>(APPROXIMATE_OUTCOMES_LIST);

function outcomeIcon(outcome: string, size = "h-3.5 w-3.5") {
  if (APPROXIMATE_OUTCOMES.has(outcome)) {
    return <AlertTriangle className={`${size} text-amber-400 shrink-0 mt-0.5`} />;
  }
  if (CORRECTED_OUTCOMES.has(outcome)) {
    return <CheckCircle2 className={`${size} text-emerald-400 shrink-0 mt-0.5`} />;
  }
  if (OK_OUTCOMES.has(outcome)) {
    return <CircleDashed className={`${size} text-muted-foreground shrink-0 mt-0.5`} />;
  }
  return <XCircle className={`${size} text-red-400 shrink-0 mt-0.5`} />;
}

const num = (n: number, digits = 2) => n.toFixed(digits).replace(".", ",");

// Titlul rezultatului unui fișier. La descărcări sursa și calitatea potrivirii
// apar dedesubt, pe rânduri proprii — aici doar ce s-a întâmplat.
function headline(outcome: string, rejectedCount = 0): string {
  if (outcome === "downloaded") return "Subtitrare descărcată";
  // „Nicio subtitrare găsită" ar fi înșelător când au existat variante, dar
  // toate au fost respinse — ele apar dedesubt, cu motivul.
  if (outcome === "no_subtitle_found" && rejectedCount > 0) return "Nicio variantă potrivită";
  if (outcome === "downloaded_approximate")
    return "Subtitrare aproximativă — verifică sincronizarea";
  const label = SHORT_LABELS[outcome as SubtitleOutcome] ?? outcome;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function Chip({ tone, children }: { tone: "good" | "warn" | "muted"; children: ReactNode }) {
  const cls =
    tone === "good"
      ? "bg-emerald-500/15 text-emerald-400"
      : tone === "warn"
        ? "bg-amber-500/15 text-amber-400"
        : "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${cls}`}
    >
      {children}
    </span>
  );
}

function SourceChip({ source }: { source: SubtitleSource }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded bg-teal-500/15 px-1.5 py-0.5 text-[10px] font-medium text-teal-400">
      {SUBTITLE_SOURCE_LABELS[source]}
    </span>
  );
}

// Un fișier media: rezultatul, varianta aleasă (sursă, release, sincronizare),
// subtitrarea veche mutată deoparte și variantele respinse.
function FileReport({
  file,
  rejected,
  showEpisode,
}: {
  file: SubtitleFileReport;
  rejected: SubtitleRejectionReport[];
  showEpisode: boolean;
}) {
  const hasSync = file.syncScore != null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-start gap-2">
        {outcomeIcon(file.outcome)}
        <div className="min-w-0 flex-1 font-medium text-foreground">
          {showEpisode && file.episode && (
            <span className="mr-1.5 font-mono text-muted-foreground">{file.episode}</span>
          )}
          {headline(file.outcome, rejected.length)}
        </div>
      </div>

      {file.source && file.release && (
        <div className="ml-5.5 space-y-1">
          <div className="flex items-start gap-1.5">
            <SourceChip source={file.source} />
            <span className="min-w-0 wrap-anywhere font-mono text-[10px] leading-relaxed text-muted-foreground">
              {file.release}
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {hasSync &&
              (file.syncGood ? (
                <Chip tone="good">sincronizată · {num(file.syncScore!)}</Chip>
              ) : (
                <Chip tone="warn">
                  decalaj ~{num(Math.abs(file.syncOffset ?? 0), 1)} s · {num(file.syncScore!)}
                </Chip>
              ))}
            {file.maxCriteria != null && file.maxCriteria > 0 && (
              <Chip tone={hasSync || file.matchedCriteria !== file.maxCriteria ? "muted" : "good"}>
                nume release {file.matchedCriteria}/{file.maxCriteria}
              </Chip>
            )}
            {file.compared != null && file.compared > 1 && (
              <Chip tone="muted">aleasă dintre {file.compared} variante</Chip>
            )}
          </div>
        </div>
      )}

      {file.replacedApproximate && (
        <div className="ml-5.5 flex items-start gap-1.5 text-emerald-400">
          <Replace className="h-3 w-3 shrink-0 mt-0.5" />
          <span>A înlocuit subtitrarea aproximativă de dinainte</span>
        </div>
      )}

      {file.movedAside && (
        <div className="ml-5.5 flex items-start gap-1.5 text-amber-400">
          <ArchiveRestore className="h-3 w-3 shrink-0 mt-0.5" />
          <span className="min-w-0">
            Subtitrarea de dinainte a fost mutată deoparte: {file.movedAside}
          </span>
        </div>
      )}

      {rejected.length > 0 && (
        <div className="ml-5.5 space-y-1 pt-0.5">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
            Respinse ({rejected.length})
          </div>
          {rejected.map((r, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <SourceChip source={r.source} />
              <div className="min-w-0 flex-1">
                <div className="wrap-anywhere font-mono text-[10px] leading-relaxed text-muted-foreground">
                  {r.release}
                </div>
                <div className="text-red-400/90">{r.reason}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Un torrent: un film sau un episod are un singur raport; la un pachet,
// episoadele cu ceva de spus (descărcate, aproximative, fără subtitrare) apar
// pe rând, iar cele deja în regulă sunt strânse într-o singură linie.
function StructuredItem({
  item,
  files,
  rejected,
}: {
  item: SubtitleRunItemMeta;
  files: SubtitleFileReport[];
  rejected: SubtitleRejectionReport[];
}) {
  const isPack = files.length > 1;
  const rejectedOf = (f: SubtitleFileReport) => rejected.filter((r) => r.episode === f.episode);
  const okFiles = isPack ? files.filter((f) => OK_OUTCOMES.has(f.outcome)) : [];
  const shown = isPack ? files.filter((f) => !OK_OUTCOMES.has(f.outcome)) : files;

  return (
    <div className="space-y-2.5 px-3 py-2.5 text-xs">
      <div className="min-w-0">
        <div className="font-medium break-words text-foreground">
          {item.displayTitle || item.torrentName}
        </div>
        {item.displayTitle && item.displayTitle !== item.torrentName && (
          <div className="mt-0.5 wrap-anywhere font-mono text-[10px] text-muted-foreground/70">
            {item.torrentName}
          </div>
        )}
      </div>

      {shown.map((f, i) => (
        <div key={f.episode ?? i} className={i > 0 ? "border-t border-border/40 pt-2.5" : ""}>
          <FileReport file={f} rejected={rejectedOf(f)} showEpisode={isPack || !!f.episode} />
        </div>
      ))}

      {okFiles.length > 0 && (
        <div
          className={`flex items-start gap-2 text-muted-foreground ${
            shown.length > 0 ? "border-t border-border/40 pt-2.5" : ""
          }`}
        >
          <CircleDashed className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <div className="min-w-0">
            {okFiles.length === files.length ? "Toate episoadele" : `${okFiles.length} episoade`}{" "}
            aveau deja subtitrare în regulă
            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[10px] text-muted-foreground/70">
              {okFiles.map((f) => (
                <span key={f.episode}>{f.episode}</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Intrările de dinainte de jurnalul structurat (10 oct. 2026): doar textul
// complet al detaliului.
function LegacyItem({ it }: { it: SubtitleRunItemMeta }) {
  return (
    <div className="flex items-start gap-2 px-3 py-2 text-xs">
      {outcomeIcon(it.outcome)}
      <div className="min-w-0 flex-1">
        <div className="font-medium break-words text-foreground">
          {it.displayTitle || it.torrentName}
        </div>
        {it.displayTitle && it.displayTitle !== it.torrentName && (
          <div className="mt-0.5 text-[10px] text-muted-foreground/70 break-words font-mono">
            {it.torrentName}
          </div>
        )}
        <div className="mt-0.5 text-muted-foreground break-words">
          {it.syncScore != null ? (
            <span
              className={`mr-1.5 inline-block rounded px-1 py-0.5 font-mono text-[10px] font-medium ${
                it.syncGood
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "bg-amber-500/15 text-amber-400"
              }`}
            >
              {it.syncGood ? "sincronizată" : `decalaj ~${num(Math.abs(it.syncOffset ?? 0), 1)} s`}
            </span>
          ) : (
            it.maxCriteria != null &&
            it.maxCriteria > 0 && (
              <span
                className={`mr-1.5 inline-block rounded px-1 py-0.5 font-mono text-[10px] font-medium ${
                  it.matchedCriteria === it.maxCriteria
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "bg-amber-500/15 text-amber-400"
                }`}
              >
                {it.matchedCriteria}/{it.maxCriteria}
              </span>
            )
          )}
          {it.detail}
        </div>
      </div>
    </div>
  );
}

export function SubtitleFixDrawer({
  entry,
  onClose,
}: {
  entry: ActivityEntry;
  onClose: () => void;
}) {
  const rawItems = (entry.meta?.items as SubtitleRunItemMeta[] | undefined) ?? [];
  const allFiles = (entry.meta?.files as SubtitleFileReport[] | undefined) ?? [];
  const allRejected = (entry.meta?.rejected as SubtitleRejectionReport[] | undefined) ?? [];
  const corrected = rawItems.filter((it) => CORRECTED_OUTCOMES.has(it.outcome));
  const ok = rawItems.filter((it) => OK_OUTCOMES.has(it.outcome));
  const rest = rawItems.filter(
    (it) => !CORRECTED_OUTCOMES.has(it.outcome) && !OK_OUTCOMES.has(it.outcome),
  );
  const ordered = [...corrected, ...ok, ...rest];

  // Contorii de sus: pe fișiere când avem jurnalul structurat (la un pachet de
  // sezon, episoadele contează, nu torrentul), altfel pe itemi, ca înainte.
  const counted = allFiles.length > 0 ? allFiles : rawItems;
  const nCorrected = counted.filter((x) => CORRECTED_OUTCOMES.has(x.outcome)).length;
  const nOk = counted.filter((x) => OK_OUTCOMES.has(x.outcome)).length;
  const nRest = counted.length - nCorrected - nOk;
  const unit = allFiles.length > 1 ? "fișiere" : "";

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

        <div className="px-4 pb-6 space-y-4 overflow-y-auto overscroll-contain max-h-[60vh]">
          <div className="text-xs text-muted-foreground">{fmtDate(entry.timestamp)}</div>

          {counted.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {nCorrected > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 text-emerald-400 px-2 py-0.5 font-medium">
                  <CheckCircle2 className="h-3 w-3" /> {nCorrected} corectate
                </span>
              )}
              {nOk > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground">
                  <CircleDashed className="h-3 w-3" /> {nOk} deja ok
                </span>
              )}
              {nRest > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-red-500/15 text-red-400 px-2 py-0.5 font-medium">
                  <XCircle className="h-3 w-3" /> {nRest}{" "}
                  {allFiles.length > 0 ? "fără subtitrare" : "sărite/eșuate"}
                </span>
              )}
              <span className="ml-auto text-muted-foreground">
                din {counted.length} {unit}
              </span>
            </div>
          )}

          {ordered.length === 0 ? (
            <div className="text-xs text-muted-foreground">
              Fără detalii disponibile pentru această rulare.
            </div>
          ) : (
            <div className="rounded-xl border border-border divide-y divide-border/50 overflow-hidden">
              {ordered.map((it, i) => {
                const files = allFiles.filter((f) => f.torrent === it.torrentName);
                return files.length > 0 ? (
                  <StructuredItem
                    key={`${it.torrentName}-${i}`}
                    item={it}
                    files={files}
                    rejected={allRejected.filter((r) => r.torrent === it.torrentName)}
                  />
                ) : (
                  <LegacyItem key={`${it.torrentName}-${i}`} it={it} />
                );
              })}
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
