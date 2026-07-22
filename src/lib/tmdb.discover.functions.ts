import { createServerFn } from "@tanstack/react-start";
import { tmdbFetch } from "./tmdb-client";

export type DiscoverMediaType = "movie" | "tv";
export type DiscoverSort = "trending" | "popular_all_time" | "newest";

export interface DiscoverTitle {
  id: number;
  mediaType: DiscoverMediaType;
  title: string;
  year: string | null;
  posterUrl: string | null;
  voteAverage: number | null;
}

interface TmdbApiDiscoverItem {
  id: number;
  media_type?: string;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
  vote_average?: number | null;
}

interface TmdbApiDiscoverResponse {
  results?: TmdbApiDiscoverItem[];
}

function mapItem(mediaType: DiscoverMediaType, r: TmdbApiDiscoverItem): DiscoverTitle {
  return {
    id: r.id,
    mediaType,
    title: mediaType === "movie" ? (r.title ?? r.name ?? "") : (r.name ?? r.title ?? ""),
    year:
      (mediaType === "movie" ? r.release_date : r.first_air_date)?.slice(0, 4) || null,
    posterUrl: r.poster_path ? `https://image.tmdb.org/t/p/w342${r.poster_path}` : null,
    voteAverage: typeof r.vote_average === "number" ? r.vote_average : null,
  };
}

export const getDiscoverTitles = createServerFn({ method: "GET" })
  .validator((data: { mediaType: DiscoverMediaType; sort: DiscoverSort; page?: number }) => data)
  .handler(async ({ data }): Promise<DiscoverTitle[]> => {
    const { mediaType, sort } = data;
    const page = data.page ?? 1;
    try {
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
      const json = await tmdbFetch<TmdbApiDiscoverResponse>(path);
      return (json.results ?? [])
        .filter((r) => r.poster_path)
        .map((r) => mapItem(mediaType, r));
    } catch {
      return [];
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

const ALLOWED_VIDEO_TYPES = ["Trailer", "Teaser", "Clip", "Featurette"];

export const getTmdbVideos = createServerFn({ method: "GET" })
  .validator((data: { id: number; mediaType: DiscoverMediaType }) => data)
  .handler(async ({ data }): Promise<TmdbVideo[]> => {
    try {
      const json = await tmdbFetch<TmdbApiVideosResponse>(
        `/${data.mediaType}/${data.id}/videos`,
      );
      return (json.results ?? [])
        .filter((v) => v.site === "YouTube" && v.key && ALLOWED_VIDEO_TYPES.includes(v.type ?? ""))
        .map((v) => ({ key: v.key as string, name: v.name ?? "", type: v.type ?? "" }));
    } catch {
      return [];
    }
  });
