import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CalendarClock, CaptionsOff, CheckCheck, Search } from "lucide-react";

import type { PlexTitleDetail } from "@/lib/services/plex-title-detail";
import { sqliteUtcMs } from "@/lib/format";
import { lastCheckedLabel, nextEpisodeWhen } from "./utils";

// Descrierea, la trei rânduri; „mai mult” doar dacă a tăiat ceva (măsurat
// după randare).
export function ClampedSummary({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !expanded) setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [text, expanded]);
  return (
    <div className="text-xs text-muted-foreground leading-relaxed">
      <div ref={ref} className={expanded ? "" : "line-clamp-3"}>
        {text}
      </div>
      {(clamped || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 font-medium text-foreground/80 hover:text-foreground transition-colors"
        >
          {expanded ? "mai puțin" : "mai mult"}
        </button>
      )}
    </div>
  );
}

// Rândul „Urmează…” din cardul urmăririi; `trailing` = calitatea, în dreapta.
export function NextEpisodeLine({
  detail,
  trailing,
}: {
  detail: PlexTitleDetail;
  trailing?: ReactNode;
}) {
  const when = nextEpisodeWhen(detail.nextEpisodeAirDate, detail.nextEpisodeAirstamp);

  let content: ReactNode;
  if (detail.tvStatus === "Ended" && !when) {
    // Serial încheiat — spus explicit, nu un gol care pare „încă nu știm”.
    content = (
      <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
        <CheckCheck className="h-3.5 w-3.5 shrink-0" />
        Serial încheiat — nu mai urmează episoade
      </span>
    );
  } else if (!when || !detail.nextEpisode) {
    content = (
      <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
        <CalendarClock className="h-3.5 w-3.5 shrink-0" />
        Niciun episod nou anunțat încă
      </span>
    );
  } else {
    // „Curând” (azi – poimâine) iese în evidență: fundal colorat.
    content = (
      <span
        className={`flex min-w-0 items-center gap-2 ${
          when.soon
            ? "-mx-1 rounded-lg bg-primary/10 px-1 py-1 text-foreground"
            : "text-muted-foreground"
        }`}
      >
        <CalendarClock
          className={`h-3.5 w-3.5 shrink-0 ${when.soon ? "animate-pulse text-primary" : ""}`}
        />
        <span>
          Urmează <span className="font-medium text-foreground">{detail.nextEpisode}</span> ·{" "}
          {when.text}
        </span>
      </span>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      {content}
      {trailing}
    </div>
  );
}

// Data în formatul SQLite (UTC) → „22 oct.".
function retryDay(v: string): string {
  return new Date(sqliteUtcMs(v)).toLocaleDateString("ro-RO", {
    day: "numeric",
    month: "short",
  });
}

export function SubtitleRetryLine({
  retry,
}: {
  retry: NonNullable<PlexTitleDetail["subtitleRetry"]>;
}) {
  if (retry.state === "ended") {
    return (
      <div className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
        <CaptionsOff className="mt-px h-3 w-3 shrink-0" />
        <span>
          {retry.kind === "approximate"
            ? "Căutarea automată a unei subtitrări mai bune"
            : "Căutarea automată a subtitrării"}{" "}
          s-a încheiat pe {retryDay(retry.until)} — poți încerca din nou cu „Corectează subtitrare”.
        </span>
      </div>
    );
  }
  // Același format ca „Verificat azi, 20:54" de la urmărirea serialelor.
  const checked = retry.lastCheckedAt
    ? ` · ${lastCheckedLabel(retry.lastCheckedAt).toLowerCase()}`
    : "";
  return (
    <div
      className={`flex items-start gap-1.5 text-[11px] leading-snug ${
        retry.kind === "approximate" ? "text-amber-400/90" : "text-teal-400/90"
      }`}
    >
      <Search className="mt-px h-3 w-3 shrink-0" />
      <span>
        {retry.kind === "approximate"
          ? "Se caută zilnic o subtitrare mai bună"
          : "Se caută zilnic subtitrare RO"}
        , până pe {retryDay(retry.until)}
        <span className="text-muted-foreground">{checked}</span>
      </span>
    </div>
  );
}
