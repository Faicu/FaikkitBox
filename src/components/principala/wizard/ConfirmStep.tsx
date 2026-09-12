// Confirmarea descărcării unui singur torrent.

import { DownloadConfirmFields } from "@/components/filelist/DownloadConfirmDialog";
import type { FilelistTorrent } from "@/lib/filelist.functions";

export function ConfirmStep({
  torrent,
  label,
  onCancel,
  onConfirm,
}: {
  torrent: FilelistTorrent;
  label: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
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
      />
    </div>
  );
}
