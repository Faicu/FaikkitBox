import { useState } from "react";
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
  Flag,
  Clock3,
  Users,
  User,
  Tag,
  Loader2,
  Trash2,
  Wrench,
  ChevronDown,
  ChevronRight,
  ExternalLink,
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
import { formatMs, formatBytes, formatSpeed, formatEta } from "@/lib/format";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "./StatusBadge";
import { episodeCode, addedDate } from "./utils";

// Drawer-ul de detalii al unui titlu din Bibliotecă — complet independent de
// listă: primește doar mediaId, își gestionează singur toată starea (query
// de detalii, corectare/ștergere subtitrare). Cere listei doar două lucruri,
// prin callback-uri: să deschidă confirmarea de ștergere completă (dialogul
// rămâne la nivel de listă, ca să rămână deasupra drawer-ului) și să știe
// când s-a șters efectiv titlul, ca să închidă drawer-ul și să
// reîmprospăteze lista.
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
  const [showTech, setShowTech] = useState(false);

  const correctFn = useServerFn(correctSubtitleForMedia);
  const deleteSubtitleFn = useServerFn(deleteSubtitleForMedia);

  const detail = useQuery({
    queryKey: ["plexTitleDetail", mediaId],
    queryFn: () => getPlexTitleDetail({ data: { mediaId: mediaId! } }),
    enabled: !!mediaId,
    // Progres live cât timp titlul e în descărcare — se oprește automat
    // când trece la "in_library" (vezi și plexLibraryBrowseQuery).
    refetchInterval: (query) => {
      const d = query.state.data;
      return d?.status === "ok" && d.detail.status === "downloading" ? 2500 : false;
    },
  });
  const d = detail.data?.status === "ok" ? detail.data.detail : null;

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
              {d?.originalTitle &&
                d.originalTitle !== (d.type === "movie" ? d.title : (d.show ?? d.title)) && (
                  <div className="mt-0.5 truncate text-xs text-muted-foreground italic">
                    {d.originalTitle}
                  </div>
                )}
              {d?.imdbId && (
                <a
                  href={`https://www.imdb.com/title/${d.imdbId}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex w-fit items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-muted transition-colors"
                >
                  <ExternalLink className="h-3 w-3" /> IMDb
                </a>
              )}
            </div>
          </div>
        </DrawerHeader>

        <div className="px-4 pb-6 space-y-3 overflow-y-auto overscroll-contain max-h-[65vh]">
          {detail.isLoading && (
            <div className="text-xs text-muted-foreground">Se încarcă detaliile…</div>
          )}
          {detail.data?.status === "error" && (
            <div className="text-xs text-red-400">{detail.data.error}</div>
          )}
          {d && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {d.status !== "in_library" && (
                  <StatusBadge status={d.status} progress={d.progress} />
                )}
                {d.quality && (
                  <span className="rounded-full bg-amber-500/15 text-amber-400 px-2 py-0.5 font-medium">
                    {d.quality}
                  </span>
                )}
                {d.hasRomanianAudio ? (
                  <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 text-emerald-400 px-2 py-0.5 font-medium">
                    <Flag className="h-3 w-3" />
                    Românesc
                  </span>
                ) : (
                  // Cât timp titlul e în descărcare, subtitrarea încă nu a fost
                  // căutată/verificată — un badge "Fără subtitrare RO" ar fi fals,
                  // nu doar incomplet, de-aia îl ascundem până se termină.
                  d.status !== "downloading" && (
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
                  )
                )}
                {d.durationMs > 0 && (
                  <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground">
                    <Clock3 className="h-3 w-3" /> {formatMs(d.durationMs)}
                  </span>
                )}
                {d.year && (
                  <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground">
                    {d.year}
                  </span>
                )}
              </div>

              {d.status === "downloading" && d.progress != null && (
                <div>
                  <Progress value={d.progress} />
                  <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{d.progress.toFixed(1)}%</span>
                    <span>
                      {d.dlspeed != null && formatSpeed(d.dlspeed)}
                      {d.eta != null && ` · rămas ${formatEta(d.eta)}`}
                    </span>
                  </div>
                </div>
              )}

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
                <span>
                  {d.watchedByMe
                    ? d.watchedByMeAt
                      ? `Ai văzut acest titlu · ${addedDate(d.watchedByMeAt)}`
                      : "Ai văzut acest titlu"
                    : "Nu ai văzut acest titlu"}
                </span>
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

              {d.tech && (
                <div className="text-xs">
                  <button
                    type="button"
                    onClick={() => setShowTech((v) => !v)}
                    className="flex w-full items-center gap-1 py-1 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Wrench className="h-3.5 w-3.5" /> Detalii tehnice
                    {showTech ? (
                      <ChevronDown className="h-3.5 w-3.5 ml-auto" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 ml-auto" />
                    )}
                  </button>
                  {showTech && (
                  <div className="flex flex-col gap-1 rounded-lg bg-muted/40 px-2 py-1.5">
                    {[
                      d.tech.torrentName && ["Torrent", d.tech.torrentName],
                      d.tech.sizeBytes > 0 && ["Mărime", formatBytes(d.tech.sizeBytes)],
                      d.tech.categoryName && ["Categorie", d.tech.categoryName],
                      (d.tech.freeleech || d.tech.internal) && [
                        "Steaguri",
                        [d.tech.freeleech && "freeleech", d.tech.internal && "internal"]
                          .filter(Boolean)
                          .join(", "),
                      ],
                      d.tech.savePath && ["Cale disk", d.tech.savePath],
                      d.tech.addedVia && ["Adăugat via", d.tech.addedVia],
                      d.tech.completedAt && ["Finalizat", addedDate(Math.floor(new Date(`${d.tech.completedAt.replace(" ", "T")}Z`).getTime() / 1000))],
                      d.tech.subtitleSource && ["Sursă subtitrare", d.tech.subtitleSource],
                      d.tech.subtitleDetail && ["Detaliu subtitrare", d.tech.subtitleDetail],
                      d.tech.subtitleCheckedAt && [
                        "Subtitrare verificată",
                        addedDate(
                          Math.floor(
                            new Date(`${d.tech.subtitleCheckedAt.replace(" ", "T")}Z`).getTime() /
                              1000,
                          ),
                        ),
                      ],
                      d.tech.plexRatingKey && ["Plex ratingKey", d.tech.plexRatingKey],
                      d.tech.imdbId && ["IMDb", d.tech.imdbId],
                      d.torrentHash && ["Torrent hash", d.torrentHash],
                    ]
                      .filter((row): row is [string, string] => !!row)
                      .map(([label, value]) => (
                        <div key={label} className="flex justify-between gap-3">
                          <span className="shrink-0 text-muted-foreground">{label}</span>
                          <span className="min-w-0 truncate text-right text-foreground" title={value}>
                            {value}
                          </span>
                        </div>
                      ))}
                  </div>
                  )}
                </div>
              )}

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
                    Nu știm ce torrent corespunde acestui titlu (a fost adăugat manual în Plex, sau
                    torrentul nu mai există în qBittorrent) — corectarea/ștergerea subtitrării și
                    ștergerea completă nu sunt disponibile.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
