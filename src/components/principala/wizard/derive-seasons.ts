// Transformarea datelor brute (TMDB + Plex + Filelist + TVMaze) în rândurile
// afișate de acordeonul de sezoane.
//
// Pure, fără React: intră date, ies date. Stăteau în corpul componentei, unde
// nu puteau fi verificate decât randând tot wizard-ul — deși aici se decide
// exact ce ți se oferă pe ecran pentru fiecare episod.

import { emptyQualitySet } from "@/components/filelist/quality-utils";
import type { SeasonGroup } from "@/components/filelist/types";
import type { TmdbSeasonSchema } from "@/lib/tmdb/tmdb.functions";
import type { TvmazeAirstamp } from "@/lib/tvmaze/tvmaze.functions";
import type { DownloadingMediaEntry } from "@/lib/media/media.functions";
import type { EpisodeAvailability, SeasonRowData } from "./SeasonAccordion";
import { matchesForQuality, otherQualitiesWhere, pickFromSet } from "./selection";
import type { PlexSeasonEpisode, Quality } from "./types";

export interface DeriveSeasonsInput {
  seasons: Array<{ seasonNumber: number; episodeCount: number }>;
  seasonSchema: TmdbSeasonSchema[];
  seasonGroups: SeasonGroup[];
  plexBySeason: Map<number, PlexSeasonEpisode[]>;
  downloadingEntries: DownloadingMediaEntry[];
  tvmazeAirstamps: TvmazeAirstamp[];
  quality: Quality;
}

export function deriveSeasonRows(input: DeriveSeasonsInput): SeasonRowData[] {
  const {
    seasons,
    seasonSchema,
    seasonGroups,
    plexBySeason,
    downloadingEntries,
    tvmazeAirstamps,
    quality,
  } = input;

  return seasons.map((s) => {
    const schema = seasonSchema.find((x) => x.seasonNumber === s.seasonNumber);
    const group = seasonGroups.find((g) => g.seasonNum === s.seasonNumber);
    const plexMap = new Map((plexBySeason.get(s.seasonNumber) ?? []).map((e) => [e.num, e]));
    const packCandidates = group
      ? matchesForQuality(pickFromSet(group.byQuality, quality), quality, "tv")
      : [];
    const packDownloadingEntry = downloadingEntries.find(
      (e) => e.season === s.seasonNumber && e.isSeasonPack,
    );

    const tmdbEpisodes = schema?.episodes ?? [];
    const airstampMap = new Map(
      tvmazeAirstamps
        .filter((a) => a.seasonNumber === s.seasonNumber)
        .map((a) => [a.episodeNum, a.airstamp]),
    );
    const filelistEpNums = Array.from(group?.episodes.keys() ?? []).sort((a, b) => a - b);
    // Sezon complet fără nicio urmă nicăieri (nici TMDB, nici Filelist, nici
    // pachet) — anunțat doar cu un număr de episoade planificate
    // (episodeCount din rezumatul serialului). Sintetizăm acele "sloturi" ca
    // nelansate, fără dată — altfel sezonul ar arăta gol/"—", indistigabil de
    // o eroare, deși chiar urmează să apară. Dacă există fie episoade TMDB,
    // fie ceva pe Filelist (episoade sau pachet), NU sintetizăm nimic —
    // folosim datele reale, ca să nu ascundem un pachet deja disponibil sub
    // un fals "nelansat".
    const seasonHasNoData =
      tmdbEpisodes.length === 0 && filelistEpNums.length === 0 && packCandidates.length === 0;
    const episodeNums =
      tmdbEpisodes.length > 0
        ? tmdbEpisodes.map((e) => e.episodeNum)
        : filelistEpNums.length > 0
          ? filelistEpNums
          : seasonHasNoData
            ? Array.from({ length: s.episodeCount }, (_, i) => i + 1)
            : [];

    const episodes = episodeNums.map((epNum) => {
      const tmdbEp = tmdbEpisodes.find((e) => e.episodeNum === epNum);
      const plexEp = plexMap.get(epNum);
      const title = tmdbEp?.title ?? `Episodul ${epNum}`;
      const episodeDownloading = downloadingEntries.some(
        (e) => e.season === s.seasonNumber && e.episode === epNum && !e.isSeasonPack,
      );

      const epCandidates = matchesForQuality(
        pickFromSet(group?.episodes.get(epNum) ?? emptyQualitySet(), quality),
        quality,
        "tv",
      );

      // Ordinea contează: prima stare adevărată câștigă. "În Plex" bate
      // orice, "se descarcă" bate disponibilitatea, iar "nelansat" se
      // verifică abia la final, ca un episod deja apărut pe Filelist să nu
      // fie ascuns sub o dată de difuzare viitoare.
      let availability: EpisodeAvailability;
      if (plexEp) {
        availability = { kind: "in_plex", quality: plexEp.quality };
      } else if (packDownloadingEntry || episodeDownloading) {
        availability = { kind: "downloading" };
      } else if (epCandidates.length > 0) {
        availability = { kind: "episode_torrent", torrents: epCandidates };
      } else if (packCandidates.length > 0) {
        availability = { kind: "pack_only" };
      } else if (tmdbEp && !tmdbEp.aired) {
        availability = {
          kind: "upcoming",
          airDate: tmdbEp.airDate,
          airStamp: airstampMap.get(epNum) ?? null,
        };
      } else if (!tmdbEp && seasonHasNoData) {
        availability = {
          kind: "upcoming",
          airDate: null,
          airStamp: airstampMap.get(epNum) ?? null,
        };
      } else {
        availability = { kind: "unavailable" };
      }
      return { episodeNum: epNum, title, availability };
    });

    // Episoade lipsă fără niciun torrent la calitatea aleasă: dacă exact
    // ele (sau pachetul sezonului) există la alta, o spunem — altfel
    // „Indisponibil" ar părea definitiv. Doar episoadele lipsă contează: un
    // E01 la 720p nu ajută când lipsesc E09–E10.
    const missingNums = episodes
      .filter((e) => e.availability.kind === "unavailable")
      .map((e) => e.episodeNum);
    const otherQualities =
      group && missingNums.length > 0
        ? otherQualitiesWhere(
            quality,
            (q) =>
              matchesForQuality(pickFromSet(group.byQuality, q), q, "tv").length > 0 ||
              missingNums.some((n) => {
                const set = group.episodes.get(n);
                return !!set && matchesForQuality(pickFromSet(set, q), q, "tv").length > 0;
              }),
          )
        : [];

    return {
      seasonNumber: s.seasonNumber,
      packTorrents: packDownloadingEntry ? [] : packCandidates,
      packDownloading: !!packDownloadingEntry,
      episodes,
      otherQualities,
    };
  });
}
