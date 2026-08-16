import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Search,
  Film,
  Tv,
  Eye,
  Captions,
  ChevronDown,
  ChevronRight,
  Loader2,
  Layers,
  DatabaseZap,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";
import { plexLibraryBrowseQuery, adminStatusQuery } from "@/lib/queries";
import { deleteMediaEntry } from "@/lib/filelist.functions";
import { startMediaBackfill, getMediaBackfillState } from "@/lib/media-backfill";
import { backfillSubtitles, getBackfillState } from "@/lib/filelist.functions";
import type { PlexBrowseItem } from "@/lib/services/plex-browse";
import { StatusBadge } from "./StatusBadge";
import { TitleDetailDrawer } from "./TitleDetailDrawer";
import { episodeCode, addedDate, itemLabel, groupConsecutiveEpisodes, matchesQuery } from "./utils";

const PAGE_SIZE = 20;

export function BibliotecaList() {
  const queryClient = useQueryClient();
  const browse = useQuery(plexLibraryBrowseQuery);
  const { data: adminData } = useQuery(adminStatusQuery);
  const isAdmin = !!adminData?.isAdmin;
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedMediaId, setSelectedMediaId] = useState<number | null>(null);
  const [confirmDeleteTitle, setConfirmDeleteTitle] = useState<{
    mediaId: number;
    title: string;
    isSeasonPack: boolean;
  } | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<{ total: number; done: number } | null>(
    null,
  );
  const [subBackfilling, setSubBackfilling] = useState(false);
  const [subBackfillProgress, setSubBackfillProgress] = useState<{
    total: number;
    done: number;
  } | null>(null);

  const startBackfillFn = useServerFn(startMediaBackfill);
  const backfillStateFn = useServerFn(getMediaBackfillState);
  const deleteEntryFn = useServerFn(deleteMediaEntry);
  const subBackfillFn = useServerFn(backfillSubtitles);
  const subBackfillStateFn = useServerFn(getBackfillState);

  const browseItems = browse.data?.status === "ok" ? browse.data.items : null;
  const allItems = useMemo(() => browseItems ?? [], [browseItems]);
  const filtered = useMemo(
    () => allItems.filter((it) => matchesQuery(it, query)),
    [allItems, query],
  );
  const rows = useMemo(() => groupConsecutiveEpisodes(filtered), [filtered]);

  async function confirmDeleteTitleAction() {
    if (!confirmDeleteTitle) return;
    const { mediaId } = confirmDeleteTitle;
    const res = await deleteEntryFn({ data: { mediaId } });
    setConfirmDeleteTitle(null);
    if (!res.ok) {
      toast.error("Nu am putut șterge titlul", { description: res.error });
      return;
    }
    setSelectedMediaId(null);
    queryClient.invalidateQueries({ queryKey: ["plexLibraryBrowse"] });
    if (res.qbitDeleted) toast.success("Titlu șters complet — fișiere + qBittorrent + Plex");
    else toast.warning("Șters din jurnal, dar nu am putut confirma ștergerea din qBittorrent");
  }

  // Backfill-ul poate dura minute bune pe o bibliotecă mare — pornit în
  // fundal, urmărit exclusiv prin polling, ca la "Corectează subtitrări"
  // din Lansări (un singur request ținut deschis atât ar fi tăiat de
  // proxy/browser înainte de final).
  async function runMediaBackfill() {
    setBackfilling(true);
    setBackfillProgress(null);
    const toastId = toast.loading("Completez Biblioteca din TMDB pentru titlurile vechi…");

    const startRes = await startBackfillFn({}).catch((e) => ({
      status: "error" as const,
      error: e instanceof Error ? e.message : String(e),
    }));
    if (startRes.status !== "ok") {
      toast.error("Eroare la pornirea completării", { id: toastId, description: startRes.error });
      setBackfilling(false);
      return;
    }

    const pollInterval = setInterval(async () => {
      const state = await backfillStateFn().catch(() => null);
      if (!state) return;
      setBackfillProgress(state.progress);
      if (!state.running) {
        clearInterval(pollInterval);
        setBackfilling(false);
        setBackfillProgress(null);
        queryClient.invalidateQueries({ queryKey: ["plexLibraryBrowse"] });
        if (state.lastResult?.status === "ok") {
          const r = state.lastResult;
          toast.success("Bibliotecă completată", {
            id: toastId,
            description: `${r.processed} procesate, ${r.added} adăugate, ${r.skipped} sărite`,
            duration: 6000,
          });
        } else {
          toast.error("Eroare la completarea bibliotecii", {
            id: toastId,
            description: state.lastResult?.error,
          });
        }
      }
    }, 1500);
  }

  // Verifică/corectează subtitrarea RO pentru TOATE torrentele active din
  // qBittorrent (nu doar cele din `media`) — mutat aici din fosta pagină
  // Lansări (jurnalul de descărcări a fost absorbit de Bibliotecă).
  async function runSubtitleBackfill() {
    setSubBackfilling(true);
    setSubBackfillProgress(null);
    const toastId = toast.loading("Verific subtitrările pentru descărcările vechi…");

    const startRes = await subBackfillFn({}).catch((e) => ({
      status: "error" as const,
      error: e instanceof Error ? e.message : String(e),
    }));
    if (startRes.status !== "ok") {
      toast.error("Eroare la pornirea verificării", { id: toastId, description: startRes.error });
      setSubBackfilling(false);
      return;
    }

    const pollInterval = setInterval(async () => {
      const state = await subBackfillStateFn().catch(() => null);
      if (!state) return;
      setSubBackfillProgress(state.progress);
      if (!state.running) {
        clearInterval(pollInterval);
        setSubBackfilling(false);
        setSubBackfillProgress(null);
        if (state.lastResult?.status === "ok") {
          const r = state.lastResult;
          toast.success("Subtitrări verificate", {
            id: toastId,
            description: `${r.processed} verificate, ${r.corrected} corectate, ${r.skipped} sărite`,
            duration: 6000,
          });
        } else {
          toast.error("Eroare la verificarea subtitrărilor", {
            id: toastId,
            description: state.lastResult?.error,
          });
        }
      }
    }, 1500);
  }

  if (browse.isLoading) {
    return <div className="text-sm text-muted-foreground px-1">Se încarcă biblioteca…</div>;
  }
  if (browse.data?.status === "error") {
    return <div className="text-sm text-red-400 px-1">{browse.data.error}</div>;
  }
  if (allItems.length === 0) {
    return <div className="text-sm text-muted-foreground px-1">Biblioteca Plex e goală.</div>;
  }

  function toggleGroup(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function renderRow(item: PlexBrowseItem, indent = false) {
    return (
      <button
        key={item.mediaId}
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setSelectedMediaId(item.mediaId);
        }}
        className={`flex w-full items-center gap-2 rounded-lg bg-muted/40 px-2 py-1.5 text-left transition-colors hover:bg-muted/60 active:bg-muted ${indent ? "ml-4" : ""}`}
      >
        {item.thumbUrl ? (
          <img
            src={item.thumbUrl}
            className="h-8 w-8 shrink-0 rounded object-cover bg-muted"
            loading="lazy"
            alt=""
          />
        ) : item.type === "movie" ? (
          <Film className="h-3.5 w-3.5 shrink-0 text-amber-400" />
        ) : (
          <Tv className="h-3.5 w-3.5 shrink-0 text-blue-400" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs">
            {indent ? (episodeCode(item.season, item.episode) ?? item.title) : itemLabel(item)}
          </span>
          <span className="block truncate text-[10px] text-muted-foreground">
            {addedDate(item.addedAt)}
          </span>
        </span>
        <StatusBadge status={item.status} />
        {item.watchedByMe && <Eye className="h-3 w-3 shrink-0 text-emerald-400" />}
      </button>
    );
  }

  const visibleRows = rows.slice(0, visible);

  return (
    <div className="space-y-3">
      {isAdmin && (
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={runSubtitleBackfill}
            disabled={subBackfilling}
            className="flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-50"
            title="Verifică/corectează subtitrarea RO pentru toate torrentele active din qBittorrent"
          >
            {subBackfilling ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Captions className="h-3.5 w-3.5" />
            )}
            Verifică subtitrări
          </button>
          <button
            type="button"
            onClick={runMediaBackfill}
            disabled={backfilling}
            className="flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-50"
            title="Completează din TMDB titlurile vechi din Plex, adăugate înainte de acest sistem"
          >
            {backfilling ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <DatabaseZap className="h-3.5 w-3.5" />
            )}
            Completează din TMDB
          </button>
        </div>
      )}
      {subBackfilling && (
        <div className="px-1">
          <Progress
            value={
              subBackfillProgress
                ? (subBackfillProgress.done / Math.max(subBackfillProgress.total, 1)) * 100
                : 0
            }
          />
          <div className="mt-1 text-[11px] text-muted-foreground">
            {subBackfillProgress
              ? `${subBackfillProgress.done}/${subBackfillProgress.total} verificate`
              : "Pornesc verificarea…"}
          </div>
        </div>
      )}
      {backfilling && (
        <div className="px-1">
          <Progress
            value={
              backfillProgress
                ? (backfillProgress.done / Math.max(backfillProgress.total, 1)) * 100
                : 0
            }
          />
          <div className="mt-1 text-[11px] text-muted-foreground">
            {backfillProgress
              ? `${backfillProgress.done}/${backfillProgress.total} verificate`
              : "Pornesc completarea…"}
          </div>
        </div>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setVisible(PAGE_SIZE);
          }}
          placeholder="Caută film sau serial…"
          className="w-full rounded-xl border border-border bg-card py-2.5 pl-9 pr-3 text-sm outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {rows.length === 0 ? (
        <div className="text-sm text-muted-foreground px-1">Niciun rezultat.</div>
      ) : (
        <div className="rounded-2xl border border-border bg-card p-3">
          <div className="space-y-1">
            {visibleRows.map((row) =>
              row.kind === "single" ? (
                renderRow(row.item)
              ) : (
                <div key={row.key}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(row.key)}
                    className="flex w-full items-center gap-2 rounded-lg bg-muted/40 px-2 py-1.5 text-left transition-colors hover:bg-muted/60 active:bg-muted"
                  >
                    {row.items[0].thumbUrl ? (
                      <img
                        src={row.items[0].thumbUrl}
                        className="h-8 w-8 shrink-0 rounded object-cover bg-muted"
                        loading="lazy"
                        alt=""
                      />
                    ) : (
                      <Tv className="h-3.5 w-3.5 shrink-0 text-blue-400" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{row.show}</span>
                    <span className="flex shrink-0 items-center gap-1 rounded-full bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-400">
                      <Layers className="h-2.5 w-2.5" /> {row.items.length} episoade
                    </span>
                    {expandedGroups.has(row.key) ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                  </button>
                  {expandedGroups.has(row.key) && (
                    <div className="mt-1 space-y-1">
                      {row.items.map((it) => renderRow(it, true))}
                    </div>
                  )}
                </div>
              ),
            )}
          </div>
          {rows.length > visible && (
            <button
              type="button"
              onClick={() => setVisible((v) => v + PAGE_SIZE)}
              className="mt-1.5 w-full rounded-lg bg-muted/50 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
            >
              Afișează mai mult
            </button>
          )}
        </div>
      )}

      <TitleDetailDrawer
        mediaId={selectedMediaId}
        onClose={() => setSelectedMediaId(null)}
        onRequestDelete={(info) => setConfirmDeleteTitle(info)}
      />

      <AlertDialog
        open={!!confirmDeleteTitle}
        onOpenChange={(open) => !open && setConfirmDeleteTitle(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ștergere completă</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDeleteTitle?.isSeasonPack
                ? `Acest episod face parte dintr-un pachet de sezon — ștergerea elimină TOT pachetul (toate episoadele lui), din jurnal, din qBittorrent și de pe disk, apoi rescanează Plex.\n\n${confirmDeleteTitle?.title}`
                : `Ștergi titlul din jurnal, din qBittorrent și fișierele de pe disk, apoi rescanezi Plex?\n\n${confirmDeleteTitle?.title}`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Anulează</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteTitleAction}>Șterge</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
