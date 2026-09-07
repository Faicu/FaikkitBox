import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Film, X } from "lucide-react";

import { wantedMoviesQuery, adminStatusQuery } from "@/lib/queries";
import { setMovieWatch, checkMovieNow } from "@/lib/media/media.functions";
import { Orb } from "@/components/ui/orb";

// Filmele pe care le aștepți: urmărire pornită, dar încă negăsite pe Filelist
// la calitatea cerută.
//
// Secțiune separată, deasupra listei, nu rânduri amestecate printre titluri:
// un film așteptat nu e ceva ce ai, iar strecurat în „Recent adăugate" ar face
// lista să promită fișiere care nu există. Aici e vizibil, dar clar despărțit.
//
// Pliată implicit când e goală — dispare complet, ca să nu ocupe spațiu cu
// „Se așteaptă (0)".
export function WantedMoviesSection() {
  const queryClient = useQueryClient();
  const wanted = useQuery(wantedMoviesQuery);
  // Lista se vede de oricine e logat, dar pornirea/oprirea urmăririi și
  // verificarea la cerere sunt acțiuni de admin pe server (setMovieWatch /
  // checkMovieNow). Fără gardă aici, un utilizator obișnuit ar vedea butoane
  // care întorc 401 — mai bine să nu existe decât să pară stricate.
  const { data: adminData } = useQuery(adminStatusQuery);
  const isAdmin = !!adminData?.isAdmin;
  const [open, setOpen] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const setMovieWatchFn = useServerFn(setMovieWatch);
  const checkNowFn = useServerFn(checkMovieNow);

  const items = wanted.data ?? [];
  if (items.length === 0) return null;

  async function stopWatch(tmdbId: number | null, mediaId: number, title: string) {
    if (tmdbId == null) return;
    setBusyId(mediaId);
    try {
      const res = await setMovieWatchFn({ data: { tmdbId, enabled: false } }).catch((e) => ({
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      }));
      if (!res.ok) {
        toast.error("Nu am putut opri urmărirea", { description: res.error });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["wanted-movies"] });
      toast.success(`Nu mai aștepți „${title}”`);
    } finally {
      setBusyId(null);
    }
  }

  // "Verifică acum" sare peste cadența de 12 ore. Fără el, singurul răspuns la
  // „de ce n-a apărut?" ar fi „mai așteaptă".
  async function checkNow(mediaId: number, title: string) {
    setBusyId(mediaId);
    try {
      const res = await checkNowFn({ data: { mediaId } }).catch((e) => ({
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      }));
      if (!res.ok) {
        toast.error("Verificarea a eșuat", { description: res.error });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["wanted-movies"] });
      queryClient.invalidateQueries({ queryKey: ["plexLibraryBrowse"] });
      if (res.outcome.downloaded) {
        toast.success(`„${title}” a apărut — descărcare pornită`);
      } else {
        toast.info(`„${title}”: ${res.outcome.skipped ?? "încă nimic"}`);
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="rounded-2xl glass-card p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <Orb state="searching" px={14} />
        <span className="flex-1 text-xs font-semibold">Se așteaptă ({items.length})</span>
      </button>

      {open && (
        <div className="mt-2 space-y-1.5 stagger-in">
          {items.map((m) => (
            <div
              key={m.mediaId}
              className="flex items-center gap-2 rounded-lg bg-muted/40 px-2 py-1.5"
            >
              {m.posterPath ? (
                <img
                  src={m.posterPath}
                  className="h-8 w-8 shrink-0 rounded bg-muted object-cover"
                  loading="lazy"
                  alt=""
                />
              ) : (
                <Film className="h-3.5 w-3.5 shrink-0 text-amber-400" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs">
                  {m.title}
                  {m.year ? ` (${m.year})` : ""}
                </span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {m.quality} · {lastCheckLabel(m.lastCheckedAt)}
                </span>
              </span>
              {isAdmin && (
                <>
                  <button
                    type="button"
                    disabled={busyId === m.mediaId}
                    onClick={() => checkNow(m.mediaId, m.title)}
                    className="shrink-0 rounded-lg border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 disabled:opacity-40"
                  >
                    Verifică
                  </button>
                  <button
                    type="button"
                    title="Nu mai aștepta filmul"
                    disabled={busyId === m.mediaId}
                    onClick={() => stopWatch(m.tmdbId, m.mediaId, m.title)}
                    className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-40"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Timestamp-ul e în formatul SQLite ("2026-09-07 16:30:00"), fără fus. E ora
// serverului, adică ora României — de-aia se citește direct, fără conversie.
function lastCheckLabel(raw: string | null): string {
  if (!raw) return "neverificat încă";
  const when = new Date(raw.replace(" ", "T"));
  if (Number.isNaN(when.getTime())) return "neverificat încă";
  const mins = Math.round((Date.now() - when.getTime()) / 60_000);
  if (mins < 1) return "verificat acum";
  if (mins < 60) return `verificat acum ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `verificat acum ${hours}h`;
  return `verificat acum ${Math.round(hours / 24)} zile`;
}
