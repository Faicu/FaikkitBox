import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Film } from "lucide-react";

import { wantedMoviesQuery } from "@/lib/queries";
import { relativeTime } from "@/components/tehnic/utils";
import { Orb } from "@/components/ui/orb";
import { WantedMovieDrawer } from "./WantedMovieDrawer";

// Filmele pe care le aștepți: urmărire pornită, dar încă negăsite pe Filelist
// la calitatea cerută.
//
// Secțiune separată, deasupra listei, nu rânduri amestecate printre titluri:
// un film așteptat nu e ceva ce ai, iar strecurat în „Recent adăugate" ar face
// lista să promită fișiere care nu există. Aici e vizibil, dar clar despărțit.
//
// Dispare complet când e goală, ca să nu ocupe spațiu cu „Se așteaptă (0)".
export function WantedMoviesSection() {
  const wanted = useQuery(wantedMoviesQuery);
  const [open, setOpen] = useState(true);
  const [selectedMediaId, setSelectedMediaId] = useState<number | null>(null);

  const items = wanted.data ?? [];
  if (items.length === 0) return null;

  return (
    <>
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
            {/* Rândul e o singură țintă de atins, care deschide drawer-ul —
                acțiunile stau acolo. Înainte erau trei butoane înghesuite pe
                câțiva milimetri de ecran de telefon. */}
            {items.map((m) => (
              <button
                key={m.mediaId}
                type="button"
                onClick={() => setSelectedMediaId(m.mediaId)}
                className="flex w-full items-center gap-2 rounded-lg bg-muted/40 px-2 py-1.5 text-left transition-all hover:bg-muted/60 active:scale-[0.99] active:bg-muted"
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
              </button>
            ))}
          </div>
        )}
      </div>

      <WantedMovieDrawer mediaId={selectedMediaId} onClose={() => setSelectedMediaId(null)} />
    </>
  );
}

// Timestamp-ul e scris cu datetime('now'), care în SQLite e UTC — de-aia "Z"
// la final, ca în restul proiectului. Fără el, ora ar fi citită ca locală și
// un film verificat chiar acum ar apărea „acum 3h" (România e UTC+3 vara).
function lastCheckLabel(raw: string | null): string {
  // „Neverificat încă" era adevărat, dar suna a urmărire moartă: nu spunea că
  // urmează ceva. Prima verificare vine la un minut după adăugare.
  if (!raw) return "prima verificare în curând";
  return `verificat ${relativeTime(`${raw.replace(" ", "T")}Z`)}`;
}
