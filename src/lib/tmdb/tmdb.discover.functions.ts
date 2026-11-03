import { createServerFn } from "@tanstack/react-start";
import { tmdbFetch } from "./tmdb-client";
import { hasRomanianTitle, secondaryTitle } from "../media/title-label";

export type DiscoverMediaType = "movie" | "tv";
export type DiscoverSort = "trending" | "popular_all_time" | "newest";

export interface DiscoverTitle {
  id: number;
  mediaType: DiscoverMediaType;
  // Ca în Bibliotecă: română, altfel engleza — sau numele din `media`, dacă
  // titlul e deja acolo (applyLibraryTitles).
  title: string;
  // Rândul de sub nume (secondaryTitle din title-label.ts).
  secondaryTitle: string | null;
  year: string | null;
  posterUrl: string | null;
  // Nota și voturile de pe IMDb (datasetul zilnic, vezi imdb/imdb-ratings.ts)
  // — nu nota TMDB, care diferă vizibil. Null dacă IMDb n-are încă rating.
  // Completate doar în grile (getDiscoverTitles, Top Filelist), nu în feed.
  imdbRating: number | null;
  imdbVotes: number | null;
}

interface TmdbApiDiscoverItem {
  id: number;
  media_type?: string;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  original_language?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
}

interface TmdbApiDiscoverResponse {
  results?: TmdbApiDiscoverItem[];
}

const nameOf = (r: TmdbApiDiscoverItem | undefined) => (r?.title ?? r?.name)?.trim() || "";

// `en` = același rezultat cerut în engleză (aceeași pagină, aceeași ordine).
function mapItem(
  mediaType: DiscoverMediaType,
  r: TmdbApiDiscoverItem,
  en: TmdbApiDiscoverItem | undefined,
): DiscoverTitle {
  const ro = nameOf(r);
  const original = (r.original_title ?? r.original_name)?.trim() || ro;
  const english = nameOf(en) || null;
  const title = hasRomanianTitle(ro, original, r.original_language) ? ro : english || ro;
  return {
    id: r.id,
    mediaType,
    title,
    secondaryTitle: secondaryTitle(title, original, english),
    year: (mediaType === "movie" ? r.release_date : r.first_air_date)?.slice(0, 4) || null,
    posterUrl: r.poster_path ? `https://image.tmdb.org/t/p/w342${r.poster_path}` : null,
    imdbRating: null,
    imdbVotes: null,
  };
}

async function fetchDiscoverPage(
  mediaType: DiscoverMediaType,
  sort: DiscoverSort,
  page: number,
): Promise<DiscoverTitle[]> {
  let path: string;
  if (sort === "trending") {
    path = `/trending/${mediaType}/week?page=${page}`;
  } else if (sort === "newest") {
    const dateField = mediaType === "movie" ? "primary_release_date" : "first_air_date";
    const today = new Date().toISOString().slice(0, 10);
    path =
      `/discover/${mediaType}?sort_by=${dateField}.desc&page=${page}` +
      `&${dateField}.lte=${today}&vote_count.gte=5`;
  } else {
    path = `/discover/${mediaType}?sort_by=popularity.desc&page=${page}&vote_count.gte=200`;
  }
  // Engleza, pentru titlurile fără traducere românească — fără ea, rămâne românul.
  const [json, enJson] = await Promise.all([
    tmdbFetch<TmdbApiDiscoverResponse>(`${path}&language=ro-RO`),
    tmdbFetch<TmdbApiDiscoverResponse>(`${path}&language=en-US`).catch(() => null),
  ]);
  const enById = new Map((enJson?.results ?? []).map((r) => [r.id, r]));
  const items = (json.results ?? [])
    .filter((r) => r.poster_path)
    .map((r) => mapItem(mediaType, r, enById.get(r.id)));
  const { applyLibraryTitles } = await import("./discover-library-titles");
  return applyLibraryTitles(items);
}

export interface DiscoverPageResult {
  items: DiscoverTitle[];
  degraded: boolean;
}

