import { queryOptions } from "@tanstack/react-query";
import { getPlex, getImmich, getQbit, getHost, getShowStatus } from "./services.functions";
import type { PlexData } from "./services.functions";
import { getAdminStatus } from "./admin.functions";
import { getVersions } from "./versions.functions";
import { getLastSpeedtest, getSpeedtestHistory } from "./speedtest.functions";
import { getActivityLog } from "./activity-log";
import { getFilelistDownloadLog } from "./filelist.functions";
import { getRecentCommits, getCommitsFromDb, getGitHubSyncStatus } from "./github.functions";

// Interval de bază pentru statistici live (Plex/Immich/qBit/Host)
const REFRESH_MS = 1000;

// Păstrează datele vechi afișate în timp ce se încarcă cele noi (fără flicker)
const keepPrev = { placeholderData: <T>(prev: T) => prev };

export const plexQuery = queryOptions({
  queryKey: ["plex"],
  queryFn: () => getPlex(),
  refetchInterval: (query) => {
    const data = query.state.data as PlexData | undefined;
    // Polling mai rapid (3s) când sunt sesiuni active, altfel 1s de bază
    return data?.sessions?.length ? 3_000 : REFRESH_MS;
  },
  refetchIntervalInBackground: false,
  staleTime: 0,
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

export const filelistLogQuery = queryOptions({
  queryKey: ["filelistLog"],
  queryFn: () => getFilelistDownloadLog(),
  refetchInterval: 10_000,
  staleTime: 5_000,
  refetchOnWindowFocus: true,
  ...keepPrev,
});

export const showStatusQuery = queryOptions({
  queryKey: ["showStatus"],
  queryFn: () => getShowStatus(),
  refetchInterval: 60_000,
  staleTime: 30_000,
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
export const speedtestHistoryQuery = queryOptions({
  queryKey: ["speedtestHistory"],
  queryFn: () => getSpeedtestHistory(),
  staleTime: 60_000,
});
