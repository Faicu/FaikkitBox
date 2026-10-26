import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { getPlex, getPlexSessions, getImmich, getQbit, getHost } from "./services.functions";
import { getAdminStatus } from "./auth/admin.functions";
import { getVersions } from "./system/versions.functions";
import { getServiceJobs, runningFrom } from "./system/service-jobs.functions";
import {
  getLastSpeedtest,
  getSpeedtestHistory,
  getSpeedtestState,
} from "./system/speedtest.functions";
import { getActivityLog, type ActivityEntry } from "./activity-log.functions";
import { getImmichTracker } from "./services/immich-uploads.functions";
import { listWantedMovies } from "./media/media.functions";
import { getErrorLogs } from "./errors/error-log.functions";
import {
  getRecentCommits,
  getCommitsFromDb,
  getGitHubSyncStatus,
  getGitPushStatus,
  getUnpushedCommits,
} from "./github.functions";
import { getPlexLibraryBrowse, getRecentWatches } from "./services.functions";
import { getRefreshMs, getFastRefreshMs, REFRESH_DEFAULT_MS } from "./refresh-rate";
import { getNetworkLink } from "./system/network-link.functions";
import { getDbBackupStatus } from "./system/db-backup.functions";
import { getShowWatchStatus } from "./media/media.functions";
import { getSubtitleRetryStatus } from "./filelist/download.functions";
import { getWatcherStatus, getWatcherHistory } from "./watcher/watcher.functions";
import { listUsers } from "./auth/users.functions";
import { listPushSubscriptions } from "./notifications/push.functions";
import {
  getMyContribution,
  getContributionsOverview,
} from "./contributions/contributions.functions";
import {
  getDiscoverTitles,
  type DiscoverMediaType,
  type DiscoverSort,
} from "./tmdb/tmdb.discover.functions";

// Ritmul statisticilor live e reglabil din Sistem (refresh-rate.ts);
// `refetchInterval` e o funcție, deci schimbarea are efect imediat. La 1s fix,
// fiecare tab cerea pe secundă procese, Docker, torrente și Immich — monitorul
// ajunsese principalul consumator de CPU. Acum serverul cachează (cachedAsync),
// deci N tab-uri costă cât unul.

// Listele care se schimbă rar au un ritm propriu, dar urmează și ele un ritm
// cerut mai lent (economie de baterie).
const slower = (factor: number) => () => getRefreshMs() * factor;

// Pulsul Bibliotecii: 30s la implicitul de 3s, 5 min la 30s.
const LIBRARY_IDLE_FACTOR = 10;

// Datele vechi rămân afișate cât se încarcă cele noi.
const keepPrev = { placeholderData: <T>(prev: T) => prev };

export const plexQuery = queryOptions({
  queryKey: ["plex"],
  queryFn: () => getPlex(),
  refetchInterval: slower(3),
  refetchIntervalInBackground: false,
  staleTime: 10_000,
  ...keepPrev,
});

// „Cine vizionează acum” — cerere separată, rapidă.
export const plexSessionsQuery = queryOptions({
  queryKey: ["plexSessions"],
  queryFn: () => getPlexSessions(),
  refetchInterval: () => getFastRefreshMs(),
  refetchIntervalInBackground: false,
  staleTime: 1_000,
  ...keepPrev,
});

export const immichQuery = queryOptions({
  queryKey: ["immich"],
  queryFn: () => getImmich(),
  refetchInterval: () => getRefreshMs(),
  staleTime: 0,
  ...keepPrev,
});

// Starea urmăririi încărcărilor Immich (sarcina la 2 minute).
export const immichTrackerQuery = queryOptions({
  queryKey: ["immichTracker"],
  queryFn: () => getImmichTracker(),
  refetchInterval: 60_000,
  staleTime: 30_000,
  ...keepPrev,
});

export const qbitQuery = queryOptions({
  queryKey: ["qbit"],
  queryFn: () => getQbit(),
  refetchInterval: () => getRefreshMs(),
  staleTime: 0,
  ...keepPrev,
});

