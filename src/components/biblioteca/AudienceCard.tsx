import { useState } from "react";
import { Eye, EyeOff, User, Users } from "lucide-react";

import type { PlexTitleDetail } from "@/lib/services/plex-title-detail";
import { dayTimeLabel } from "./utils";

// Cine l-a adus și cine l-a văzut, într-un card. Date scurte („28 sept.,
// 21:40”) — cele lungi rupeau rândurile pe telefon. Primii trei spectatori la
// vedere, restul la „încă N”.
const OTHERS_VISIBLE = 3;

export function AudienceCard({
  detail: d,
  watchedEpisodes,
}: {
  detail: PlexTitleDetail;
  watchedEpisodes: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const others = showAll ? d.watchedByOthers : d.watchedByOthers.slice(0, OTHERS_VISIBLE);
  const hidden = d.watchedByOthers.length - others.length;

  return (
    <div className="rounded-xl border border-border/60 bg-muted/30 divide-y divide-border/50 text-xs">
      <InfoRow icon={<User className="h-3.5 w-3.5" />} label="Adăugat">
        <span className="font-medium">{d.addedByUsername ?? "necunoscut"}</span>
        <span className="text-muted-foreground"> · {dayTimeLabel(d.addedAt)}</span>
      </InfoRow>
      {/* Bara stă în același rând cu „Tu”, nu separată de linie. */}
      <div>
        <InfoRow
          icon={
            d.watchedByMe ? (
              <Eye className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <EyeOff className="h-3.5 w-3.5" />
            )
          }
          label="Tu"
        >
          {d.type === "tv_show"
            ? // Pentru un serial, "văzut" n-ar spune nimic util — un episod
              // din 36 e tot "văzut".
              `${watchedEpisodes} din ${d.episodes.length} episoade`
            : d.watchedByMe
              ? d.watchedByMeAt
                ? `văzut ${dayTimeLabel(d.watchedByMeAt)}`
                : "văzut"
              : "nevăzut"}
        </InfoRow>
        {d.type === "tv_show" && d.episodes.length > 0 && (
          <div className="px-3 pb-2.5">
            <div className="h-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-emerald-400/80"
                style={{ width: `${(watchedEpisodes / d.episodes.length) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>
      {d.watchedByOthers.length === 0 ? (
        <InfoRow icon={<Users className="h-3.5 w-3.5" />} label="Alții">
          <span className="text-muted-foreground">nimeni încă</span>
        </InfoRow>
      ) : (
        <div className="px-3 py-2">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            Au mai văzut
            <span className="text-[10px]">({d.watchedByOthers.length})</span>
          </div>
          <div className="mt-1.5 space-y-1 pl-5">
            {others.map((u) => (
              <div key={u.username} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-medium">{u.username}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {u.lastEpisode && (
                    <>
                      <span className="font-medium text-foreground/80">{u.lastEpisode}</span>
                      {` · ${u.episodesWatched} din ${d.episodes.length} · `}
                    </>
                  )}
                  {dayTimeLabel(u.viewedAt)}
                </span>
              </div>
            ))}
            {(hidden > 0 || showAll) && d.watchedByOthers.length > OTHERS_VISIBLE && (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="text-[11px] font-medium text-foreground/80 transition-colors hover:text-foreground"
              >
                {showAll ? "mai puțin" : `încă ${hidden}`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function InfoRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-3 py-2">
      <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="min-w-0 text-right text-foreground">{children}</span>
    </div>
  );
}
