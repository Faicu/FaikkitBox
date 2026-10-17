// Preîncărcarea datelor tuturor paginilor, la deschiderea aplicației.
//
// Fiecare pagină își cerea datele abia după ce se deschidea — la fiecare
// intrare, un dus-întors telefon → Cloudflare → server înainte să apară
// ceva. Aici se cer toate în fundal, imediat ce se știe cine e logat, și
// rămân în memorie (gcTime: Infinity — păstrarea cea mai lungă câștigă, deci
// paginile nu o mai scurtează). Intrând pe o pagină, datele sunt deja acolo;
// dacă sunt mai vechi decât staleTime-ul ei, se reîmprospătează în fundal.
// Pulsurile periodice (refetchInterval) rulează în continuare doar cât timp
// pagina e deschisă. La ieșirea din cont, AppHeader golește memoria.
//
// Tot aici se descarcă și codul paginilor (fiecare are fișierul ei, încărcat
// la cerere): fără asta, prima atingere a unui buton din bara de jos aștepta
// încă un drum prin Cloudflare doar pentru cod, deși datele erau gata.

import type { QueryClient } from "@tanstack/react-query";
import type { AnyRouter } from "@tanstack/react-router";

import {
  activityLogQuery,
  commitsFromDbQuery,
  dbBackupQuery,
  discoverQuery,
  errorLogQuery,
  githubPushStatusQuery,
  hostQuery,
  immichQuery,
  immichTrackerQuery,
  lastSpeedtestQuery,
  networkLinkQuery,
  plexLibraryBrowseQuery,
  plexQuery,
  plexSessionsQuery,
  pushSubscriptionsQuery,
  qbitQuery,
  recentCommitsQuery,
  recentWatchesQuery,
  serviceJobsQuery,
  showWatchStatusQuery,
  speedtestHistoryQuery,
  speedtestStateQuery,
  subtitleRetryStatusQuery,
  unpushedCommitsQuery,
  usersQuery,
  versionsQuery,
  wantedMoviesQuery,
} from "./queries";

// Ce vede orice cont logat: Acasă, Bibliotecă, Descoperă (fila implicită,
// „Trending", filme și seriale).
const USER_QUERIES = [
  plexQuery,
  plexSessionsQuery,
  recentWatchesQuery,
  plexLibraryBrowseQuery,
  wantedMoviesQuery,
];

// Doar adminul: Tehnic, qBit, Sistem, Immich, Utilizatori.
const ADMIN_QUERIES = [
  activityLogQuery,
  errorLogQuery,
  recentCommitsQuery,
  commitsFromDbQuery,
  githubPushStatusQuery,
  unpushedCommitsQuery,
  dbBackupQuery,
  networkLinkQuery,
  showWatchStatusQuery,
  subtitleRetryStatusQuery,
  lastSpeedtestQuery,
  speedtestHistoryQuery,
  speedtestStateQuery,
  versionsQuery,
  serviceJobsQuery,
  pushSubscriptionsQuery,
  usersQuery,
  qbitQuery,
  hostQuery,
  immichQuery,
  immichTrackerQuery,
];

const USER_ROUTES = ["/", "/biblioteca", "/descopera"] as const;
const ADMIN_ROUTES = ["/tehnic", "/qbit", "/sistem", "/immich", "/users"] as const;

export function prefetchAppData(
  queryClient: QueryClient,
  router: AnyRouter,
  isAdmin: boolean,
): void {
  const routes = isAdmin ? [...USER_ROUTES, ...ADMIN_ROUTES] : USER_ROUTES;
  for (const to of routes) {
    // Doar o optimizare: o pagină care nu se preîncarcă se încarcă normal la
    // deschidere.
    void router.preloadRoute({ to }).catch(() => {});
  }

  const queries = isAdmin ? [...USER_QUERIES, ...ADMIN_QUERIES] : USER_QUERIES;
  for (const q of queries) {
    // `as never`: lista amestecă tipuri de date diferite; opțiunile sunt
    // oricum cele definite în queries.ts, nemodificate.
    void queryClient.prefetchQuery({ ...q, gcTime: Infinity } as never);
  }
  for (const mediaType of ["movie", "tv"] as const) {
    void queryClient.prefetchInfiniteQuery({
      ...discoverQuery(mediaType, "trending"),
      gcTime: Infinity,
    });
  }
}
