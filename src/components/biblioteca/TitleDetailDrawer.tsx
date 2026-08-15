import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
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
  Loader2,
  Trash2,
  Pin,
} from "lucide-react";

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { getPlexTitleDetail } from "@/lib/services.functions";
import { correctSubtitleForMedia, deleteSubtitleForMedia } from "@/lib/filelist.functions";
import {
  setPinnedItems,
  unpinTitleEverywhere,
  getWatchSettings,
  setWatchSettings,
} from "@/lib/pinned.functions";
import type { WatchSettings } from "@/lib/pinned.functions";
import { pinnedItemsQuery } from "@/lib/queries";
import { PinnedTitleManager } from "@/components/pinned/PinnedTitleManager";
import { PlexStatusBadge } from "@/components/pinned/PlexStatusBadge";
import type { TvPlexStatus } from "@/components/pinned/plex-status";
import { formatMs } from "@/lib/format";
import { StatusBadge } from "./StatusBadge";
import { episodeCode, addedDate } from "./utils";

// Drawer-ul de detalii al unui titlu din Bibliotecă — complet independent de
// listă: primește doar mediaId, își gestionează singur toată starea (query
// de detalii, fixare/scoatere fixare, corectare/ștergere subtitrare). Cere
// listei doar două lucruri, prin callback-uri: să deschidă confirmarea de
// ștergere completă (dialogul rămâne la nivel de listă, ca să rămână deasupra
// drawer-ului) și să știe când s-a șters efectiv titlul, ca să închidă
// drawer-ul și să reîmprospăteze lista.
export function TitleDetailDrawer({
  mediaId,
  onClose,
  onRequestDelete,
}: {
  mediaId: number | null;
  onClose: () => void;
  onRequestDelete: (info: { mediaId: number; title: string; isSeasonPack: boolean }) => void;
}) {
  const queryClient = useQueryClient();
  const [correcting, setCorrecting] = useState(false);
  const [deletingSubtitle, setDeletingSubtitle] = useState(false);
  const [watchMap, setWatchMap] = useState<Map<string, WatchSettings>>(new Map());
  const [pinnedPlexStatus, setPinnedPlexStatus] = useState<TvPlexStatus | null>(null);
  const [pinnedPlexLoading, setPinnedPlexLoading] = useState(false);

  const correctFn = useServerFn(correctSubtitleForMedia);
  const deleteSubtitleFn = useServerFn(deleteSubtitleForMedia);
  const { data: pinnedList = [] } = useQuery(pinnedItemsQuery);
  const setPinnedFn = useServerFn(setPinnedItems);
  const unpinFn = useServerFn(unpinTitleEverywhere);
  const getWatchFn = useServerFn(getWatchSettings);
  const setWatchFn = useServerFn(setWatchSettings);

  const detail = useQuery({
    queryKey: ["plexTitleDetail", mediaId],
    queryFn: () => getPlexTitleDetail({ data: { mediaId: mediaId! } }),
    enabled: !!mediaId,
  });
  const d = detail.data?.status === "ok" ? detail.data.detail : null;

  // Resetat la fiecare titlu deschis, ca badge-ul de status Plex (ridicat din
  // PinnedTitleManager, afișat sus lângă "Fixat") să nu arate o valoare veche
  // rămasă de la titlul anterior cât timp se încarcă cel nou.
  useEffect(() => {
    setPinnedPlexStatus(null);
    setPinnedPlexLoading(false);
  }, [mediaId]);

  // Setările de urmărire (auto-download/notify) pentru titlurile fixate —
  // încărcate o singură dată, folosite când titlul deschis (oricare, nu doar
  // cele fără nimic descărcat) e fixat.
  useEffect(() => {
    getWatchFn({})
      .then((settings) => {
        const map = new Map<string, WatchSettings>();
        for (const s of settings) map.set(`${s.mediaType}-${s.id}`, s);
        setWatchMap(map);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function updateWatch(id: number, mediaType: "movie" | "tv", patch: Partial<WatchSettings>) {
    const key = `${mediaType}-${id}`;
    const current = watchMap.get(key) ?? {
      id,
      mediaType,
      watchFilelist: false,
      watchFilelistSeason: false,
      watchTmdb: false,
      autoDownload: false,
      autoDownloadQuality: "1080p" as const,
    };
    const next = { ...current, ...patch };
    if (!next.watchFilelist) {
      next.watchFilelistSeason = false;
      next.autoDownload = false;
    }
    setWatchMap((m) => new Map(m).set(key, next));
    await setWatchFn({ data: next }).catch(() => {});
  }

  // Fixarea nu mai e legată de existența unui card separat — orice titlu din
  // Bibliotecă (descărcat, în curs, sau doar identificat) poate fi fixat
  // pentru urmărire automată direct din drawer-ul lui. Dacă titlul e ȘI
  // descărcat/în bibliotecă, rândul rămâne vizibil în listă chiar și după
  // scoaterea din fixări (mai are alt motiv să apară); dacă exista în listă
  // EXCLUSIV pentru că era fixat (status "pinned"), scoaterea îl face să
  // dispară din listă, deci închidem drawer-ul.
  //
  // Fixarea propriu-zisă (adăugarea) rămâne pe lista personală a userului
  // curent (setPinnedItems, cu atribuire cine a fixat). Dar scoaterea NU
  // poate fi doar personală: vizibilitatea unui titlu fixat în Bibliotecă
  // e o stare comună (EXISTS pe pinned_items, indiferent de user — vezi
  // isPinnedByAnyone/getPlexLibraryBrowse), deci scoaterea trebuie să fie la
  // fel de comună (unpinTitleEverywhere) — altfel titlul rămâne în listă
  // fiindcă mai e fixat de alt cont, deși userul curent tocmai l-a scos din
  // fixările lui (bug real, raportat direct: "The Odyssey").
  async function pinTitle(
    tmdbId: number,
    mediaType: "movie" | "tv",
    title: string,
    originalTitle: string | null,
    posterUrl: string | null,
  ) {
    const already = pinnedList.some((p) => p.id === tmdbId && p.mediaType === mediaType);
    if (!already) {
      const next = [
        ...pinnedList,
        { id: tmdbId, mediaType, title, originalTitle: originalTitle || title, posterUrl },
      ];
      await setPinnedFn({ data: { items: next } }).catch(() => {});
    }
    await queryClient.invalidateQueries({ queryKey: ["pinnedItems"] });
    await queryClient.invalidateQueries({ queryKey: ["plexLibraryBrowse"] });
  }

  async function unpinTitle(tmdbId: number, mediaType: "movie" | "tv", closeIfRemoved: boolean) {
    await unpinFn({ data: { id: tmdbId, mediaType } }).catch(() => {});
    await queryClient.invalidateQueries({ queryKey: ["pinnedItems"] });
    await queryClient.invalidateQueries({ queryKey: ["plexLibraryBrowse"] });
    if (closeIfRemoved) onClose();
  }

  function invalidateAfterMutation() {
    queryClient.invalidateQueries({ queryKey: ["plexLibraryBrowse"] });
    if (mediaId) queryClient.invalidateQueries({ queryKey: ["plexTitleDetail", mediaId] });
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

  return (
    <Drawer open={!!mediaId} onOpenChange={(o) => !o && onClose()}>
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
                {d.status === "pinned" &&
                  (pinnedPlexLoading ? (
                    <span className="h-5 w-20 animate-pulse rounded-full bg-muted/40" />
                  ) : (
                    <PlexStatusBadge status={pinnedPlexStatus ?? "lipsa"} />
                  ))}
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
                    {d.hasRomanianSubtitle ? "Subtitrare RO" : "Fără subtitrare RO (doar engleză)"}
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

              {d.tmdbId &&
                (() => {
                  const pinnedMediaType = d.type === "movie" ? "movie" : "tv";
                  const titleForPin = d.type === "movie" ? d.title : (d.show ?? d.title);
                  return (
                    <div className="flex flex-col gap-2 pt-1 border-t border-border">
                      {!d.isPinnedByAnyone && (
                        <button
                          type="button"
                          onClick={() =>
                            pinTitle(
                              d.tmdbId!,
                              pinnedMediaType,
                              titleForPin,
                              d.originalTitle,
                              d.thumbUrl,
                            )
                          }
                          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-muted/40 py-2 text-xs font-medium text-foreground hover:bg-muted/60 transition-colors"
                        >
                          <Pin className="h-3.5 w-3.5" />
                          Fixează pentru urmărire automată
                        </button>
                      )}
                      {d.isPinnedByAnyone && (
                        <PinnedTitleManager
                          tmdbId={d.tmdbId}
                          mediaType={pinnedMediaType}
                          title={titleForPin}
                          originalTitle={d.originalTitle}
                          posterUrl={d.thumbUrl}
                          watchSettings={watchMap.get(`${pinnedMediaType}-${d.tmdbId}`) ?? null}
                          onWatchChange={(patch) => updateWatch(d.tmdbId!, pinnedMediaType, patch)}
                          onUnpin={() =>
                            unpinTitle(d.tmdbId!, pinnedMediaType, d.status === "pinned")
                          }
                          onPlexStatus={(status, loading) => {
                            setPinnedPlexStatus(status);
                            setPinnedPlexLoading(loading);
                          }}
                        />
                      )}
                    </div>
                  );
                })()}

              {d.status !== "pinned" && (
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
                            onRequestDelete({
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
                      Nu știm ce torrent corespunde acestui titlu (a fost adăugat manual în Plex,
                      sau torrentul nu mai există în qBittorrent) — corectarea/ștergerea subtitrării
                      și ștergerea completă nu sunt disponibile.
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
