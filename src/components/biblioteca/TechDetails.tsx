import { ChevronRight, Wrench } from "lucide-react";

import type { PlexTitleDetail } from "@/lib/services/plex-title-detail";
import { formatBytes, sqliteUtcMs } from "@/lib/format";
import { subtitleSourceDisplay } from "@/lib/filelist/subtitle-outcomes";
import { FileReport } from "@/components/tehnic/SubtitleFixDrawer";
import { addedDate } from "./utils";

const sqliteDay = (v: string) => addedDate(Math.floor(sqliteUtcMs(v) / 1000));

// „Detalii tehnice” din fișa titlului — doar pentru admin (`tech` e null altfel).
// Starea deschis/închis stă în drawer: rămâne la trecerea serial → episod.
export function TechDetails({
  tech,
  torrentHash,
  open,
  onToggle,
}: {
  tech: NonNullable<PlexTitleDetail["tech"]>;
  torrentHash: string | null;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1 py-1 text-muted-foreground hover:text-foreground transition-colors"
      >
        <Wrench className="h-3.5 w-3.5" /> Detalii tehnice
        <ChevronRight
          className={`h-3.5 w-3.5 ml-auto transition-transform duration-200 ${open ? "rotate-90" : ""}`}
        />
      </button>
      {open && (
        <div className="animate-in fade-in-0 slide-in-from-top-1 duration-200 flex flex-col gap-1 rounded-lg bg-muted/40 px-2 py-1.5">
          {[
            tech.torrentName && ["Torrent", tech.torrentName],
            tech.sizeBytes > 0 && ["Mărime", formatBytes(tech.sizeBytes)],
            tech.categoryName && ["Categorie", tech.categoryName],
            (tech.freeleech || tech.internal) && [
              "Steaguri",
              [tech.freeleech && "freeleech", tech.internal && "internal"]
                .filter(Boolean)
                .join(", "),
            ],
            tech.savePath && ["Cale disk", tech.savePath],
            tech.addedVia && ["Adăugat via", tech.addedVia],
            tech.completedAt && ["Finalizat", sqliteDay(tech.completedAt)],
            // Cu raport structurat, sursa și detaliul sunt mai jos.
            !tech.subtitleReport &&
              tech.subtitleSource && [
                "Sursă subtitrare",
                subtitleSourceDisplay(tech.subtitleSource),
              ],
            !tech.subtitleReport &&
              tech.subtitleDetail && ["Detaliu subtitrare", tech.subtitleDetail],
            tech.subtitleCheckedAt && ["Subtitrare verificată", sqliteDay(tech.subtitleCheckedAt)],
            tech.plexRatingKey && ["Plex ratingKey", tech.plexRatingKey],
            tech.imdbId && ["IMDb", tech.imdbId],
            torrentHash && ["Torrent hash", torrentHash],
          ]
            .filter((row): row is [string, string] => !!row)
            // Valorile lungi (detaliul subtitrării, torrentul) trec sub
            // etichetă, pe toată lățimea, aliniate la stânga;
            // `wrap-anywhere` rupe și șirurile fără spații.
            .map(([label, value]) =>
              value.length > 40 ? (
                <div key={label} className="flex flex-col gap-0.5">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="wrap-anywhere text-foreground">{value}</span>
                </div>
              ) : (
                <div key={label} className="flex justify-between gap-3">
                  <span className="shrink-0 text-muted-foreground">{label}</span>
                  <span className="min-w-0 wrap-anywhere text-right text-foreground">{value}</span>
                </div>
              ),
            )}
          {tech.subtitleReport && (
            <div className="mt-1 flex flex-col gap-1.5 border-t border-border/60 pt-1.5">
              <span className="text-muted-foreground">Subtitrare</span>
              <FileReport
                file={tech.subtitleReport.file}
                rejected={tech.subtitleReport.rejected}
                showEpisode={false}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