export const hostQuery = queryOptions({
  queryKey: ["host"],
  queryFn: () => getHost(),
  refetchInterval: () => getRefreshMs(),
  // Fără cereri cu tabul minimizat — nimeni nu le vede.
  refetchIntervalInBackground: false,
  staleTime: 0,
  ...keepPrev,
});

// Jurnalul (30 de zile, ~0,5 MB): la puls se cer doar intrările noi (cursorul
// serverului); lista întreagă la prima citire și din 5 în 5 minute — așa dispar
// intrările expirate și își primesc legătura spre Bibliotecă cele scrise
// înaintea titlului.
interface ActivityLogData {
  entries: ActivityEntry[];
  cursor: number;
  fullAt: number;
}
const ACTIVITY_FULL_MS = 5 * 60_000;

export const activityLogQuery = queryOptions({
  queryKey: ["activityLog"],
  queryFn: async ({ client }): Promise<ActivityLogData> => {
    const prev = client.getQueryData<ActivityLogData>(["activityLog"]);
    if (prev && Date.now() - prev.fullAt < ACTIVITY_FULL_MS) {
      const res = await getActivityLog({ data: { after: prev.cursor } });
      if (res.entries.length === 0) return { ...prev, cursor: res.cursor };
      // Sortare după oră: o intrare nouă poate avea ora din trecut.
      const entries = [...res.entries, ...prev.entries].sort((a, b) =>
        a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0,
      );
      return { entries, cursor: res.cursor, fullAt: prev.fullAt };
    }
    const res = await getActivityLog({ data: {} });
    return { entries: res.entries, cursor: res.cursor, fullAt: Date.now() };
  },
  select: (data) => data.entries,
  refetchInterval: slower(2),
  staleTime: 2_000,
  ...keepPrev,
});

export const errorLogQuery = queryOptions({
  queryKey: ["errorLog"],
  queryFn: () => getErrorLogs(),
  refetchInterval: slower(5),
  staleTime: 5_000,
  ...keepPrev,
});

export const adminStatusQuery = queryOptions({
  queryKey: ["adminStatus"],
  queryFn: () => getAdminStatus(),
  staleTime: 30_000,
  refetchOnWindowFocus: true,
});

