import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";

import { Drawer, DrawerContent, DrawerHeader } from "@/components/ui/drawer";
import { getPlexTitleDetail } from "@/lib/services.functions";
import { AudienceCard } from "./AudienceCard";
import { EpisodeList } from "./EpisodeList";
import { ShowWatchCard } from "./ShowWatchCard";
import { TechDetails } from "./TechDetails";
import { TitleActions, type TitleDeleteRequest } from "./TitleActions";
import { TitleDetailHeader } from "./TitleDetailHeader";
import { ClampedSummary } from "./TitleDetailParts";

// Drawer-ul de detalii al unui titlu — independent de listă: primește doar
// mediaId și își ține singur starea. Confirmarea ștergerii complete stă la
// nivelul listei, ca overlay simplu (un AlertDialog Radix imbricat îngheață
// ecranul, c76ce30).
export function TitleDetailDrawer({
  mediaId,
  onClose,
  onRequestDelete,
}: {
  mediaId: number | null;
  onClose: () => void;
  onRequestDelete: (info: TitleDeleteRequest) => void;
}) {
  const queryClient = useQueryClient();
  const [showTech, setShowTech] = useState(false);
  // Serial → episod în ACELAȘI drawer, cu buton înapoi — un overlay Radix
  // imbricat în vaul îngheață ecranul (c76ce30). Perechea (serial, episod), nu
  // doar episodul: ștergerea pune mediaId pe null din afară, fără onOpenChange,
  // iar episodul rămânea agățat pentru următorul titlu deschis.
  const [openEpisode, setOpenEpisode] = useState<{ showId: number; episodeId: number } | null>(
    null,
  );

  // Serialul rămâne titlul de bază; un episod deschis devine subiectul. Fără
  // titlu de bază (șters), episodul nu mai are context.
  const openEpisodeId = openEpisode?.showId === mediaId ? openEpisode.episodeId : null;
  const activeId = mediaId == null ? null : (openEpisodeId ?? mediaId);

  const detail = useQuery({
    queryKey: ["plexTitleDetail", activeId],
    queryFn: () => getPlexTitleDetail({ data: { mediaId: activeId! } }),
    enabled: !!activeId,
    // Progres live cât titlul se descarcă sau așteaptă indexarea; se oprește la
    // "in_library". La seriale, pulsul rapid doar cât măcar un episod are un
    // procent care urcă — un episod blocat definitiv ținea altfel pulsul de
    // 2,5s pornit la nesfârșit.
    refetchInterval: (query) => {
      const d = query.state.data;
      if (d?.status !== "ok") return false;
      const { status, type } = d.detail;
      if (status !== "downloading" && status !== "processing") return false;
      if (type !== "tv_show") return 2500;
      return d.detail.episodes.some((e) => e.status === "downloading" && e.progress != null)
        ? 2500
        : 15_000;
    },
  });
  const d = detail.data?.status === "ok" ? detail.data.detail : null;
  const watchedEpisodes = d?.episodes.filter((e) => e.watchedByMe).length ?? 0;

  function invalidateAfterMutation() {
    queryClient.invalidateQueries({ queryKey: ["plexLibraryBrowse"] });
    // Ambele niveluri: o schimbare pe episod se vede și în lista serialului.
    for (const id of new Set([mediaId, activeId])) {
      if (id) queryClient.invalidateQueries({ queryKey: ["plexTitleDetail", id] });
    }
  }

  return (
    <Drawer
      open={!!mediaId}
      onOpenChange={(o) => {
        if (o) return;
        setOpenEpisode(null);
        onClose();
      }}
    >
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="pb-2 text-left">
          {openEpisodeId != null && (
            <button
              type="button"
              onClick={() => setOpenEpisode(null)}
              className="mb-1 flex w-fit items-center gap-1 rounded-full bg-muted/60 px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" /> Înapoi la serial
            </button>
          )}
          <TitleDetailHeader detail={d} />
        </DrawerHeader>

        <div className="min-h-0 flex-1 px-4 pb-6 space-y-3 overflow-y-auto overscroll-contain">
          {detail.isLoading && (
            <div className="text-xs text-muted-foreground">Se încarcă detaliile…</div>
          )}
          {detail.data?.status === "error" && (
            <div className="text-xs text-red-400">{detail.data.error}</div>
          )}
          {d && (
            <>
              {/* Cadrul episodului, în partea care se derulează — în antetul fix
                  ocupa prea mult. */}
              {d.type === "episode" && d.stillUrl && (
                <img
                  src={d.stillUrl}
                  className="aspect-[2/1] w-full rounded-xl object-cover bg-muted"
                  loading="lazy"
                  alt=""
                />
              )}

              {d.summary && <ClampedSummary key={activeId} text={d.summary} />}

              {d.type === "tv_show" && (
                <>
                  <ShowWatchCard key={d.mediaId} detail={d} onChanged={invalidateAfterMutation} />

                  {/* Cine l-a adus și cine l-a văzut, apoi episoadele; detaliile
                      tehnice la coadă. */}
                  <AudienceCard detail={d} watchedEpisodes={watchedEpisodes} />

                  <EpisodeList
                    key={d.mediaId}
                    episodes={d.episodes}
                    onOpen={(episodeId) => setOpenEpisode({ showId: mediaId!, episodeId })}
                  />
                </>
              )}

              {/* La serial, cardul stă deasupra sezoanelor (vezi mai sus). */}
              {d.type !== "tv_show" && (
                <AudienceCard detail={d} watchedEpisodes={watchedEpisodes} />
              )}

              {d.tech && (
                <TechDetails
                  tech={d.tech}
                  torrentHash={d.torrentHash}
                  open={showTech}
                  onToggle={() => setShowTech((v) => !v)}
                />
              )}

              {d.type !== "tv_show" && (
                <TitleActions
                  key={d.mediaId}
                  detail={d}
                  onChanged={invalidateAfterMutation}
                  onRequestDelete={onRequestDelete}
                />
              )}
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
