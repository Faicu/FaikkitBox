import { Bell, BellOff, Download } from "lucide-react";

import type { WatchSettings } from "@/lib/pinned.functions";

// ---------------------------------------------------------------------------
// Panoul de notificări watch (toggle-uri per tip)
// ---------------------------------------------------------------------------

export function WatchTogglePanel({
  mediaType,
  settings,
  isAdmin,
  onChange,
}: {
  mediaType: "movie" | "tv";
  settings: WatchSettings;
  isAdmin: boolean;
  onChange: (patch: Partial<WatchSettings>) => void;
}) {
  const anyEnabled = settings.watchFilelist || settings.watchTmdb || settings.watchPlex;
  const qualities: Array<"1080p" | "4K" | "4K HDR"> = ["1080p", "4K", "4K HDR"];

  function Toggle({
    toggleKey,
    label,
  }: {
    toggleKey: keyof Pick<
      WatchSettings,
      "watchFilelist" | "watchFilelistSeason" | "watchTmdb" | "watchPlex"
    >;
    label: string;
  }) {
    const on = settings[toggleKey] as boolean;
    return (
      <button
        onClick={() => onChange({ [toggleKey]: !on })}
        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
          on
            ? "bg-primary/15 border-primary/30 text-primary"
            : "bg-muted/40 border-border text-muted-foreground hover:text-foreground"
        }`}
      >
        {on ? <Bell className="h-3 w-3" /> : <BellOff className="h-3 w-3" />}
        {label}
      </button>
    );
  }

  return (
    <div className="border-t border-border pt-3 space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        {anyEnabled ? <Bell className="h-3 w-3 text-primary" /> : <BellOff className="h-3 w-3" />}
        Notificări automate · la fiecare 3 ore
      </div>

      {/* Rând 1: Filelist (admin) + TMDB + Plex */}
      <div className="flex flex-wrap gap-2">
        {isAdmin && <Toggle toggleKey="watchFilelist" label="Torrent nou Filelist" />}
        {mediaType === "tv" && <Toggle toggleKey="watchTmdb" label="Episod nou lansat" />}
        <Toggle
          toggleKey="watchPlex"
          label={mediaType === "tv" ? "Episod nou în Plex" : "Film adăugat în Plex"}
        />
      </div>

      {/* Rând 2: opțiuni Filelist (doar admin) */}
      {isAdmin && settings.watchFilelist && (
        <div className="flex flex-wrap gap-2 pl-3 border-l-2 border-primary/20">
          {mediaType === "tv" && (
            <Toggle toggleKey="watchFilelistSeason" label="Doar sezonul curent" />
          )}
          <button
            onClick={() => onChange({ autoDownload: !settings.autoDownload })}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
              settings.autoDownload
                ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                : "bg-muted/40 border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            <Download className="h-3 w-3" />
            Descarcă automat
          </button>
          {settings.autoDownload && (
            <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
              {qualities.map((q) => (
                <button
                  key={q}
                  onClick={() => onChange({ autoDownloadQuality: q })}
                  className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                    settings.autoDownloadQuality === q
                      ? "bg-emerald-500/25 text-emerald-400"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
