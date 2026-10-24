import { useState } from "react";
import {
  Loader2,
  HardDrive,
  Users,
  ArrowDownToLine,
  CalendarDays,
  Zap,
  BadgeCheck,
  Film,
  Tv,
  Languages,
} from "lucide-react";

import { formatBytes } from "@/lib/format";
import type { FilelistTorrent } from "@/lib/filelist.functions";
import { RO_DUBBED_CATEGORY } from "@/lib/filelist/categories";
import type { Quality } from "./types";

// ---------------------------------------------------------------------------
// Piese mici, fără stare proprie (cu excepția QualitySelector) — reutilizate
// în pașii wizard-ului.
// ---------------------------------------------------------------------------

const QUALITY_STYLES: Record<Quality, { active: string; inactive: string }> = {
  "720p": {
    active:
      "border-neutral-400/70 bg-neutral-500/30 text-neutral-200 shadow-sm shadow-neutral-500/30",
    inactive:
      "border-neutral-500/40 bg-neutral-500/10 text-neutral-400 hover:bg-neutral-500/20 hover:text-neutral-300",
  },
  "1080p": {
    active: "border-blue-400/70 bg-blue-500/30 text-blue-200 shadow-sm shadow-blue-500/30",
    inactive:
      "border-blue-500/40 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 hover:text-blue-300",
  },
  // Cyan, între albastrul lui 1080p și violetul lui 4K: aceeași rezoluție ca
  // 1080p, dar peste el.
  "1080p HDR": {
    active: "border-cyan-400/70 bg-cyan-500/30 text-cyan-200 shadow-sm shadow-cyan-500/30",
    inactive:
      "border-cyan-500/40 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 hover:text-cyan-300",
  },
  "4K": {
    active: "border-purple-400/70 bg-purple-500/30 text-purple-200 shadow-sm shadow-purple-500/30",
    inactive:
      "border-purple-500/40 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 hover:text-purple-300",
  },
  "4K HDR": {
    active: "border-amber-400/70 bg-amber-500/30 text-amber-200 shadow-sm shadow-amber-500/30",
    inactive:
      "border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 hover:text-amber-300",
  },
};

