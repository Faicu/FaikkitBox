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

// Ritmul statisticilor live e reglabil din pagina Sistem — vezi
// lib/refresh-rate.ts. `refetchInterval` primește o funcție, evaluată la
// fiecare tick, deci schimbarea are efect imediat, fără reîncărcare.
//
// A fost fix 1000ms, ceea ce însemna, PER TAB DESCHIS, un set complet de
// apeluri pe secundă: si.processes(), dockerContainerStats per container,
// lista completă de torrente din qBittorrent, statisticile Immich. Monitorul
// de sistem ajunsese principalul consumator de CPU al sistemului monitorizat.
// Acum serverul cachează rezultatele (cachedAsync din services/shared.ts),
// deci N tab-uri costă cât unul.

// Listele care se schimbă rar nu merită ritmul statisticilor de sistem, dar
// nici nu trebuie să rămână blocate pe o valoare fixă când userul cere
// explicit un ritm mai lent (ex. economie de baterie pe telefon).
const slower = (factor: number) => () => getRefreshMs() * factor;

// Pulsul de fond al Bibliotecii, ca multiplu al ritmului ales: 30s la
// implicitul de 3s, 5 min dacă userul cere 30s (economie de baterie).
const LIBRARY_IDLE_FACTOR = 10;

// Păstrează datele vechi afișate în timp ce se încarcă cele noi (fără flicker)
const keepPrev = { placeholderData: <T>(prev: T) => prev };

export const plexQuery = queryOptions({
  queryKey: ["plex"],
  queryFn: () => getPlex(),
  refetchInterval: slower(3),
  refetchIntervalInBackground: false,
  staleTime: 10_000,
  ...keepPrev,
});

// "Cine vizionează acum" — cerere separată, rapidă (doar /status/sessions)
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

// Starea plugin-ului de încărcări Immich (immich-upload-tracker). Se schimbă
// la 5 minute, deci un minut e destul.
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
  // Era `true`: statisticile de sistem continuau să fie cerute la fiecare
  // secundă și cu tabul minimizat, la nesfârșit. Nimeni nu le vede atunci.
  refetchIntervalInBackground: false,
  staleTime: 0,
  ...keepPrev,
});

// Jurnalul ține 30 de zile (~2.000 de intrări, ~0,5 MB). La puls se cer doar
// intrările scrise de la ultima citire (cursorul serverului) și se adaugă la
// cele deja primite. Lista întreagă se cere la prima citire și apoi din 5 în
// 5 minute: așa dispar și intrările șterse după 30 de zile, iar intrările de
// torrent scrise înaintea titlului din Bibliotecă își primesc legătura spre el
// (mediaId, calculat la citire).
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

// Acțiunile pe servicii (Restart / Update): des cât una rulează, ca ieșirea
// să curgă live, rar în rest.
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

// Starea rulării de speedtest, ținută pe server. Interogăm des DOAR cât timp
// chiar rulează un test; altfel query-ul stă liniștit. Așa butonul arată "se
// rulează" corect chiar dacă ai redeschis aplicația la mijlocul testului.
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
  // Cât timp o descărcare e în curs: ritmul ales, pentru progresul live din
  // qBittorrent. Altfel un puls lent de fond (30s implicit), ca un titlu
  // adăugat de pe alt dispozitiv — sau de alt utilizator — să apară singur,
  // fără refresh manual. Înainte era `false`, adică lista rămânea înghețată
  // pe ce era la deschiderea paginii.
  //
  // Costul e mic și mărginit: query-ul e folosit DOAR de pagina Bibliotecă
  // (BibliotecaList), iar refetchInterval rulează doar cât timp query-ul e
  // montat — deci pulsul există doar cât ai efectiv pagina deschisă. Cererea
  // se servește din `media`, fără să atingă Plex sau TMDB.
  refetchInterval: (query) => {
    const data = query.state.data;
    const items = data?.status === "ok" ? data.items : [];
    return items.some((it) => it.status === "downloading")
      ? getRefreshMs()
      : slower(LIBRARY_IDLE_FACTOR)();
  },
  // staleTime aliniat la pulsul de fond: revenind pe pagină nu vezi date mai
  // vechi decât un ciclu. Era 60s, adică dublu față de puls.
  staleTime: LIBRARY_IDLE_FACTOR * REFRESH_DEFAULT_MS,
  // Revenind din altă aplicație / alt tab, reîmprospătează imediat, fără să
  // aștepți următorul puls.
  refetchOnWindowFocus: true,
});

export const recentWatchesQuery = queryOptions({
  queryKey: ["recentWatches"],
  queryFn: () => getRecentWatches(),
  staleTime: 60_000,
  refetchInterval: 60_000,
});

// Viteza negociată a legăturii Ethernet — se schimbă doar la evenimente fizice
// (cablu atins, switch repornit), deci un ritm lent e suficient. Componenta
// invalidează manual query-ul cât timp urmărește revenirea după renegociere.
// Starea backup-urilor, pentru cardul din Tehnic. Ritm lent: se schimbă o
// dată pe zi, iar butonul manual invalidează explicit.
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

// Starea urmăririi serialelor, pentru panoul "Plugin-uri active" din Tehnic.
// Ritm lent: plugin-ul verifică oricum cel mult o dată pe oră per serial (la 3
// ore în afara zilelor de lansare), deci n-are rost un puls mai des decât atât.
export const showWatchStatusQuery = queryOptions({
  queryKey: ["showWatchStatus"],
  queryFn: () => getShowWatchStatus(),
  staleTime: 60_000,
  refetchInterval: 120_000,
});

// Reîncercarea zilnică a subtitrărilor, pentru „Plugin-uri active" din
// Tehnic. Puls lent: plugin-ul are tic din oră în oră, iar fiecare titlu e
// căutat o dată pe zi.
export const subtitleRetryStatusQuery = queryOptions({
  queryKey: ["subtitleRetryStatus"],
  queryFn: () => getSubtitleRetryStatus(),
  staleTime: 60_000,
  refetchInterval: 5 * 60_000,
});

// Filmele așteptate (urmărire pornită, dar încă negăsite pe Filelist) — vezi
// movie-watch.ts. Puls lent: verificarea de fundal e la 12 ore per film, deci
// lista se schimbă rar. Contează totuși să nu fie înghețată — un film găsit
// între timp dispare de aici singur, fiindcă rândul de așteptare se șterge.
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

// Contribuția lunară: cardul de pe Acasă (oricine e logat) și pagina de
// administrare. Invalidate împreună după orice acțiune, cu prefixul
// ["contributions"].
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
