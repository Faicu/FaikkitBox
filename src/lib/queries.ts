import { queryOptions } from "@tanstack/react-query";
import { getPlex, getImmich, getQbit, getHost, getShowStatus } from "./services.functions";
import { getAdminStatus } from "./admin.functions";
import { getVersions } from "./versions.functions";
import { getLastSpeedtest } from "./speedtest.functions";
import { getActivityLog } from "./activity-log";
import { getFilelistDownloadLog } from "./filelist.functions";

// Interval de bază pentru statistici live (Plex/Immich/qBit/Host)
const REFRESH_MS = 1000;

// Păstrează datele vechi afișate în timp ce se încarcă cele noi (fără flicker)
const keepPrev = { placeholderData: (prev: any) => prev };

export const plexQuery = queryOptions({
  queryKey: ["plex"],
  queryFn: () => getPlex(),
  refetchInterval: REFRESH_MS,
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

