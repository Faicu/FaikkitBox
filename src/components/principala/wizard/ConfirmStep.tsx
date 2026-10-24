// Confirmarea descărcării unui singur torrent.
//
// Adminul vede lansarea cu toate detaliile tehnice (nume, mărime, seederi,
// categorie, link Filelist); ceilalți doar un nume curat — titlu, an,
// sezon/episod și calitate —, fiindcă pentru ei detaliile alea sunt zgomot.

import { Download } from "lucide-react";

import { DownloadConfirmFields } from "@/components/filelist/DownloadConfirmDialog";
import type { FilelistTorrent } from "@/lib/filelist.functions";
import { detectTorrentQuality } from "@/lib/media/torrent-quality";
import { HdrQuestion } from "./WizardControls";
import { friendlyReleaseName, sdrVariantOf } from "./selection";
import type { Quality } from "./types";

export function ConfirmStep({
  torrent,
  label,
  isAdmin,
  title,
  originalTitle,
  year,
  season,
  episode,
  isSeasonPack,
  busy,
  onCancel,
  onConfirm,
  onDeclineHdr,
}: {
  torrent: FilelistTorrent;
  label: string;
  isAdmin: boolean;
  // Titlul în română (TMDB) și cel original — numele curat e construit din
  // cel original, iar cel românesc apare dedesubt când diferă.
  title: string;
  originalTitle: string;
  year: string | null;
  season?: number;
  episode?: number;
  isSeasonPack: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onDeclineHdr: (sdrQuality: Quality) => void;
}) {
  // Calitatea se citește din torrent, nu din selector: aceeași întrebare
  // trebuie să apară indiferent pe ce drum s-a ajuns la un fișier HDR.
  const detected = detectTorrentQuality(torrent.name);
  const hdrQuality = detected === "1080p HDR" || detected === "4K HDR" ? detected : null;
  const sdrQuality = hdrQuality && sdrVariantOf(hdrQuality);

  const hdrQuestion =
    hdrQuality && sdrQuality ? (
      <HdrQuestion
        quality={hdrQuality}
        sdrQuality={sdrQuality}
        yesLabel="Da, descarcă"
        busy={busy}
        onYes={onConfirm}
        onNo={() => onDeclineHdr(sdrQuality)}
      />
    ) : null;

  if (!isAdmin) {
    const name = friendlyReleaseName({
      originalTitle,
      year,
      quality: detected,
      season,
      episode,
      isSeasonPack,
    });
    const showRoTitle = title.trim().toLowerCase() !== originalTitle.trim().toLowerCase();
    return (
      <div className="animate-in fade-in slide-in-from-right-2 duration-200 space-y-4">
        <div className="text-sm font-semibold">Confirmare descărcare</div>
        <div className="space-y-0.5">
          <div className="break-words text-sm font-medium">{name}</div>
          {showRoTitle && <div className="text-xs text-muted-foreground">{title}</div>}
        </div>
        {hdrQuestion ?? (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              className="flex-1 rounded-xl border border-border py-2 text-sm text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40"
            >
              Anulează
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onConfirm}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-blue-500/30 bg-blue-500/20 py-2 text-sm font-medium text-blue-400 transition-colors hover:bg-blue-500/30 disabled:opacity-40"
            >
              <Download className="h-4 w-4" /> Descarcă
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="animate-in fade-in slide-in-from-right-2 duration-200 space-y-4">
      <div className="text-sm font-semibold">Confirmare descărcare</div>
      <DownloadConfirmFields
        torrent={torrent}
        label={label}
        // Wizard-ul trimite mereu metadatele TMDB proprii (buildMediaPayload),
        // deci legarea manuală de un titlu existent n-ar avea ce influența —
        // ascunsă, ca să nu fie un control care pare că face ceva și e ignorat
        // în tăcere.
        allowLinking={false}
        onCancel={onCancel}
        onConfirm={onConfirm}
        actions={hdrQuestion ?? undefined}
      />
    </div>
  );
}
