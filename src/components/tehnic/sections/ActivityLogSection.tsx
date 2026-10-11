import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ScrollText,
  Server,
  PlayCircle,
  Download,
  CheckCircle2,
  Images,
  RefreshCw,
  Package,
  Activity,
  GitCommitHorizontal,
  AlertTriangle,
  Captions,
  UserPlus,
  DatabaseZap,
  ArrowUpCircle,
  Search,
  ChevronRight,
} from "lucide-react";

import { activityLogQuery, recentCommitsQuery, commitsFromDbQuery } from "@/lib/queries";
import type { ActivityEntry } from "@/lib/activity-log.functions";
import type { GitHubCommit } from "@/lib/github.functions";
import { CommitDrawer } from "../CommitDrawer";
import { SubtitleFixDrawer } from "../SubtitleFixDrawer";
import { MetaRefreshDrawer } from "../MetaRefreshDetails";
import { metaItems } from "../meta-items";
import { relativeTime } from "../utils";
import {
  buildTimeline,
  clock,
  dayKey,
  dayLabel,
  itemType,
  normalizeSearch,
  plexParts,
  searchText,
  shortDuration,
  type TimelineItem,
} from "../activity-timeline";

const FILTER_GROUPS: { key: string; label: string }[] = [
  { key: "all", label: "Toate" },
  { key: "server", label: "Server" },
  { key: "plex", label: "Plex" },
  { key: "torrente", label: "Torrente" },
  { key: "subtitrari", label: "Subtitrări" },
  { key: "metadate", label: "Metadate" },
  { key: "immich", label: "Immich" },
  { key: "updates", label: "Updates" },
  { key: "commits", label: "Commits" },
  { key: "conturi", label: "Conturi" },
  { key: "erori", label: "Erori" },
];

const TYPE_TO_GROUP: Record<string, string> = {
  server_start: "server",
  server_stop: "server",
  plex_watch_start: "plex",
  plex_watch_stop: "plex",
  torrent_added: "torrente",
  torrent_complete: "torrente",
  qbit_action: "torrente",
  subtitle_fix: "subtitrari",
  immich_upload: "immich",
  service_restart: "updates",
  service_update: "updates",
  ubuntu_update: "updates",
  app_error: "erori",
  account_request: "conturi",
  metadata_refresh: "metadate",
  update_available: "updates",
};

