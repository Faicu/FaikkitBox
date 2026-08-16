import { useState } from "react";
import { Loader2, HardDrive, Users, Zap, Pin, Film, Tv } from "lucide-react";

import { formatBytes } from "@/lib/format";
import type { FilelistTorrent } from "@/lib/filelist.functions";
import type { WatchQuality } from "@/lib/pinned.functions";

// ---------------------------------------------------------------------------
// Piese mici, fără stare proprie (cu excepția QualitySelector) — reutilizate
// în pașii wizard-ului (AddMediaWizard.tsx).
// ---------------------------------------------------------------------------

const QUALITY_STYLES: Record<WatchQuality, { active: string; inactive: string }> = {
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
}: {
  q: WatchQuality;
  active: boolean;
  onClick: () => void;
}) {
  const style = active ? QUALITY_STYLES[q].active : QUALITY_STYLES[q].inactive;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-xl border px-3 py-1.5 text-sm font-medium transition-colors active:scale-95 ${style}`}
    >
      {q}
    </button>
  );
}

// Selectorul de calitate — utilizatorii obișnuiți descarcă mereu la 1080p
// (nici nu văd selectorul); doar admin poate alege altă calitate, ascunsă
// inițial sub un toggle mic, ca ecranul să rămână curat în cazul comun.
export function QualitySelector({
  quality,
  onChange,
  isAdmin,
}: {
  quality: WatchQuality;
  onChange: (q: WatchQuality) => void;
  isAdmin: boolean;
}) {
  const [expanded, setExpanded] = useState(quality !== "1080p");
  if (!isAdmin) return null;

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Calitate
        </span>
        {!expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-[11px] text-muted-foreground underline decoration-dotted hover:text-foreground"
          >
            Vrei altă calitate?
          </button>
        )}
      </div>
      <div className="flex gap-2">
        <QualityButton q="1080p" active={quality === "1080p"} onClick={() => onChange("1080p")} />
      </div>
      {expanded && (
        <div className="mt-2 flex gap-2">
          <QualityButton q="720p" active={quality === "720p"} onClick={() => onChange("720p")} />
          <QualityButton q="4K" active={quality === "4K"} onClick={() => onChange("4K")} />
          <QualityButton
            q="4K HDR"
            active={quality === "4K HDR"}
            onClick={() => onChange("4K HDR")}
          />
        </div>
      )}
    </div>
  );
}

// Butonul de fixare — doar adaugă titlul în Bibliotecă și pornește
// verificarea periodică pe Filelist (notificare la ceva nou), FĂRĂ
// descărcare automată — aceea rămâne o opțiune separată, activabilă din
// panoul de fixare al Bibliotecii. Vizual: iconiță într-un cerc colorat +
// etichetă, plus stare distinctă când titlul e deja urmărit (idempotent —
// poate fi apăsat oricum, doar readuce claritate).
export function WatchButton({
  busy,
  alreadyWatching,
  onClick,
}: {
  busy: boolean;
  alreadyWatching: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl border border-sky-500/30 bg-sky-500/10 p-3 text-left transition-colors hover:bg-sky-500/15 disabled:opacity-50"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-sky-400">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pin className="h-4 w-4" />}
      </span>
      <span className="text-sm font-semibold text-foreground">
        {alreadyWatching ? "Urmărești deja" : "Urmărește"}
      </span>
    </button>
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

// Alegere manuală între torrente când sunt mai multe la aceeași calitate
// (grupuri de release diferite etc) — nu se arată dacă e un singur candidat,
// ca să nu aglomerăm pasul final degeaba în cazul comun.
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
        {matches.map((t) => (
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
              <span className="flex items-center gap-0.5 text-emerald-400">
                <Users className="h-3 w-3" /> {t.seeders}S
              </span>
              {t.freeleech && (
                <span className="flex items-center gap-0.5 text-yellow-400">
                  <Zap className="h-3 w-3" /> Freeleech
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export function NotFoundWithPin({
  quality,
  busy,
  onPin,
  label,
}: {
  quality: WatchQuality;
  busy: boolean;
  onPin: () => void;
  label: "filmul" | "serialul";
}) {
  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">
        Nu există încă la calitatea {quality} pe Filelist.
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={onPin}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-muted/40 py-2.5 text-sm font-semibold text-foreground hover:bg-muted/60 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pin className="h-4 w-4" />}
        Fixează {label} — vei fi anunțat dacă apare pe Filelist
      </button>
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