// Acțiunile pe servicii: des cât una rulează (ieșirea curge live), rar în rest.
export const serviceJobsQuery = queryOptions({
  queryKey: ["serviceJobs"],
  queryFn: () => getServiceJobs(),
  refetchInterval: (q) => (runningFrom(q.state.data) ? 2_000 : 30_000),
  staleTime: 1_000,
  ...keepPrev,
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

// Commit-urile de pe GitHub → în DB (în fundal).
export const recentCommitsQuery = queryOptions({
  queryKey: ["recentCommits"],
  queryFn: () => getRecentCommits(),
  refetchInterval: 5 * 60_000,
  staleTime: 2 * 60_000,
  refetchOnWindowFocus: true,
});

// Commit-urile din DB — istoricul complet.
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

// Speedtest-ul: des doar cât rulează un test — butonul arată „se rulează” și
// după redeschiderea aplicației.
export const speedtestStateQuery = queryOptions({
  queryKey: ["speedtestState"],
  queryFn: () => getSpeedtestState(),
  refetchInterval: (query) => (query.state.data?.running ? 2_000 : false),
  refetchOnWindowFocus: true,
  staleTime: 0,
});

export const plexLibraryBrowseQuery = queryOptions({
  queryKey: ["plexLibraryBrowse"],
  queryFn: () => getPlexLibraryBrowse(),
  // Cât se descarcă ceva: ritmul ales (progres live). Altfel un puls lent, ca
  // un titlu adăugat de pe alt dispozitiv să apară singur. Rulează doar cât
  // pagina Bibliotecă e deschisă și citește doar din `media`.
  refetchInterval: (query) => {
    const data = query.state.data;
    const items = data?.status === "ok" ? data.items : [];
    return items.some((it) => it.status === "downloading")
      ? getRefreshMs()
      : slower(LIBRARY_IDLE_FACTOR)();
  },
  // staleTime aliniat la puls.
  staleTime: LIBRARY_IDLE_FACTOR * REFRESH_DEFAULT_MS,
  // La revenirea în tab, reîmprospătare imediată.
  refetchOnWindowFocus: true,
});

export const recentWatchesQuery = queryOptions({
  queryKey: ["recentWatches"],
  queryFn: () => getRecentWatches(),
  staleTime: 60_000,
  refetchInterval: 60_000,
});

// Viteza legăturii Ethernet — se schimbă doar la evenimente fizice; componenta
// invalidează query-ul cât urmărește o renegociere.
// Backup-urile, pentru cardul din Tehnic — se schimbă o dată pe zi.
export const dbBackupQuery = queryOptions({
  queryKey: ["dbBackup"],
  queryFn: () => getDbBackupStatus(),
  staleTime: 5 * 60_000,
  refetchInterval: 10 * 60_000,
});

export const networkLinkQuery = queryOptions({
  queryKey: ["networkLink"],
  queryFn: () => getNetworkLink(),
  staleTime: 30_000,
  refetchInterval: 60_000,
  refetchOnWindowFocus: true,
});

// Watcher-ul: puls lent pentru rândul din listă; drawer-ul deschis cere 2s
// (react-query folosește intervalul cel mai scurt). Nimic cu tab-ul ascuns.
export const watcherStatusQuery = queryOptions({
  queryKey: ["watcherStatus"],
  queryFn: () => getWatcherStatus(),
  staleTime: 1_000,
  refetchInterval: 30_000,
  ...keepPrev,
});

export const watcherHistoryQuery = (taskId: string) =>
  queryOptions({
    queryKey: ["watcherHistory", taskId],
    queryFn: () => getWatcherHistory({ data: { taskId } }),
    staleTime: 5_000,
    ...keepPrev,
  });

// Serialele urmărite — puls lent: fiecare serial e verificat cel mult o dată pe oră.
export const showWatchStatusQuery = queryOptions({
  queryKey: ["showWatchStatus"],
  queryFn: () => getShowWatchStatus(),
  staleTime: 60_000,
  refetchInterval: 120_000,
});

// Reîncercarea subtitrărilor — puls lent: fiecare titlu e căutat o dată pe zi.
export const subtitleRetryStatusQuery = queryOptions({
  queryKey: ["subtitleRetryStatus"],
  queryFn: () => getSubtitleRetryStatus(),
  staleTime: 60_000,
  refetchInterval: 5 * 60_000,
});

// Filmele așteptate — puls lent (12h per film), dar nu înghețat: un film găsit
// dispare singur.
export const wantedMoviesQuery = queryOptions({
  queryKey: ["wanted-movies"],
  queryFn: () => listWantedMovies(),
  staleTime: 60_000,
  refetchOnWindowFocus: true,
});

// Conturile, pentru pagina Utilizatori (admin).
export const usersQuery = queryOptions({
  queryKey: ["users"],
  queryFn: () => listUsers(),
});

// Contribuția lunară (Acasă și administrare), invalidate împreună prin
// prefixul ["contributions"].
export const myContributionQuery = queryOptions({
  queryKey: ["contributions", "mine"],
  queryFn: () => getMyContribution(),
  staleTime: 30_000,
});

export const contributionsOverviewQuery = (month: string | null) =>
  queryOptions({
    queryKey: ["contributions", "overview", month],
    queryFn: () => getContributionsOverview({ data: { month: month ?? undefined } }),
    ...keepPrev,
  });

// Abonamentele push, pentru Tehnic (admin).
export const pushSubscriptionsQuery = queryOptions({
  queryKey: ["pushSubscriptions"],
  queryFn: () => listPushSubscriptions(),
});

// Grila din Descoperă, câte o listă pe tip, cu pagini încărcate la derulare.
export const discoverQuery = (mediaType: DiscoverMediaType, sort: DiscoverSort) =>
  infiniteQueryOptions({
    queryKey: ["discover", mediaType, sort],
    queryFn: ({ pageParam }) => getDiscoverTitles({ data: { mediaType, sort, page: pageParam } }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.items.length > 0 ? allPages.length + 1 : undefined,
  });
