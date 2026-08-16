import { queryOptions } from "@tanstack/react-query";
import { getPlex, getPlexSessions, getImmich, getQbit, getHost } from "./services.functions";
import { getAdminStatus } from "./admin.functions";
import { getVersions } from "./versions.functions";
import { getLastSpeedtest, getSpeedtestHistory } from "./speedtest.functions";
import { getActivityLog } from "./activity-log";
import { getErrorLogs } from "./error-log";
import {
  getRecentCommits,
  getCommitsFromDb,
  getGitHubSyncStatus,
  getGitPushStatus,
  getUnpushedCommits,
} from "./github.functions";
import { getPlexLibraryBrowse } from "./services.functions";

// Interval de bază pentru statistici live (Plex/Immich/qBit/Host)
const REFRESH_MS = 1000;

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
  refetchIntervalInBackground: true,
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
});
