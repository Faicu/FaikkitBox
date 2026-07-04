import { queryOptions } from "@tanstack/react-query";
import { getPlex, getImmich, getQbit, getHost } from "./services.functions";
import { getAdminStatus } from "./admin.functions";
import { getVersions } from "./versions.functions";
import { getLastSpeedtest } from "./speedtest.functions";

const REFRESH_MS = 1100;

export const plexQuery = queryOptions({
  queryKey: ["plex"],
  queryFn: () => getPlex(),
  refetchInterval: REFRESH_MS,
  refetchIntervalInBackground: false,
  staleTime: 0,
});

export const immichQuery = queryOptions({
  queryKey: ["immich"],
  queryFn: () => getImmich(),
  refetchInterval: REFRESH_MS,
  staleTime: 0,
});

export const qbitQuery = queryOptions({
  queryKey: ["qbit"],
  queryFn: () => getQbit(),
  refetchInterval: REFRESH_MS,
  staleTime: 0,
});

export const hostQuery = queryOptions({
  queryKey: ["host"],
  queryFn: () => getHost(),
  refetchInterval: REFRESH_MS,
  staleTime: 0,
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