import { queryOptions } from "@tanstack/react-query";
import { getPlex, getPlexSessions, getImmich, getQbit, getHost } from "./services.functions";
import { getAdminStatus } from "./auth/admin.functions";
import { getVersions } from "./system/versions.functions";
import { getLastSpeedtest, getSpeedtestHistory } from "./system/speedtest.functions";
import { getActivityLog } from "./activity-log.functions";
import { getErrorLogs } from "./errors/error-log.functions";
import {
  getRecentCommits,
  getCommitsFromDb,
  getGitHubSyncStatus,
  getGitPushStatus,
  getUnpushedCommits,
} from "./github.functions";
import { getPlexLibraryBrowse, getRecentWatches } from "./services.functions";

// Interval de bază pentru statistici live (Immich/qBit/Host).
//
// A fost 1000ms, ceea ce însemna, PER TAB DESCHIS, un set complet de apeluri
// pe secundă: si.processes() (parcurge tot /proc), si.dockerContainers() +
// dockerContainerStats per container, lista completă de torrente din
// qBittorrent și statisticile Immich. Monitorul de sistem ajunsese principalul
// consumator de CPU al sistemului monitorizat.
//
// Acum serverul cachează rezultatele (vezi cachedAsync din services/shared.ts),
// deci N tab-uri costă cât unul; 3s e sub pragul la care ochiul percepe
// diferența pentru cifre care oricum se mișcă lent.
const REFRESH_MS = 3000;

// Păstrează datele vechi afișate în timp ce se încarcă cele noi (fără flicker)
const keepPrev = { placeholderData: <T>(prev: T) => prev };

export const plexQuery = queryOptions({
  queryKey: ["plex"],
  queryFn: () => getPlex(),
  refetchInterval: 10_000,
  refetchIntervalInBackground: false,
  staleTime: 10_000,
  ...keepPrev,
});

// "Cine vizionează acum" — cerere separată, rapidă (doar /status/sessions)
export const plexSessionsQuery = queryOptions({
  queryKey: ["plexSessions"],
  queryFn: () => getPlexSessions(),
  refetchInterval: 1_000,
  refetchIntervalInBackground: false,
  staleTime: 1_000,
  ...keepPrev,
});

export const immichQuery = queryOptions({
  queryKey: ["immich"],
  queryFn: () => getImmich(),
  refetchInterval: REFRESH_MS,
  staleTime: 0,
  ...keepPrev,
});

export const qbitQuery = queryOptions({
  queryKey: ["qbit"],
  queryFn: () => getQbit(),
  refetchInterval: REFRESH_MS,
  staleTime: 0,
  ...keepPrev,
});

export const hostQuery = queryOptions({
  queryKey: ["host"],
  queryFn: () => getHost(),
  refetchInterval: REFRESH_MS,
  // Era `true`: statisticile de sistem continuau să fie cerute la fiecare
  // secundă și cu tabul minimizat, la nesfârșit. Nimeni nu le vede atunci.
  refetchIntervalInBackground: false,
  staleTime: 0,
  ...keepPrev,
});

export const activityLogQuery = queryOptions({
  queryKey: ["activityLog"],
  queryFn: () => getActivityLog(),
  refetchInterval: 5_000,
  staleTime: 2_000,
  ...keepPrev,
});

export const errorLogQuery = queryOptions({
  queryKey: ["errorLog"],
  queryFn: () => getErrorLogs(),
  refetchInterval: 15_000,
  staleTime: 5_000,
  ...keepPrev,
});

export const adminStatusQuery = queryOptions({
  queryKey: ["adminStatus"],
  queryFn: () => getAdminStatus(),
  staleTime: 30_000,
  refetchOnWindowFocus: true,
});

export const versionsQuery = queryOptions({
  queryKey: ["versions"],
  queryFn: () => getVersions(),
  refetchInterval: 5 * 60_000,
  staleTime: 60_000,
});

export const lastSpeedtestQuery = queryOptions({
  queryKey: ["speedtest"],
  queryFn: () => getLastSpeedtest(),
  staleTime: 30_000,
  refetchOnWindowFocus: true,
});

// Fetch periodic de pe GitHub → upsert în DB (rulat în background)
export const recentCommitsQuery = queryOptions({
  queryKey: ["recentCommits"],
  queryFn: () => getRecentCommits(),
  refetchInterval: 5 * 60_000,
  staleTime: 2 * 60_000,
  refetchOnWindowFocus: true,
});

// Citire din DB — sursa pentru timeline (istoric complet)
export const commitsFromDbQuery = queryOptions({
  queryKey: ["commitsFromDb"],
  queryFn: () => getCommitsFromDb(),
  refetchInterval: 5 * 60_000,
  staleTime: 60_000,
  refetchOnWindowFocus: true,
});

export const githubSyncQuery = queryOptions({
  queryKey: ["githubSync"],
  queryFn: () => getGitHubSyncStatus(),
  refetchInterval: 60_000,
  staleTime: 30_000,
  refetchOnWindowFocus: true,
});

export const githubPushStatusQuery = queryOptions({
  queryKey: ["githubPushStatus"],
  queryFn: () => getGitPushStatus(),
  refetchInterval: 60_000,
  staleTime: 30_000,
  refetchOnWindowFocus: true,
});
export const unpushedCommitsQuery = queryOptions({
  queryKey: ["unpushedCommits"],
  queryFn: () => getUnpushedCommits(),
  refetchInterval: 60_000,
  staleTime: 30_000,
  refetchOnWindowFocus: true,
});

export const speedtestHistoryQuery = queryOptions({
  queryKey: ["speedtestHistory"],
  queryFn: () => getSpeedtestHistory(),
  staleTime: 60_000,
});

export const plexLibraryBrowseQuery = queryOptions({
  queryKey: ["plexLibraryBrowse"],
  queryFn: () => getPlexLibraryBrowse(),
  staleTime: 60_000,
  // Refresh rapid cât timp există titluri în descărcare (progres live din
  // qBittorrent), altfel se oprește — nicio cerere extra când totul e deja
  // în bibliotecă.
  refetchInterval: (query) => {
    const data = query.state.data;
    const items = data?.status === "ok" ? data.items : [];
    return items.some((it) => it.status === "downloading") ? 2500 : false;
  },
});

export const recentWatchesQuery = queryOptions({
  queryKey: ["recentWatches"],
  queryFn: () => getRecentWatches(),
  staleTime: 60_000,
  refetchInterval: 60_000,
});
