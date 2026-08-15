import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Search,
  Film,
  Tv,
  Eye,
  EyeOff,
  Captions,
  CaptionsOff,
  Clock3,
  Users,
  User,
  Tag,
  ChevronDown,
  ChevronRight,
  Loader2,
  Trash2,
  Layers,
  DatabaseZap,
  Download,
  Pin,
} from "lucide-react";

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
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
import { getPlexTitleDetail } from "@/lib/services.functions";
import {
  correctSubtitleForMedia,
  deleteSubtitleForMedia,
  deleteMediaEntry,
} from "@/lib/filelist.functions";
import { startMediaBackfill, getMediaBackfillState } from "@/lib/media-backfill";
import { formatMs } from "@/lib/format";
import { formatDateTime } from "@/components/tehnic/utils";
import type { PlexBrowseItem } from "@/lib/services/plex-browse";

const PAGE_SIZE = 20;

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function episodeCode(season: number | null, episode: number | null): string | null {
  return season != null && episode != null
    ? `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`
    : null;
}

function itemLabel(item: PlexBrowseItem): string {
  if (item.type === "movie") return item.title;
  if (item.type === "tv_show") return item.show ?? "—";
  const code = episodeCode(item.season, item.episode);
  return `${item.show ?? "—"}${code ? ` — ${code}` : ""}${item.title ? ` · ${item.title}` : ""}`;
}

function StatusBadge({ status }: { status: PlexBrowseItem["status"] }) {
  if (status === "downloading") {
    return (
      <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
        <Download className="h-2.5 w-2.5" /> Se descarcă
      </span>
    );
  }
  if (status === "pinned") {
    return (
      <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-400">
        <Pin className="h-2.5 w-2.5" /> Fixat
      </span>
    );
  }
  return null;
}

// addedAt e unix timestamp în secunde (convenția Plex) — formatDateTime
// lucrează cu ISO, de-aia conversia
function addedDate(unixSec: number): string {
  if (!unixSec) return "—";
  return formatDateTime(new Date(unixSec * 1000).toISOString());
}

type Row =
  | { kind: "single"; item: PlexBrowseItem }
  | { kind: "group"; key: string; show: string; items: PlexBrowseItem[] };

// Grupează episoadele consecutive (adiacente în lista sortată după addedAt)
// ale aceluiași serial într-un singur rând expandabil — un serial cu
// episoade lansate în zile diferite (deci neadiacente în listă) rămâne cu
// grupuri separate, nu unul singur, ca ordinea cronologică să rămână corectă.
function groupConsecutiveEpisodes(items: PlexBrowseItem[]): Row[] {
  const rows: Row[] = [];
  let i = 0;
  while (i < items.length) {
    const cur = items[i];
    if (cur.type === "episode" && cur.show) {
      let j = i + 1;
      while (j < items.length && items[j].type === "episode" && items[j].show === cur.show) j++;
      if (j - i > 1) {
        rows.push({
          kind: "group",
          key: `${cur.show}-${cur.mediaId}`,
          show: cur.show,
          items: items.slice(i, j),
        });
        i = j;
        continue;
      }
    }
    rows.push({ kind: "single", item: cur });
    i++;
  }
  return rows;
}

function matchesQuery(item: PlexBrowseItem, q: string): boolean {
  if (!q) return true;
  const n = norm(q);
  return norm(item.title).includes(n) || (!!item.show && norm(item.show).includes(n));
}

