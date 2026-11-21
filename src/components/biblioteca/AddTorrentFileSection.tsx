import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronRight, FileUp } from "lucide-react";

import { adminStatusQuery } from "@/lib/queries";
import { addTorrentFile, type TorrentFileResult } from "@/lib/filelist/torrent-file.functions";
import { formatBytes } from "@/lib/format";
import { mediaLabel } from "@/lib/media/title-label";

const SOURCES = ["Filelist", "TorrentLeech", "Altceva"] as const;
const inputCls =
  "w-full rounded-lg bg-muted/40 px-2.5 py-2 text-xs outline-none focus:ring-1 focus:ring-primary";

type Preview = Extract<TorrentFileResult, { status: "preview" }>;

// Bytes → base64 prin FileReader: fără String.fromCharCode pe tot fișierul,
// care depășește stiva la torrentele mari.
function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

// Un .torrent luat de mână (alt tracker sau Filelist din browser) + IMDb ID;
// restul — TMDB, qBittorrent, urmărire, subtitrare, Plex — ca la o descărcare
// din aplicație. Doar admin; panou inline, nu dialog (vezi overlay-urile).
export function AddTorrentFileSection({ onAdded }: { onAdded: (mediaId: number) => void }) {
  const admin = useQuery(adminStatusQuery);
  const queryClient = useQueryClient();
  const addFn = useServerFn(addTorrentFile);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<{ name: string; base64: string } | null>(null);
  const [imdb, setImdb] = useState("");
  const [source, setSource] = useState<(typeof SOURCES)[number]>("TorrentLeech");
  const [otherSource, setOtherSource] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [season, setSeason] = useState("");
  const [episode, setEpisode] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const imdbId = /tt\d{7,}/.exec(imdb)?.[0] ?? null;

  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    if (!file || !imdbId) return;
    let cancelled = false;
    addFn({ data: { torrentBase64: file.base64, imdb: imdbId, source: "", dryRun: true } })
      .then((res) => {
        if (cancelled) return;
        if (res.status === "preview") setPreview(res);
        else if (res.status === "error") setPreviewError(res.error);
      })
      .catch((e) => !cancelled && setPreviewError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [file, imdbId, addFn]);

  if (!admin.data?.isAdmin) return null;

  async function pickFile(f: File | undefined) {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".torrent")) {
      toast.error("Alege un fișier .torrent");
      return;
    }
    setFile({ name: f.name, base64: await readBase64(f) });
  }

  function reset() {
    setFile(null);
    setImdb("");
    setSourceUrl("");
    setOtherSource("");
    setSeason("");
    setEpisode("");
  }

  const sourceName = source === "Altceva" ? otherSource.trim() : source;
  const canSubmit =
    !!preview &&
    preview.existingMediaId == null &&
    !!sourceName &&
    (!preview.needsSeason || season !== "") &&
    !busy;

  async function submit() {
    if (!file || !imdbId || !canSubmit) return;
    setBusy(true);
    try {
      const res = await addFn({
        data: {
          torrentBase64: file.base64,
          imdb: imdbId,
          source: sourceName,
          sourceUrl: sourceUrl.trim() || null,
          season: preview?.needsSeason ? Number(season) : null,
          episode: preview?.needsSeason && episode !== "" ? Number(episode) : null,
        },
      });
      if (res.status !== "ok") {
        toast.error("Nu am putut adăuga torrentul", {
          description: res.status === "error" ? res.error : undefined,
        });
        return;
      }
      toast.success("Trimis la qBittorrent", { description: res.torrentName });
      queryClient.invalidateQueries({ queryKey: ["plexLibraryBrowse"] });
      reset();
      setOpen(false);
      if (res.mediaId != null) onAdded(res.mediaId);
    } catch (e) {
      toast.error("Nu am putut adăuga torrentul", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl glass-card p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        <ChevronRight
          className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ${open ? "rotate-90" : ""}`}
        />
        <FileUp className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="flex-1 text-xs font-semibold">Adaugă din fișier .torrent</span>
      </button>

      {open && (
        <div className="animate-in fade-in-0 slide-in-from-top-1 duration-200 mt-2 space-y-2">
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              void pickFile(e.dataTransfer.files[0]);
            }}
            className={`flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed px-3 py-4 text-center text-xs transition-colors ${
              dragOver ? "border-primary bg-primary/10" : "border-border bg-muted/20"
            }`}
          >
            <FileUp className="h-4 w-4 text-muted-foreground" />
            <span className="wrap-anywhere">
              {file ? file.name : "Trage aici fișierul .torrent sau atinge ca să-l alegi"}
            </span>
            {/* Fără `accept`: Android nu cunoaște tipul .torrent și îl arată
                gri în selector. Extensia se verifică în pickFile. */}
            <input
              type="file"
              className="hidden"
              onChange={(e) => {
                void pickFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>

          <input
            value={imdb}
            onChange={(e) => setImdb(e.target.value)}
            placeholder="IMDb ID sau link (tt1793239)"
            className={inputCls}
          />

          {previewError && <div className="px-1 text-xs text-red-400">{previewError}</div>}
          {preview && (
            <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-2 py-1.5">
              {preview.posterPath && (
                <img
                  src={preview.posterPath}
                  alt=""
                  className="h-12 w-8 shrink-0 rounded object-cover"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold">
                  {mediaLabel({
                    title: preview.title,
                    year: preview.year,
                    season: preview.season,
                    episode: preview.episode,
                  })}
                </div>
                <div className="wrap-anywhere text-[10px] text-muted-foreground">
                  {preview.torrentName} · {formatBytes(preview.size)}
                </div>
                {preview.existingMediaId != null && (
                  <div className="text-[10px] text-amber-400">Torrentul e deja în bibliotecă</div>
                )}
              </div>
            </div>
          )}

          {preview?.needsSeason && (
            <div className="flex gap-2">
              <input
                value={season}
                onChange={(e) => setSeason(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                placeholder="Sezon"
                className={inputCls}
              />
              <input
                value={episode}
                onChange={(e) => setEpisode(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                placeholder="Episod (gol = sezon întreg)"
                className={inputCls}
              />
            </div>
          )}

          <div className="flex gap-2">
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as (typeof SOURCES)[number])}
              className={`${inputCls} w-auto shrink-0`}
            >
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {source === "Altceva" && (
              <input
                value={otherSource}
                onChange={(e) => setOtherSource(e.target.value)}
                placeholder="Numele sursei"
                className={inputCls}
              />
            )}
          </div>

          <input
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="Link de unde l-ai luat (opțional)"
            className={inputCls}
          />

          <button
            type="button"
            disabled={!canSubmit}
            onClick={submit}
            className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Se trimite…" : "Adaugă"}
          </button>
        </div>
      )}
    </div>
  );
}
