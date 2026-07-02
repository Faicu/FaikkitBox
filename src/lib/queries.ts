import { queryOptions } from "@tanstack/react-query";
import { getPlex, getImmich, getQbit, getHost } from "./services.functions";

const REFRESH_MS = 5000;

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
  refetchInterval: 15_000,
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