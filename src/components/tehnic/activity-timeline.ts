// Construirea cronologiei din Jurnalul de activitate: evenimentele brute din
// `activity` + commit-urile, cu două comasări făcute doar la afișare (baza
// rămâne cu rândurile originale):
//
// - vizionările Plex: "început" + "încheiat" pentru aceeași sesiune devin un
//   singur rând, cu intervalul orar și progresul;
// - deploy-urile: "oprit" + "pornit (deploy)" la câteva secunde distanță devin
//   un singur rând, cu durata opririi.

import type { ActivityEntry } from "@/lib/activity-log.functions";
import type { GitHubCommit } from "@/lib/github.functions";

export type TimelineItem =
  | { kind: "activity"; ts: number; entry: ActivityEntry }
  | { kind: "commit"; ts: number; commit: GitHubCommit }
  | {
      kind: "plex";
      ts: number;
      start: ActivityEntry | null;
      stop: ActivityEntry | null;
      // Fără "încheiat" încă, iar începutul e recent.
      ongoing: boolean;
    }
  | { kind: "deploy"; ts: number; stop: ActivityEntry; start: ActivityEntry };

// O sesiune începută acum mai mult de atât, fără "încheiat", nu mai e
// prezentată ca "în curs" — oprirea s-a pierdut (ex. baza restaurată).
const ONGOING_MAX_MS = 6 * 60 * 60 * 1000;
// Între oprirea pentru deploy și pornirea de după trec de obicei 5-15 s
// (build-ul rulează cu serviciul oprit, deci uneori ~1 min).
const DEPLOY_GAP_MAX_MS = 10 * 60 * 1000;

const ts = (e: ActivityEntry) => new Date(e.timestamp).getTime();

function plexKey(e: ActivityEntry): string {
  const m = e.meta ?? {};
  return `${m.user ?? ""}|${m.grandparentTitle ?? ""}|${m.title ?? ""}`;
}

export function buildTimeline(
  log: ActivityEntry[],
  commits: GitHubCommit[],
  now = Date.now(),
): TimelineItem[] {
  // Cronologic crescător, ca fiecare "încheiat" să-și găsească "începutul"
  // deja văzut. Serverul le dă descrescător (cu rowid la egalitate), deci
  // inversarea + sortarea stabilă păstrează ordinea de scriere.
  const asc = [...log].reverse().sort((a, b) => ts(a) - ts(b));
  const items: TimelineItem[] = [];
  const openPlex = new Map<string, ActivityEntry>();
  let pendingStop: ActivityEntry | null = null;

  for (const e of asc) {
    if (e.type === "plex_watch_start") {
      // Un "început" rămas fără pereche (oprire pierdută) apare singur.
      const orphan = openPlex.get(plexKey(e));
      if (orphan)
        items.push({ kind: "plex", ts: ts(orphan), start: orphan, stop: null, ongoing: false });
      openPlex.set(plexKey(e), e);
      continue;
    }
    if (e.type === "plex_watch_stop") {
      const start = openPlex.get(plexKey(e)) ?? null;
      openPlex.delete(plexKey(e));
      items.push({ kind: "plex", ts: ts(e), start, stop: e, ongoing: false });
      continue;
    }
    if (e.type === "server_stop" && !e.meta?.unclean) {
      if (pendingStop) items.push({ kind: "activity", ts: ts(pendingStop), entry: pendingStop });
      pendingStop = e;
      continue;
    }
    if (e.type === "server_start" && pendingStop) {
      const stop = pendingStop;
      pendingStop = null;
      if (e.meta?.deploy === true && ts(e) - ts(stop) <= DEPLOY_GAP_MAX_MS) {
        items.push({ kind: "deploy", ts: ts(e), stop, start: e });
      } else {
        items.push({ kind: "activity", ts: ts(stop), entry: stop });
        items.push({ kind: "activity", ts: ts(e), entry: e });
      }
      continue;
    }
    items.push({ kind: "activity", ts: ts(e), entry: e });
  }

  if (pendingStop) items.push({ kind: "activity", ts: ts(pendingStop), entry: pendingStop });
  for (const start of openPlex.values()) {
    items.push({
      kind: "plex",
      ts: ts(start),
      start,
      stop: null,
      ongoing: now - ts(start) < ONGOING_MAX_MS,
    });
  }
  for (const commit of commits) {
    items.push({ kind: "commit", ts: new Date(commit.date).getTime(), commit });
  }
  // La aceeași secundă (episodul următor pornit odată cu oprirea celui
  // curent), ce s-a adăugat mai târziu e mai nou — inversare + sortare stabilă.
  return items.reverse().sort((a, b) => b.ts - a.ts);
}

// Tipul de eveniment după care se filtrează pe tab-uri.
export function itemType(item: TimelineItem): string {
  switch (item.kind) {
    case "activity":
      return item.entry.type;
    case "plex":
      return "plex_watch_start";
    case "deploy":
      return "server_start";
    case "commit":
      return "commit";
  }
}

// Progresul e scris în mesajul de "încheiat" de fmtProgress (activity-log.ts):
// " · 58/180 min (32%)".
const PROGRESS_RE = / · (\d+\/\d+ min \(\d+%\))$/;

export function plexParts(item: Extract<TimelineItem, { kind: "plex" }>): {
  what: string;
  progress: string | null;
} {
  const base = item.start ?? item.stop!;
  const progress = item.stop?.message.match(PROGRESS_RE)?.[1] ?? null;
  return { what: base.message.replace(PROGRESS_RE, ""), progress };
}

// Textul după care caută câmpul de căutare.
export function searchText(item: TimelineItem): string {
  switch (item.kind) {
    case "activity":
      return item.entry.message;
    case "plex":
      return plexParts(item).what;
    case "deploy":
      return `deploy ${item.start.message}`;
    case "commit":
      return `${item.commit.message} ${item.commit.author} ${item.commit.shortSha}`;
  }
}

// Fără diacritice și majuscule: "insula" găsește "Insula", "subtitrari"
// găsește "subtitrări".
export function normalizeSearch(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const TZ = "Europe/Bucharest";

export function dayKey(t: number): string {
  return new Date(t).toLocaleDateString("en-CA", { timeZone: TZ });
}

export function dayLabel(t: number, now = Date.now()): string {
  const key = dayKey(t);
  if (key === dayKey(now)) return "Azi";
  if (key === dayKey(now - 24 * 60 * 60 * 1000)) return "Ieri";
  const label = new Date(t).toLocaleDateString("ro-RO", {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone: TZ,
    ...(new Date(t).getFullYear() !== new Date(now).getFullYear() ? { year: "numeric" } : {}),
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function clock(t: number | string): string {
  return new Date(t).toLocaleTimeString("ro-RO", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  });
}

export function shortDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60} min`;
}
