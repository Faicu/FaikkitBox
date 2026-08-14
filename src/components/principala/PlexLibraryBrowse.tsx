import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Film, Tv, Library, Eye, EyeOff, Captions, Clock3, Users } from "lucide-react";

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { plexLibraryBrowseQuery } from "@/lib/queries";
import { getPlexTitleDetail } from "@/lib/services.functions";
import { formatMs } from "@/lib/format";
import { formatDateTime } from "@/components/tehnic/utils";
import type { PlexBrowseItem } from "@/lib/services/plex-browse";

const PAGE_SIZE = 10;

function itemLabel(item: PlexBrowseItem): string {
  if (item.type === "movie") return item.title;
  const seasonEp =
    item.season != null && item.episode != null
      ? `S${String(item.season).padStart(2, "0")}E${String(item.episode).padStart(2, "0")}`
      : null;
  return `${item.show ?? "—"}${seasonEp ? ` — ${seasonEp}` : ""}${item.title ? ` · ${item.title}` : ""}`;
}

// addedAt e unix timestamp în secunde (convenția Plex) — formatDateTime
// lucrează cu ISO, de-aia conversia
function addedDate(unixSec: number): string {
  if (!unixSec) return "—";
  return formatDateTime(new Date(unixSec * 1000).toISOString());
}

export function PlexLibraryBrowse() {
  const browse = useQuery(plexLibraryBrowseQuery);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ["plexTitleDetail", selectedKey],
    queryFn: () => getPlexTitleDetail({ data: { ratingKey: selectedKey! } }),
    enabled: !!selectedKey,
  });

  const items = browse.data?.status === "ok" ? browse.data.items : [];
  if (items.length === 0) return null;

  const d = detail.data?.status === "ok" ? detail.data.detail : null;

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-1.5 flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Library className="h-3 w-3" /> Bibliotecă completă
      </div>
      <div className="space-y-1">
        {items.slice(0, visible).map((item) => (
          <button
            key={item.ratingKey}
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setSelectedKey(item.ratingKey);
            }}
            className="flex w-full items-center gap-2 rounded-lg bg-muted/40 px-2 py-1.5 text-left transition-colors hover:bg-muted/60 active:bg-muted"
          >
            {item.thumb ? (
              <img
                src={`/api/plex-thumb?path=${encodeURIComponent(item.thumb)}`}
                className="h-8 w-8 shrink-0 rounded object-cover bg-muted"
                loading="lazy"
                alt=""
              />
            ) : item.type === "movie" ? (
              <Film className="h-3.5 w-3.5 shrink-0 text-amber-400" />
            ) : (
              <Tv className="h-3.5 w-3.5 shrink-0 text-blue-400" />
            )}
            <span className="min-w-0 flex-1 truncate text-xs">{itemLabel(item)}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {addedDate(item.addedAt)}
            </span>
          </button>
        ))}
      </div>
      {items.length > visible && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setVisible((v) => v + PAGE_SIZE);
          }}
          className="mt-1.5 w-full rounded-lg bg-muted/50 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
        >
          Afișează mai mult
        </button>
      )}

      <Drawer open={!!selectedKey} onOpenChange={(o) => !o && setSelectedKey(null)}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="pb-2 text-left">
            <div className="flex items-start gap-3">
              {d?.thumb && (
                <img
                  src={`/api/plex-thumb?path=${encodeURIComponent(d.thumb)}`}
                  className="h-20 w-14 shrink-0 rounded-lg object-cover bg-muted"
                  loading="lazy"
                  alt=""
                />
              )}
              <div className="min-w-0">
                <DrawerTitle className="flex items-center gap-2 text-base">
                  {d?.type === "movie" ? (
                    <Film className="h-4 w-4 text-amber-400 shrink-0" />
                  ) : (
                    <Tv className="h-4 w-4 text-blue-400 shrink-0" />
                  )}
                  {d ? (d.type === "movie" ? d.title : (d.show ?? d.title)) : "Se încarcă…"}
                </DrawerTitle>
                {d?.type === "episode" && (
                  <DrawerDescription className="text-left text-sm font-medium text-foreground leading-snug mt-1">
                    {d.season != null && d.episode != null
                      ? `S${String(d.season).padStart(2, "0")}E${String(d.episode).padStart(2, "0")}`
                      : ""}
                    {d.title ? ` · ${d.title}` : ""}
                  </DrawerDescription>
                )}
              </div>
            </div>
          </DrawerHeader>

          <div className="px-4 pb-6 space-y-3 overflow-y-auto max-h-[65vh]">
            {detail.isLoading && (
              <div className="text-xs text-muted-foreground">Se încarcă detaliile…</div>
            )}
            {detail.data?.status === "error" && (
              <div className="text-xs text-red-400">{detail.data.error}</div>
            )}
            {d && (
              <>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {d.quality && (
                    <span className="rounded-full bg-amber-500/15 text-amber-400 px-2 py-0.5 font-medium">
                      {d.quality}
                    </span>
                  )}
                  <span
                    className={`flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
                      d.hasRomanianSubtitle
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    <Captions className="h-3 w-3" />
                    {d.hasRomanianSubtitle ? "Subtitrare RO" : "Fără subtitrare RO"}
                  </span>
                  {d.durationMs > 0 && (
                    <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground">
                      <Clock3 className="h-3 w-3" /> {formatMs(d.durationMs)}
                    </span>
                  )}
                </div>

                <div className="text-xs text-muted-foreground">Adăugat: {addedDate(d.addedAt)}</div>

                <div className="flex items-center gap-1.5 text-xs">
                  {d.watchedByMe ? (
                    <Eye className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  ) : (
                    <EyeOff className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  )}
                  <span>{d.watchedByMe ? "Ai văzut acest titlu" : "Nu ai văzut acest titlu"}</span>
                </div>

                <div className="text-xs">
                  <div className="mb-1 flex items-center gap-1 text-muted-foreground">
                    <Users className="h-3.5 w-3.5" /> Alți utilizatori care au văzut
                  </div>
                  {d.watchedByOthers.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {d.watchedByOthers.map((u) => (
                        <span
                          key={u}
                          className="rounded-full bg-muted/60 px-2 py-0.5 text-[11px] text-foreground"
                        >
                          {u}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="text-muted-foreground">Nimeni altcineva încă</div>
                  )}
                </div>

                {d.summary && (
                  <div className="text-xs text-muted-foreground leading-relaxed">{d.summary}</div>
                )}
              </>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
