import { createServerFn } from "@tanstack/react-start";
import { fetchJson, stripSlash, errMsg, type ServiceStatus } from "./shared";

export interface ImmichData {
  status: ServiceStatus;
  error?: string;
  version?: string;
  totalAssets?: number;
  photos?: number;
  videos?: number;
  usageBytes?: number;
  usageByUser?: Array<{ userName: string; usage: number; photos: number; videos: number }>;
  activeJobs?: Array<{ name: string; active: number; waiting: number }>;
  topUploaders?: Array<{
    userName: string;
    total: number;
    photos: number;
    videos: number;
    usage: number;
  }>;
  jobQueueDepth?: number;
  uploadsToday?: number;
  uploadsThisWeek?: number;
}

// Cache pentru upload counts Immich (costisitoare — search paginat)
let immichUploadsCache: {
  today: number | undefined;
  week: number | undefined;
  expiresAt: number;
} | null = null;

export const getImmich = createServerFn({ method: "GET" }).handler(
  async (): Promise<ImmichData> => {
    const base = process.env.IMMICH_URL;
    const key = process.env.IMMICH_API_KEY;
    if (!base || !key)
      return { status: "error", error: "IMMICH_URL / IMMICH_API_KEY not configured" };
    const url = stripSlash(base);
    const headers = { "x-api-key": key, Accept: "application/json" };

    try {
      const nowIso = new Date().toISOString();
      const startOfDayIso = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
      const weekAgoIso = new Date(Date.now() - 7 * 86400_000).toISOString();

      async function countSince(iso: string): Promise<number | undefined> {
        try {
          // createdAfter/createdBefore = data la care a fost creata inregistrarea in Immich
          // (adica momentul incarcarii). takenAfter/takenBefore ar filtra dupa data EXIF
          // (cand a fost facuta poza), ceea ce da rezultate gresite la import de biblioteci
          // vechi - fotografii incarcate azi, dar facute cu ani in urma, nu ar aparea deloc.
          //
          // NU ne bazam pe campul 'total' din raspuns - pe unele versiuni Immich acesta
          // reflecta doar numarul de elemente din pagina curenta (limitat de 'size'), nu
          // adevaratul total de potriviri (bug cunoscut). Numaram efectiv itemii primiti,
          // parcurgand paginile daca e nevoie.
          interface ImmichAsset {
            id?: string;
            type?: string;
            livePhotoVideoId?: string;
          }
          interface ImmichSearchResponse {
            assets?: { items?: ImmichAsset[]; nextPage?: number | string | null };
            items?: ImmichAsset[];
            nextPage?: number | string | null;
          }
          let items: ImmichAsset[] = [];
          let page: number | string | null = 1;
          let guard = 0;
          while (page != null && guard < 20) {
            guard++;
            const res: ImmichSearchResponse = await fetchJson<ImmichSearchResponse>(
              `${url}/api/search/metadata`,
              {
                method: "POST",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({
                  createdAfter: iso,
                  createdBefore: nowIso,
                  size: 1000,
                  page,
                }),
              },
              10000,
            );
            const pageItems = res?.assets?.items ?? res?.items ?? [];
            items = items.concat(pageItems);
            page = res?.assets?.nextPage ?? res?.nextPage ?? null;
          }

          // Live Photos (ex. MVIMG_*.jpg de pe telefoane Android/iPhone) sunt stocate
          // in Immich ca 2 elemente separate: o poza (IMAGE) si un videoclip-pereche
          // (VIDEO), legate prin campul 'livePhotoVideoId' de pe poza. In aplicatia
          // Immich, cele doua se vad ca UN singur element in galerie. Excludem
          // video-ul-pereche din numaratoare, ca sa reflectam ce vede userul, nu
          // numarul brut de asset-uri din baza de date.
          const pairedVideoIds = new Set(
            items.filter((it) => it?.livePhotoVideoId).map((it) => it.livePhotoVideoId),
          );
          const visibleItems = items.filter(
            (it) => !(it?.type === "VIDEO" && pairedVideoIds.has(it?.id)),
          );

          return visibleItems.length;
        } catch {
          return undefined;
        }
      }

      interface ImmichVersion {
        major?: number;
        minor?: number;
        patch?: number;
      }
      interface ImmichStats {
        photos?: number;
        videos?: number;
        usage?: number;
        usageByUser?: Array<{
          userName?: string;
          userId?: string;
          usage?: number;
          photos?: number;
          videos?: number;
        }>;
      }
      type ImmichJobs = Record<string, { jobCounts?: { active?: number; waiting?: number } }>;

      // Upload counts sunt costisitoare (search paginat) — cache 30s
      let uploadsToday: number | undefined;
      let uploadsThisWeek: number | undefined;
      let version: ImmichVersion | null;
      let stats: ImmichStats | null;
      let jobs: ImmichJobs | null;
      if (immichUploadsCache && immichUploadsCache.expiresAt > Date.now()) {
        uploadsToday = immichUploadsCache.today;
        uploadsThisWeek = immichUploadsCache.week;
        [version, stats, jobs] = await Promise.all([
          fetchJson<ImmichVersion>(`${url}/api/server/version`, { headers }).catch(() => null),
          fetchJson<ImmichStats>(`${url}/api/server/statistics`, { headers }),
          fetchJson<ImmichJobs>(`${url}/api/jobs`, { headers }).catch(() => null),
        ]);
      } else {
        let freshToday: number | undefined;
        let freshWeek: number | undefined;
        [version, stats, jobs, freshToday, freshWeek] = await Promise.all([
          fetchJson<ImmichVersion>(`${url}/api/server/version`, { headers }).catch(() => null),
          fetchJson<ImmichStats>(`${url}/api/server/statistics`, { headers }),
          fetchJson<ImmichJobs>(`${url}/api/jobs`, { headers }).catch(() => null),
          countSince(startOfDayIso),
          countSince(weekAgoIso),
        ]);
        uploadsToday = freshToday;
        uploadsThisWeek = freshWeek;
        immichUploadsCache = {
          today: uploadsToday,
          week: uploadsThisWeek,
          expiresAt: Date.now() + 30_000,
        };
      }

      type UsageRow = { userName: string; usage: number; photos: number; videos: number };
      const usageByUser: UsageRow[] = Array.isArray(stats?.usageByUser)
        ? stats.usageByUser.map((u) => ({
            userName: u.userName ?? u.userId ?? "user",
            usage: Number(u.usage ?? 0),
            photos: Number(u.photos ?? 0),
            videos: Number(u.videos ?? 0),
          }))
        : [];

      const activeJobs = jobs
        ? Object.entries(jobs)
            .map(([name, v]) => ({
              name,
              active: Number(v?.jobCounts?.active ?? 0),
              waiting: Number(v?.jobCounts?.waiting ?? 0),
            }))
            .filter((j) => j.active > 0 || j.waiting > 0)
        : [];

      const topUploaders = usageByUser
        .map((u) => ({
          userName: u.userName,
          total: u.photos + u.videos,
          photos: u.photos,
          videos: u.videos,
          usage: u.usage,
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);

      const jobQueueDepth = activeJobs.reduce((sum, j) => sum + j.active + j.waiting, 0);

      // Tracking activitate Immich (fire and forget)
      import("../activity-log")
        .then(({ trackImmichUploads }) => trackImmichUploads(usageByUser))
        .catch(() => {});

      return {
        status: "ok",
        version: version ? `${version.major}.${version.minor}.${version.patch}` : undefined,
        totalAssets: Number(stats?.photos ?? 0) + Number(stats?.videos ?? 0),
        photos: Number(stats?.photos ?? 0),
        videos: Number(stats?.videos ?? 0),
        usageBytes: Number(stats?.usage ?? 0),
        usageByUser,
        activeJobs,
        topUploaders,
        jobQueueDepth,
        uploadsToday,
        uploadsThisWeek,
      };
    } catch (e) {
      return { status: "error", error: errMsg(e) };
    }
  },
);
