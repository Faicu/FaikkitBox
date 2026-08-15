import { Loader2, HardDrive, Users, Zap, Pin, Film, Tv } from "lucide-react";

import { formatBytes } from "@/lib/format";
import type { FilelistTorrent } from "@/lib/filelist.functions";
import type { WatchQuality } from "@/lib/pinned.functions";

// ---------------------------------------------------------------------------
// Piese mici, fără stare proprie — reutilizate în pașii wizard-ului
// (AddMediaWizard.tsx).
// ---------------------------------------------------------------------------

export function ScopeOption({
  icon,
  label,
  description,
  meta,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  meta?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors active:scale-[0.98] ${
        active ? "border-primary bg-primary/10" : "border-border bg-muted/40 hover:bg-muted/60"
      }`}
    >
      <span className={active ? "text-primary" : "text-muted-foreground"}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      {meta && (
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {meta}
        </span>
      )}
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
        Fixează {label} pentru monitorizare automată ({quality})
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