export function BibliotecaList() {
  const queryClient = useQueryClient();
  const browse = useQuery(plexLibraryBrowseQuery);
  const { data: adminData } = useQuery(adminStatusQuery);
  const isAdmin = !!adminData?.isAdmin;
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedMediaId, setSelectedMediaId] = useState<number | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [deletingSubtitle, setDeletingSubtitle] = useState(false);
  const [confirmDeleteTitle, setConfirmDeleteTitle] = useState<{
    mediaId: number;
    title: string;
    isSeasonPack: boolean;
  } | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<{ total: number; done: number } | null>(
    null,
  );

  const correctFn = useServerFn(correctSubtitleForMedia);
  const deleteSubtitleFn = useServerFn(deleteSubtitleForMedia);
  const startBackfillFn = useServerFn(startMediaBackfill);
  const backfillStateFn = useServerFn(getMediaBackfillState);
  const deleteEntryFn = useServerFn(deleteMediaEntry);

  const detail = useQuery({
    queryKey: ["plexTitleDetail", selectedMediaId],
    queryFn: () => getPlexTitleDetail({ data: { mediaId: selectedMediaId! } }),
    enabled: !!selectedMediaId,
  });

  const browseItems = browse.data?.status === "ok" ? browse.data.items : null;
  const allItems = useMemo(() => browseItems ?? [], [browseItems]);
  const filtered = useMemo(
    () => allItems.filter((it) => matchesQuery(it, query)),
    [allItems, query],
  );
  const rows = useMemo(() => groupConsecutiveEpisodes(filtered), [filtered]);

  if (browse.isLoading) {
    return <div className="text-sm text-muted-foreground px-1">Se încarcă biblioteca…</div>;
  }
  if (browse.data?.status === "error") {
    return <div className="text-sm text-red-400 px-1">{browse.data.error}</div>;
  }
  if (allItems.length === 0) {
    return <div className="text-sm text-muted-foreground px-1">Biblioteca Plex e goală.</div>;
  }

  const d = detail.data?.status === "ok" ? detail.data.detail : null;

  function toggleGroup(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function invalidateAfterMutation() {
    queryClient.invalidateQueries({ queryKey: ["plexLibraryBrowse"] });
    if (selectedMediaId)
      queryClient.invalidateQueries({ queryKey: ["plexTitleDetail", selectedMediaId] });
  }

  async function correctSubtitle() {
    if (!d) return;
    setCorrecting(true);
    const toastId = toast.loading(`Verific subtitrarea pentru „${d.title}”…`);
    const res = await correctFn({
      data: { mediaId: d.mediaId },
    }).catch((e) => ({
      status: "error" as const,
      error: e instanceof Error ? e.message : String(e),
    }));
    setCorrecting(false);
    if (res.status !== "ok") {
      toast.error("Eroare la corectarea subtitrării", { id: toastId, description: res.error });
      return;
    }
    toast.success("Subtitrare verificată", {
      id: toastId,
      description: res.detail,
      duration: 6000,
    });
    invalidateAfterMutation();
  }

  async function deleteSubtitle() {
    if (!d) return;
    setDeletingSubtitle(true);
    const toastId = toast.loading(`Șterg subtitrarea pentru „${d.title}”…`);
    const res = await deleteSubtitleFn({
      data: { mediaId: d.mediaId },
    }).catch((e) => ({
      status: "error" as const,
      error: e instanceof Error ? e.message : String(e),
    }));
    setDeletingSubtitle(false);
    if (res.status !== "ok") {
      toast.error("Eroare la ștergerea subtitrării", { id: toastId, description: res.error });
      return;
    }
    toast.success("Subtitrare ștearsă", {
      id: toastId,
      description: res.deleted.join(", "),
      duration: 6000,
    });
    invalidateAfterMutation();
  }

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
        <span className="min-w-0 flex-1 truncate text-xs">
          {indent ? (episodeCode(item.season, item.episode) ?? item.title) : itemLabel(item)}
        </span>
        <StatusBadge status={item.status} />
        {item.watchedByMe && <Eye className="h-3 w-3 shrink-0 text-emerald-400" />}
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {addedDate(item.addedAt)}
        </span>
      </button>
    );
  }

  const visibleRows = rows.slice(0, visible);

  return (
    <div className="space-y-3">
      {isAdmin && (
        <div className="flex items-center justify-end">
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

      <Drawer open={!!selectedMediaId} onOpenChange={(o) => !o && setSelectedMediaId(null)}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="pb-2 text-left">
            <div className="flex items-start gap-3">
              {d?.thumbUrl && (
                <img
                  src={d.thumbUrl}
                  className="h-20 w-14 shrink-0 rounded-lg object-cover bg-muted"
                  loading="lazy"
                  alt=""
                />
              )}
              <div className="min-w-0">
                <DrawerTitle className="flex items-center gap-2 text-base">
                  {d?.type === "movie" ? (
                    <Film className="h-4 w-4 text-amber-400 shrink-0" />
                  ) : (
                    <Tv className="h-4 w-4 text-blue-400 shrink-0" />
                  )}
                  {d ? (d.type === "movie" ? d.title : (d.show ?? d.title)) : "Se încarcă…"}
                </DrawerTitle>
                {d?.type === "episode" && (
                  <DrawerDescription className="text-left text-sm font-medium text-foreground leading-snug mt-1">
                    {episodeCode(d.season, d.episode) ?? ""}
                    {d.title ? ` · ${d.title}` : ""}
                  </DrawerDescription>
                )}
              </div>
            </div>
          </DrawerHeader>

          <div className="px-4 pb-6 space-y-3 overflow-y-auto max-h-[65vh]">
            {detail.isLoading && (
              <div className="text-xs text-muted-foreground">Se încarcă detaliile…</div>
            )}
            {detail.data?.status === "error" && (
              <div className="text-xs text-red-400">{detail.data.error}</div>
            )}
            {d && (
              <>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {d.status !== "in_library" && <StatusBadge status={d.status} />}
                  {d.quality && (
                    <span className="rounded-full bg-amber-500/15 text-amber-400 px-2 py-0.5 font-medium">
                      {d.quality}
                    </span>
                  )}
                  {d.status !== "pinned" && (
                    <span
                      className={`flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
                        d.hasRomanianSubtitle
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <Captions className="h-3 w-3" />
                      {d.hasRomanianSubtitle
                        ? "Subtitrare RO"
                        : "Fără subtitrare RO (doar engleză)"}
                    </span>
                  )}
                  {d.durationMs > 0 && (
                    <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground">
                      <Clock3 className="h-3 w-3" /> {formatMs(d.durationMs)}
                    </span>
                  )}
                </div>

                {d.genres.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <Tag className="h-3 w-3 text-muted-foreground shrink-0" />
                    {d.genres.map((g) => (
                      <span
                        key={g}
                        className="rounded-full bg-muted/60 px-2 py-0.5 text-[11px] text-foreground"
                      >
                        {g}
                      </span>
                    ))}
                  </div>
                )}

                {d.summary && (
                  <div className="text-xs text-muted-foreground leading-relaxed">{d.summary}</div>
                )}

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>Adăugat: {addedDate(d.addedAt)}</span>
                  <span className="flex items-center gap-1">
                    <User className="h-3 w-3" /> {d.addedByUsername ?? "necunoscut"}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 text-xs">
                  {d.watchedByMe ? (
                    <Eye className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  ) : (
                    <EyeOff className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  )}
                  <span>{d.watchedByMe ? "Ai văzut acest titlu" : "Nu ai văzut acest titlu"}</span>
                </div>

                <div className="text-xs">
                  <div className="mb-1 flex items-center gap-1 text-muted-foreground">
                    <Users className="h-3.5 w-3.5" /> Alți utilizatori care au văzut
                  </div>
                  {d.watchedByOthers.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      {d.watchedByOthers.map((u) => (
                        <div
                          key={u.username}
                          className="flex items-center justify-between gap-2 rounded-lg bg-muted/60 px-2 py-1"
                        >
                          <span className="text-[11px] font-medium text-foreground">
                            {u.username}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {addedDate(u.viewedAt)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-muted-foreground">Nimeni altcineva încă</div>
                  )}
                </div>

                <div className="flex flex-col gap-2 pt-1 border-t border-border">
                  {d.torrentHash ? (
                    d.canManage ? (
                      <>
                        <div className="flex gap-2 pt-2">
                          <button
                            type="button"
                            onClick={correctSubtitle}
                            disabled={correcting}
                            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-muted/40 py-2 text-xs font-medium text-foreground hover:bg-muted/60 transition-colors disabled:opacity-40"
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
                            onClick={deleteSubtitle}
                            disabled={deletingSubtitle}
                            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-muted/40 py-2 text-xs font-medium text-foreground hover:bg-muted/60 transition-colors disabled:opacity-40"
                          >
                            {deletingSubtitle ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <CaptionsOff className="h-3.5 w-3.5" />
                            )}
                            Șterge subtitrare
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmDeleteTitle({
                              mediaId: d.mediaId,
                              title: d.type === "movie" ? d.title : (d.show ?? d.title),
                              isSeasonPack: d.isSeasonPack,
                            })
                          }
                          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-muted/40 py-2 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Șterge titlul complet
                        </button>
                      </>
                    ) : (
                      <div className="pt-2 text-[11px] text-muted-foreground">
                        Doar {d.addedByUsername ?? "cel care a adăugat titlul"} sau un admin poate
                        corecta/șterge subtitrarea sau șterge titlul.
                      </div>
                    )
                  ) : (
                    <div className="pt-2 text-[11px] text-muted-foreground">
                      {d.status === "pinned"
                        ? "Titlu fixat pentru urmărire — nu a fost încă descărcat nimic, deci nu sunt încă butoane de gestionat."
                        : "Nu știm ce torrent corespunde acestui titlu (a fost adăugat manual în Plex, sau torrentul nu mai există în qBittorrent) — corectarea/ștergerea subtitrării și ștergerea completă nu sunt disponibile."}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </DrawerContent>
      </Drawer>

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