function QualityButton({
  q,
  active,
  onClick,
  className = "",
}: {
  q: Quality;
  active: boolean;
  onClick: () => void;
  className?: string;
}) {
  const style = active ? QUALITY_STYLES[q].active : QUALITY_STYLES[q].inactive;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-3 py-1.5 text-sm font-medium transition-colors active:scale-95 ${style} ${className}`}
    >
      {q}
    </button>
  );
}

const OTHER_QUALITIES: Quality[] = ["720p", "1080p HDR", "4K", "4K HDR"];

// Selectorul de calitate — 1080p implicit, pe același rând cu eticheta;
// celelalte calități stau sub „Vrei altă calitate?", ca ecranul să rămână
// curat în cazul comun. Schimbarea calității nu cere nimic de la server:
// torrentele titlului sunt deja aduse, doar se filtrează altfel.
//
// Deschiderea rămâne și când calitatea vine din altă parte (butoanele
// „Disponibil la"), altfel calitatea activă n-ar fi vizibilă nicăieri.
export function QualitySelector({
  quality,
  onChange,
}: {
  quality: Quality;
  onChange: (q: Quality) => void;
}) {
  const [opened, setOpened] = useState(false);
  const expanded = opened || quality !== "1080p";

  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Calitate
        </span>
        <QualityButton q="1080p" active={quality === "1080p"} onClick={() => onChange("1080p")} />
        {!expanded && (
          <button
            type="button"
            onClick={() => setOpened(true)}
            className="ml-auto text-[11px] text-muted-foreground underline decoration-dotted hover:text-foreground"
          >
            Vrei altă calitate?
          </button>
        )}
      </div>
      {expanded && (
        <div className="mt-2 flex flex-wrap gap-2">
          {OTHER_QUALITIES.map((q) => (
            <QualityButton
              key={q}
              q={q}
              active={quality === q}
              onClick={() => onChange(q)}
              className="flex-1"
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ActionButton({
  busy,
  icon,
  label,
  onClick,
}: {
  busy: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {label}
    </button>
  );
}

// Numele lansării nu spune că e dublată (ex. „Ferdinand.2017.1080p.WEBRip"),
// deci categoria se arată explicit oriunde alegi un torrent.
function DubbedBadge({ torrent }: { torrent: FilelistTorrent }) {
  if (torrent.category !== RO_DUBBED_CATEGORY) return null;
  return (
    <span className="inline-flex items-center gap-0.5 text-emerald-400">
      <Languages className="h-3 w-3" /> RO Dubbed
    </span>
  );
}

function uploadDate(t: FilelistTorrent): string | null {
  const d = t.upload_date ? new Date(t.upload_date) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("ro-RO", { day: "numeric", month: "short", year: "numeric" });
}

// Alegere manuală între torrente când sunt mai multe la aceeași calitate
// (admin) — nu se arată pentru un singur candidat, ca să nu aglomerăm pasul
// în cazul comun. Ordinea e cea din clasament (torrent-rank.ts); badge-urile
// arată criteriile lui.
export function TorrentPicker({
  matches,
  selectedId,
  onSelect,
}: {
  matches: FilelistTorrent[];
  selectedId: number;
  onSelect: (id: number) => void;
}) {
  if (matches.length <= 1) return null;
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Alege torrentul ({matches.length} disponibile)
      </div>
      <div className="max-h-56 space-y-1.5 overflow-y-auto pr-0.5">
        {matches.map((t) => {
          const date = uploadDate(t);
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(t.id)}
              className={`w-full rounded-lg border p-2 text-left transition-colors active:scale-[0.98] ${
                t.id === selectedId
                  ? "border-primary bg-primary/10"
                  : "border-border bg-muted/40 hover:bg-muted/60"
              }`}
            >
              <div className="break-all text-xs font-medium">{t.name}</div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-0.5">
                  <HardDrive className="h-3 w-3" /> {formatBytes(t.size)}
                </span>
                {date && (
                  <span className="flex items-center gap-0.5">
                    <CalendarDays className="h-3 w-3" /> {date}
                  </span>
                )}
                <span className="flex items-center gap-0.5 text-emerald-400">
                  <Users className="h-3 w-3" /> {t.seeders}S
                </span>
                <span className="flex items-center gap-0.5 text-orange-400">
                  <ArrowDownToLine className="h-3 w-3" /> {t.leechers}L
                </span>
                {t.internal && (
                  <span className="flex items-center gap-0.5 text-sky-400">
                    <BadgeCheck className="h-3 w-3" /> Internal
                  </span>
                )}
                {t.freeleech && (
                  <span className="flex items-center gap-0.5 text-yellow-400">
                    <Zap className="h-3 w-3" /> Freeleech
                  </span>
                )}
                <DubbedBadge torrent={t} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function PosterHero({
  posterUrl,
  mediaType,
  title,
  subtitle,
}: {
  posterUrl: string | null;
  mediaType: "movie" | "tv";
  title: string;
  subtitle: string;
}) {
  return (
    <div className="relative h-28 overflow-hidden rounded-2xl bg-muted/60">
      {posterUrl && (
        <img
          src={posterUrl}
          alt=""
          className="absolute inset-0 h-full w-full scale-110 object-cover opacity-30 blur-md"
        />
      )}
      <div className="relative flex h-full items-center gap-3 p-3">
        {posterUrl ? (
          <img
            src={posterUrl}
            alt=""
            className="h-full w-16 shrink-0 rounded-lg object-cover shadow-lg"
          />
        ) : (
          <div className="flex h-full w-16 shrink-0 items-center justify-center rounded-lg bg-muted">
            {mediaType === "movie" ? (
              <Film className="h-5 w-5 text-muted-foreground" />
            ) : (
              <Tv className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <span
            className={`mb-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${
              mediaType === "movie"
                ? "bg-amber-500/15 text-amber-400"
                : "bg-blue-500/15 text-blue-400"
            }`}
          >
            {mediaType === "movie" ? "Film" : "Serial"}
          </span>
          <div className="truncate text-base font-bold leading-tight">{title}</div>
          <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
        </div>
      </div>
    </div>
  );
}