export function ActivityLogSection() {
  const { data: log, isLoading: logLoading } = useQuery(activityLogQuery);
  useQuery(recentCommitsQuery);
  const { data: commitsData, isLoading: commitsLoading } = useQuery(commitsFromDbQuery);
  const [visible, setVisible] = useState(10);
  const [filter, setFilter] = useState("all");
  const [selectedCommit, setSelectedCommit] = useState<GitHubCommit | null>(null);
  const [selectedSubtitleEntry, setSelectedSubtitleEntry] = useState<ActivityEntry | null>(null);
  const [selectedMetaEntry, setSelectedMetaEntry] = useState<ActivityEntry | null>(null);

  const iconMap: Record<string, React.ReactNode> = {
    server_start: <Server className="h-3.5 w-3.5 text-emerald-400" />,
    server_stop: <Server className="h-3.5 w-3.5 text-red-400" />,
    plex_watch_start: <PlayCircle className="h-3.5 w-3.5 text-amber-400" />,
    plex_watch_stop: <PlayCircle className="h-3.5 w-3.5 text-muted-foreground" />,
    torrent_added: <Download className="h-3.5 w-3.5 text-blue-400" />,
    torrent_complete: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />,
    immich_upload: <Images className="h-3.5 w-3.5 text-purple-400" />,
    service_restart: <RefreshCw className="h-3.5 w-3.5 text-sky-400" />,
    service_update: <Package className="h-3.5 w-3.5 text-amber-400" />,
    ubuntu_update: <Package className="h-3.5 w-3.5 text-orange-400" />,
    qbit_action: <Download className="h-3.5 w-3.5 text-sky-400" />,
    subtitle_fix: <Captions className="h-3.5 w-3.5 text-teal-400" />,
    app_error: <AlertTriangle className="h-3.5 w-3.5 text-red-400" />,
    account_request: <UserPlus className="h-3.5 w-3.5 text-amber-400" />,
    metadata_refresh: <DatabaseZap className="h-3.5 w-3.5 text-emerald-400" />,
    update_available: <ArrowUpCircle className="h-3.5 w-3.5 text-amber-400" />,
  };

  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  const timeline = useMemo(
    () =>
      buildTimeline(
        Array.isArray(log) ? log : [],
        commitsData?.status === "ok" ? commitsData.commits : [],
      ),
    [log, commitsData],
  );

  const isLoading = logLoading || commitsLoading;

  const byTab =
    filter === "all"
      ? // "Toate" exclude intenționat evenimentele de server (pornire/oprire):
        // se produc la fiecare deploy, deci ar îneca activitatea reală
        // (vizionări, torrente, conturi) în zgomot. Rămân disponibile pe
        // tab-ul lor dedicat, "Server". La fel reîmprospătările de metadate:
        // rulează de mai multe ori pe zi, singure — tab-ul "Metadate".
        timeline.filter(
          (item) =>
            item.kind === "commit" ||
            (TYPE_TO_GROUP[itemType(item)] !== "server" &&
              TYPE_TO_GROUP[itemType(item)] !== "metadate"),
        )
      : timeline.filter((item) => {
          if (item.kind === "commit") return filter === "commits";
          return TYPE_TO_GROUP[itemType(item)] === filter;
        });

  const needle = normalizeSearch(query.trim());
  const filtered = needle
    ? byTab.filter((item) => normalizeSearch(searchText(item)).includes(needle))
    : byTab;

  useEffect(() => {
    setVisible(10);
  }, [filter, needle]);

  const shown = filtered.slice(0, visible);
  const hasMore = filtered.length > visible;

  // Ora exactă lângă cea relativă; pentru zilele trecute antetul zilei spune
  // deja "când", deci rămâne doar ora.
  function when(t: number | string) {
    const time = new Date(t).getTime();
    return dayKey(time) === dayKey(Date.now())
      ? `${relativeTime(new Date(time).toISOString())} · ${clock(time)}`
      : clock(time);
  }

  function itemKey(item: TimelineItem): string {
    switch (item.kind) {
      case "activity":
        return item.entry.id;
      case "commit":
        return item.commit.sha;
      case "plex":
        return (item.start ?? item.stop)!.id;
      case "deploy":
        return item.start.id;
    }
  }

  const rowClass = "w-full flex items-start gap-2.5 px-3 py-2.5 text-left";
  const clickableClass = "hover:bg-muted/40 transition-colors cursor-pointer";

  function renderItem(item: TimelineItem) {
    if (item.kind === "plex") {
      const { what, progress } = plexParts(item);
      const range =
        item.start && item.stop
          ? `${clock(item.start.timestamp)}–${clock(item.stop.timestamp)}`
          : clock((item.start ?? item.stop)!.timestamp);
      return (
        <div className={rowClass}>
          <div className="mt-0.5 shrink-0">
            <PlayCircle
              className={`h-3.5 w-3.5 ${item.ongoing ? "text-amber-400" : "text-muted-foreground"}`}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm leading-tight break-words">{what}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {range}
              {item.ongoing && <span className="text-amber-400"> · în curs</span>}
              {progress && ` · ${progress}`}
            </div>
          </div>
          <div className="shrink-0 text-[11px] text-muted-foreground whitespace-nowrap">
            {item.ongoing ? "acum" : when(item.ts)}
          </div>
        </div>
      );
    }

    if (item.kind === "deploy") {
      const down =
        new Date(item.start.timestamp).getTime() - new Date(item.stop.timestamp).getTime();
      return (
        <div className={rowClass}>
          <div className="mt-0.5 shrink-0">
            <RefreshCw className="h-3.5 w-3.5 text-sky-400" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm leading-tight break-words">
              Deploy · oprit {shortDuration(down)}
            </div>
          </div>
          <div className="shrink-0 text-[11px] text-muted-foreground whitespace-nowrap">
            {when(item.ts)}
          </div>
        </div>
      );
    }

    if (item.kind === "activity") {
      const entry = item.entry;
      const hasSubtitleDetails =
        entry.type === "subtitle_fix" &&
        Array.isArray(entry.meta?.items) &&
        (entry.meta.items as unknown[]).length > 0;
      const hasMetaDetails = entry.type === "metadata_refresh" && metaItems(entry).length > 0;
      // Torrentele duc la titlul lor din Bibliotecă (mediaId rezolvat de
      // server; lipsește dacă titlul a fost șters).
      const mediaId = entry.mediaId;
      const clickable = hasSubtitleDetails || hasMetaDetails || mediaId != null;
      const Row = clickable ? "button" : "div";
      return (
        <Row
          onClick={
            hasSubtitleDetails
              ? () => setSelectedSubtitleEntry(entry)
              : hasMetaDetails
                ? () => setSelectedMetaEntry(entry)
                : mediaId != null
                  ? () => navigate({ to: "/biblioteca", search: { titlu: mediaId } })
                  : undefined
          }
          className={`${rowClass} ${clickable ? clickableClass : ""}`}
        >
          <div className="mt-0.5 shrink-0">
            {iconMap[entry.type] ?? <Activity className="h-3.5 w-3.5 text-muted-foreground" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm leading-tight break-words">{entry.message}</div>
          </div>
          <div className="shrink-0 flex items-center gap-0.5 text-[11px] text-muted-foreground whitespace-nowrap">
            {when(entry.timestamp)}
            {mediaId != null && <ChevronRight className="h-3 w-3" />}
          </div>
        </Row>
      );
    }

    const c = item.commit;
    return (
      <button
        onClick={() => setSelectedCommit(c)}
        className={`${rowClass} hover:bg-muted/40 transition-colors group`}
      >
        <div className="mt-0.5 shrink-0">
          <GitCommitHorizontal className="h-3.5 w-3.5 text-sky-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm leading-tight break-words group-hover:text-sky-400 transition-colors">
            {c.message}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {c.author} · <span className="font-mono">{c.shortSha}</span>
          </div>
        </div>
        <div className="shrink-0 text-[11px] text-muted-foreground whitespace-nowrap">
          {when(c.date)}
        </div>
      </button>
    );
  }

  return (
    <>
      <section className="space-y-2">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <ScrollText className="h-3.5 w-3.5" /> Jurnal activitate
        </h2>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Caută în jurnal (titlu, utilizator…)"
            className="w-full rounded-xl glass-card py-2 pl-8 pr-3 text-sm outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
          {FILTER_GROUPS.map((g) => (
            <button
              key={g.key}
              onClick={() => setFilter(g.key)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-all active:scale-95 ${
                filter === g.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
        <div className="rounded-2xl glass-card divide-y divide-border/50 stagger-in">
          {isLoading && (
            <div className="space-y-1.5 p-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-8 skeleton-sweep rounded-lg" />
              ))}
            </div>
          )}
          {!isLoading && filtered.length === 0 && (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center">
              {needle
                ? "Nimic găsit pentru această căutare."
                : filter === "all"
                  ? "Nicio activitate înregistrată încă."
                  : "Nicio activitate pentru acest filtru."}
            </div>
          )}
          {shown.map((item, i) => {
            const day = dayKey(item.ts);
            const newDay = i === 0 || dayKey(shown[i - 1].ts) !== day;
            return (
              <div key={itemKey(item)}>
                {newDay && (
                  <div className="bg-muted/30 px-3 py-1 text-[11px] font-medium text-muted-foreground">
                    {dayLabel(item.ts)}
                  </div>
                )}
                {renderItem(item)}
              </div>
            );
          })}
          {hasMore && (
            <button
              onClick={() => setVisible((v) => v + 10)}
              className="w-full px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors text-center"
            >
              Afișează încă 10 ({filtered.length - visible} rămase)
            </button>
          )}
        </div>
      </section>

      {selectedCommit && (
        <CommitDrawer commit={selectedCommit} onClose={() => setSelectedCommit(null)} />
      )}
      {selectedSubtitleEntry && (
        <SubtitleFixDrawer
          entry={selectedSubtitleEntry}
          onClose={() => setSelectedSubtitleEntry(null)}
        />
      )}
      {selectedMetaEntry && (
        <MetaRefreshDrawer entry={selectedMetaEntry} onClose={() => setSelectedMetaEntry(null)} />
      )}
    </>
  );
}
