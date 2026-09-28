import { useState } from "react";
import { ChevronRight, CircleDashed, Eye, EyeOff, Tv } from "lucide-react";

import type { ShowEpisodeEntry } from "@/lib/services/plex-browse";
import { formatMs } from "@/lib/format";
import { airDateShort, displayEpisodeTitle, groupBySeason, stillThumb } from "./utils";

// Lista de episoade din drawer-ul unui serial, pe sezoane.
//
// Rândurile erau înainte doar cod + nume, la 11px, iar lista stătea la fundul
// drawer-ului, sub panoul de urmărire — pe telefon, episoadele se vedeau
// greu. Acum: miniatura cadrului, numele la mărime normală, data difuzării și
// durata, iar lista urcă imediat sub descriere (vezi TitleDetailDrawer).
//
// Cel mai nou sezon primul și singurul deschis; celelalte se deschid la
// atingere. Componenta se montează din nou pentru fiecare serial (key în
// drawer), deci starea sezoanelor deschise nu trece de la un serial la altul.
export function EpisodeList({
  episodes,
  onOpen,
}: {
  episodes: ShowEpisodeEntry[];
  onOpen: (episodeId: number) => void;
}) {
  const groups = groupBySeason(episodes);
  const collapsible = groups.length > 1;
  const [open, setOpen] = useState<Set<number | null>>(
    () => new Set(groups.length > 0 ? [groups[0].season] : []),
  );

  function toggle(season: number | null) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(season)) next.delete(season);
      else next.add(season);
      return next;
    });
  }

  return (
    <div className="space-y-2">
      {groups.map((group) => {
        const isOpen = !collapsible || open.has(group.season);
        const watched = group.episodes.filter((e) => e.watchedByMe).length;
        const n = group.episodes.length;
        return (
          <div key={group.season ?? "x"}>
            <button
              type="button"
              onClick={() => collapsible && toggle(group.season)}
              className={`flex w-full items-baseline gap-2 py-1 text-left ${collapsible ? "" : "cursor-default"}`}
            >
              <span className="text-sm font-semibold text-foreground">
                {group.season != null ? `Sezonul ${group.season}` : "Fără sezon"}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {n === 1 ? (watched ? "văzut" : "nevăzut") : `${watched} din ${n} văzute`}
              </span>
              {collapsible && (
                <ChevronRight
                  className={`ml-auto h-4 w-4 self-center text-muted-foreground transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
                />
              )}
            </button>
            {isOpen && (
              <div className="mt-1 space-y-1.5 stagger-in">
                {group.episodes.map((ep) => (
                  <EpisodeRow key={ep.mediaId} ep={ep} onOpen={() => onOpen(ep.mediaId)} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function EpisodeRow({ ep, onOpen }: { ep: ShowEpisodeEntry; onOpen: () => void }) {
  const title = displayEpisodeTitle(ep.episodeTitle);
  const thumb = stillThumb(ep.stillUrl);
  const meta = [airDateShort(ep.airDate), ep.durationMs ? formatMs(ep.durationMs) : null].filter(
    Boolean,
  );

  // Un pachet de sezon încă neterminat e un singur rând cu episode NULL — se
  // desface în episoade abia după ce Plex îl indexează.
  const label =
    ep.episode != null
      ? title
        ? `E${ep.episode} · ${title}`
        : `Episodul ${ep.episode}`
      : ep.isSeasonPack
        ? "Pachet complet"
        : "—";

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-xl bg-muted/40 p-2 text-left transition-all hover:bg-muted/60 active:scale-[0.99]"
    >
      <div className="relative aspect-video w-[88px] shrink-0 overflow-hidden rounded-lg bg-muted">
        {thumb ? (
          <img src={thumb} className="h-full w-full object-cover" loading="lazy" alt="" />
        ) : (
          <Tv className="absolute inset-0 m-auto h-5 w-5 text-muted-foreground/60" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-[13px] font-medium leading-snug text-foreground">
          {label}
        </div>
        {meta.length > 0 && (
          <div className="mt-0.5 text-[11px] text-muted-foreground">{meta.join(" · ")}</div>
        )}
      </div>
      {/* Starea, în dreapta: văzut / nevăzut odată ajuns în Plex; până atunci
          procentul, cât timp torrentul chiar se descarcă ("processing" =
          terminat, aștepți doar indexarea Plex). */}
      <div className="flex shrink-0 items-center gap-1 pr-1">
        {ep.status === "in_library" ? (
          ep.watchedByMe ? (
            <Eye className="h-4 w-4 text-emerald-400" />
          ) : (
            <EyeOff className="h-4 w-4 text-muted-foreground" />
          )
        ) : (
          <>
            {ep.status === "downloading" && ep.progress != null && (
              <span className="text-[11px] font-medium tabular-nums text-blue-400">
                {ep.progress.toFixed(0)}%
              </span>
            )}
            <CircleDashed className="h-4 w-4 animate-pulse text-blue-400" />
          </>
        )}
      </div>
    </button>
  );
}
