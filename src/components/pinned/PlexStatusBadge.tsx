import { CheckCircle2, XCircle, HelpCircle, Sparkles, AlertCircle } from "lucide-react";

import type { TvPlexStatus } from "./plex-status";

export function PlexStatusBadge({ status }: { status: TvPlexStatus }) {
  if (status === "episod_nou")
    return (
      <span className="flex items-center gap-1 rounded-lg bg-sky-500/15 px-2 py-1 text-[11px] font-medium text-sky-400">
        <Sparkles className="h-3.5 w-3.5" /> Episod nou disponibil
      </span>
    );
  if (status === "complet")
    return (
      <span className="flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2 py-1 text-[11px] font-medium text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" /> Complet în Plex
      </span>
    );
  if (status === "complet_ultim_sezon")
    return (
      <span className="flex items-center gap-1 rounded-lg bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-400/80">
        <CheckCircle2 className="h-3.5 w-3.5" /> Complet (ultimul sezon)
      </span>
    );
  if (status === "incomplet_ultim_sezon")
    return (
      <span className="flex items-center gap-1 rounded-lg bg-orange-500/15 px-2 py-1 text-[11px] font-medium text-orange-400">
        <AlertCircle className="h-3.5 w-3.5" /> Incomplet (ultimul sezon)
      </span>
    );
  if (status === "incomplet")
    return (
      <span className="flex items-center gap-1 rounded-lg bg-yellow-500/15 px-2 py-1 text-[11px] font-medium text-yellow-400">
        <HelpCircle className="h-3.5 w-3.5" /> Lipsesc episoade
      </span>
    );
  return (
    <span className="flex items-center gap-1 rounded-lg bg-red-500/15 px-2 py-1 text-[11px] font-medium text-red-400">
      <XCircle className="h-3.5 w-3.5" /> Lipsă din Plex
    </span>
  );
}
