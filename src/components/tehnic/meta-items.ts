import type { ActivityEntry } from "@/lib/activity-log.functions";

// Forma lui meta.items pe intrările `metadata_refresh` — vezi logMetaReport
// din src/lib/media/metadata-report.ts (listele vin ca text pe linii).
export interface MetaItem {
  title: string;
  kind: "show" | "movie";
  fields: string;
  episodes: string;
}

export function metaItems(entry: ActivityEntry): MetaItem[] {
  return (entry.meta?.items as MetaItem[] | undefined) ?? [];
}