export const getDiscoverTitles = createServerFn({ method: "GET" })
  .validator((data: { mediaType: DiscoverMediaType; sort: DiscoverSort; page?: number }) => data)
  .handler(async ({ data }): Promise<DiscoverPageResult> => {
    const { requireAuth } = await import("../auth/admin.server");
    await requireAuth();
    try {
      const items = await fetchDiscoverPage(data.mediaType, data.sort, data.page ?? 1);
      const { attachImdbRatings } = await import("../imdb/discover-ratings");
      return { items: await attachImdbRatings(items), degraded: false };
    } catch {
      return { items: [], degraded: true };
    }
  });

export interface TmdbVideo {
  key: string;
  name: string;
  type: string;
}

interface TmdbApiVideo {
  key?: string;
  name?: string;
  type?: string;
  site?: string;
}

interface TmdbApiVideosResponse {
  results?: TmdbApiVideo[];
}

// Doar tipuri care chiar arată imagini din film/serial — excludem "Featurette"
// (de obicei interviuri/behind-the-scenes fără scene reale) și alte tipuri
// non-vizuale ("Bloopers" cu compilații de erori, etc.).
const ALLOWED_VIDEO_TYPES = ["Trailer", "Teaser", "Clip"];

async function fetchVideosFor(mediaType: DiscoverMediaType, id: number): Promise<TmdbVideo[]> {
  const json = await tmdbFetch<TmdbApiVideosResponse>(`/${mediaType}/${id}/videos`);
  return (json.results ?? [])
    .filter((v) => v.site === "YouTube" && v.key && ALLOWED_VIDEO_TYPES.includes(v.type ?? ""))
    .map((v) => ({ key: v.key as string, name: v.name ?? "", type: v.type ?? "" }));
}

export const getTmdbVideos = createServerFn({ method: "GET" })
  .validator((data: { id: number; mediaType: DiscoverMediaType }) => data)
  .handler(async ({ data }): Promise<TmdbVideo[]> => {
    const { requireAuth } = await import("../auth/admin.server");
    await requireAuth();
    try {
      return await fetchVideosFor(data.mediaType, data.id);
    } catch {
      return [];
    }
  });

// ---------------------------------------------------------------------------
// Feed „descoperire" (mod tip TikTok) — titluri random asociate cu un clip
// video real, gata de redat unul după altul, fără request-uri suplimentare
// per-card pe client.
// ---------------------------------------------------------------------------

export interface FeedClip extends DiscoverTitle {
  videoKey: string;
}

export interface FeedClipsResult {
  clips: FeedClip[];
  degraded: boolean;
}

export const getFeedClips = createServerFn({ method: "GET" })
  .validator((data: { mediaType: DiscoverMediaType | "all"; sort: DiscoverSort }) => data)
  .handler(async ({ data }): Promise<FeedClipsResult> => {
    const { requireAuth } = await import("../auth/admin.server");
    await requireAuth();
    try {
      const mediaTypes: DiscoverMediaType[] =
        data.mediaType === "all" ? ["movie", "tv"] : [data.mediaType];
      // pagină aleatorie (1-5) din discover/trending, ca feed-ul să nu fie identic la fiecare vizită
      const page = 1 + Math.floor(Math.random() * 5);

      const titleLists = await Promise.all(
        mediaTypes.map((mt) => fetchDiscoverPage(mt, data.sort, page)),
      );
      const titles = titleLists.flat();

      const withVideos = await Promise.all(
        titles.map(async (t) => {
          try {
            const videos = await fetchVideosFor(t.mediaType, t.id);
            if (videos.length === 0) return null;
            const video = videos[Math.floor(Math.random() * videos.length)];
            return { ...t, videoKey: video.key } satisfies FeedClip;
          } catch {
            return null;
          }
        }),
      );

      const clips = withVideos.filter((c): c is FeedClip => c !== null);
      // amestecă ordinea (titlurile de film/tv altfel ar veni în blocuri separate)
      for (let i = clips.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [clips[i], clips[j]] = [clips[j], clips[i]];
      }
      return { clips, degraded: false };
    } catch {
      return { clips: [], degraded: true };
    }
  });
