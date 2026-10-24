// Confirmarea descărcării unui singur torrent.

import { DownloadConfirmFields } from "@/components/filelist/DownloadConfirmDialog";
import type { FilelistTorrent } from "@/lib/filelist.functions";
import { detectTorrentQuality } from "@/lib/media/torrent-quality";
import { HdrQuestion } from "./WizardControls";
import { sdrVariantOf } from "./selection";
import type { Quality } from "./types";

export function ConfirmStep({
  torrent,
  label,
  busy,
  onCancel,
  onConfirm,
  onDeclineHdr,
}: {
  torrent: FilelistTorrent;
  label: string;
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
        actions={
          hdrQuality && sdrQuality ? (
            <HdrQuestion
              quality={hdrQuality}
              sdrQuality={sdrQuality}
              yesLabel="Da, descarcă"
              busy={busy}
              onYes={onConfirm}
              onNo={() => onDeclineHdr(sdrQuality)}
            />
          ) : undefined
        }
      />
    </div>
  );
}
