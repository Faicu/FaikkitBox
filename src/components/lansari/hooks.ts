import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { downloadFilelist } from "@/lib/filelist.functions";
import type { FilelistTorrent } from "@/lib/filelist.functions";

// ---------------------------------------------------------------------------
// Hook reutilizabil pentru descărcare torrent
// ---------------------------------------------------------------------------

export function useDownload() {
  const qc = useQueryClient();
  const downloadFn = useServerFn(downloadFilelist);
  const [downloading, setDownloading] = useState<number | null>(null);

  async function handleDownload(torrent: FilelistTorrent) {
    setDownloading(torrent.id);
    const toastId = toast.loading(`Se descarcă: ${torrent.name}…`);
    try {
      const res = await downloadFn({
        data: {
          torrentId: torrent.id,
          torrentName: torrent.name,
          categoryId: torrent.category,
          categoryName: torrent.categoryName,
          size: torrent.size,
          freeleech: torrent.freeleech,
          internal: torrent.internal,
        },
      });
      if (res.status === "ok") {
        toast.success("Adăugat în qBittorrent!", {
          id: toastId,
          description: `${torrent.name} → ${res.savePath}`,
          duration: 6000,
        });
        qc.invalidateQueries({ queryKey: ["filelistLog"] });
      } else {
        toast.error("Eroare la descărcare", {
          id: toastId,
          description: res.error,
          duration: 8000,
        });
      }
    } catch (e) {
      toast.error("Eroare neașteptată", {
        id: toastId,
        description: e instanceof Error ? e.message : String(e),
        duration: 8000,
      });
    } finally {
      setDownloading(null);
    }
  }

  return { downloading, handleDownload };
}

export function useCountdown(targetIso: string) {
  const [remaining, setRemaining] = useState(() => new Date(targetIso).getTime() - Date.now());
  useEffect(() => {
    const id = setInterval(() => setRemaining(new Date(targetIso).getTime() - Date.now()), 1000);
    return () => clearInterval(id);
  }, [targetIso]);
  return remaining;
}
