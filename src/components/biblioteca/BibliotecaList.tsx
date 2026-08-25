import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Search,
  Film,
  Tv,
  Eye,
  Users,
  ChevronDown,
  ChevronRight,
  Layers,
  AlertTriangle,
} from "lucide-react";

import { plexLibraryBrowseQuery } from "@/lib/queries";
import { deleteMediaEntry } from "@/lib/filelist.functions";
import type { PlexBrowseItem } from "@/lib/services/plex-browse";
import { StatusBadge } from "./StatusBadge";
import { TitleDetailDrawer } from "./TitleDetailDrawer";
import {
  episodeCode,
  addedDate,
  itemLabel,
  groupConsecutiveEpisodes,
  matchesQuery,
  isStaleUnwatched,
  sortItems,
  type SortMode,
} from "./utils";

const PAGE_SIZE = 20;

export function BibliotecaList() {
  const queryClient = useQueryClient();
  const browse = useQuery(plexLibraryBrowseQuery);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedMediaId, setSelectedMediaId] = useState<number | null>(null);
  const [confirmDeleteTitle, setConfirmDeleteTitle] = useState<{
    mediaId: number;
    title: string;
    isSeasonPack: boolean;
  } | null>(null);
  const deleteEntryFn = useServerFn(deleteMediaEntry);

  const browseItems = browse.data?.status === "ok" ? browse.data.items : null;
  const allItems = useMemo(() => browseItems ?? [], [browseItems]);
  const filtered = useMemo(
    () =>
      sortItems(
        allItems.filter((it) => matchesQuery(it, query)),
        sortMode,
      ),
    [allItems, query, sortMode],
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
        <StatusBadge status={item.status} progress={item.progress} />
        {item.watchedCount > 0 && (
          <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-muted-foreground">
            <Users className="h-3 w-3" />
            {item.watchedCount}
          </span>
        )}
        {isStaleUnwatched(item) && (
          <span
            title="Nimeni nu l-a vizionat de peste 3 luni"
            className="flex shrink-0 items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400"
          >
            <AlertTriangle className="h-2.5 w-2.5" />
          </span>
        )}
        {item.watchedByMe && <Eye className="h-3 w-3 shrink-0 text-emerald-400" />}
      </button>
    );
  }

  const visibleRows = rows.slice(0, visible);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
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
        <select
          value={sortMode}
          onChange={(e) => {
            setSortMode(e.target.value as SortMode);
            setVisible(PAGE_SIZE);
          }}
          className="shrink-0 rounded-xl border border-border bg-card px-2 text-xs outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="recent">Recent adăugate</option>
          <option value="mostWatched">Cei mai vizionați</option>
          <option value="unwatched">Nevăzute de nimeni</option>
        </select>
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

      {/* Overlay simplu (fără AlertDialog/focus-trap Radix) — peste
          TitleDetailDrawer (deja deschis) a fost un risc de îngheț identic
          cu bug-ul reparat în AddMediaWizard, vezi commit c76ce30. */}
      {confirmDeleteTitle && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80"
          onClick={() => setConfirmDeleteTitle(null)}
        >
          <div
            role="dialog"
            aria-label="Ștergere completă"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-5 shadow-xl"
          >
            <div className="text-sm font-semibold">Ștergere completă</div>
            <p className="whitespace-pre-line text-sm text-muted-foreground">
              {confirmDeleteTitle.isSeasonPack
                ? `Acest episod face parte dintr-un pachet de sezon — ștergerea elimină TOT pachetul (toate episoadele lui), din jurnal, din qBittorrent și de pe disk, apoi rescanează Plex.\n\n${confirmDeleteTitle.title}`
                : `Ștergi titlul din jurnal, din qBittorrent și fișierele de pe disk, apoi rescanezi Plex?\n\n${confirmDeleteTitle.title}`}
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:space-x-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteTitle(null)}
                className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-muted/60"
              >
                Anulează
              </button>
              <button
                type="button"
                onClick={confirmDeleteTitleAction}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
              >
                Șterge
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
