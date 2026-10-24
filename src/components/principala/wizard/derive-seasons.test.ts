import { describe, it, expect } from "vitest";

import { deriveSeasonRows, type DeriveSeasonsInput } from "./derive-seasons";
import type { FilelistTorrent } from "@/lib/filelist.functions";
import type { DownloadingMediaEntry } from "@/lib/media/media.functions";

// Numele trebuie să conțină marcajul de calitate: `matchesForQuality`
// redetectează calitatea din numele lansării, chiar dacă torrentul vine deja
// dintr-un grup pe calitate (gruparea se face tot după nume, deci filtrarea
// dublă e consistentă — dar un nume fără marcaj cade printre ambele).
function torrent(name: string, seeders = 10): FilelistTorrent {
  return { id: seeders, name: `${name}.1080p.WEB-DL.x264`, seeders } as unknown as FilelistTorrent;
}

// Fixture-urile sunt parțiale intenționat: `deriveSeasonRows` citește doar
// season/episode/isSeasonPack dintr-o intrare de descărcare, nu tot obiectul.
function downloading(season: number, episode: number | null, isSeasonPack = false) {
  return { season, episode, isSeasonPack } as unknown as DownloadingMediaEntry;
}

function qualitySet(torrents: FilelistTorrent[] = []) {
  return { t720: [], t1080: torrents, t1080Hdr: [], t4k: [], t4kHdr: [] };
}

function input(over: Partial<DeriveSeasonsInput> = {}): DeriveSeasonsInput {
  return {
    seasons: [{ seasonNumber: 1, episodeCount: 2 }],
    seasonSchema: [],
    seasonGroups: [],
    plexBySeason: new Map(),
    downloadingEntries: [],
    tvmazeAirstamps: [],
    quality: "1080p",
    ...over,
  } as DeriveSeasonsInput;
}

// Funcția asta decide, pentru fiecare episod, exact una din stările posibile
// — și de ea depinde ce buton ți se oferă pe ecran. Ordinea ramurilor e
// esențială: o inversare ar ascunde un episod deja disponibil sub un „încă
// nelansat", sau ar oferi o descărcare pentru ceva ce ai deja.
describe("deriveSeasonRows — starea fiecărui episod", () => {
  it("„în Plex” are prioritate absolută, chiar dacă există torrent", () => {
    const rows = deriveSeasonRows(
      input({
        plexBySeason: new Map([[1, [{ num: 1, quality: "1080p", watched: false }]]]),
        seasonGroups: [
          {
            seasonNum: 1,
            byQuality: qualitySet(),
            episodes: new Map([[1, qualitySet([torrent("S01E01")])]]),
          },
        ],
      } as Partial<DeriveSeasonsInput>),
    );
    expect(rows[0].episodes[0].availability).toEqual({ kind: "in_plex", quality: "1080p" });
  });

  it("„se descarcă” bate disponibilitatea unui torrent", () => {
    const rows = deriveSeasonRows(
      input({
        downloadingEntries: [downloading(1, 1)],
        seasonGroups: [
          {
            seasonNum: 1,
            byQuality: qualitySet(),
            episodes: new Map([[1, qualitySet([torrent("S01E01")])]]),
          },
        ],
      } as Partial<DeriveSeasonsInput>),
    );
    expect(rows[0].episodes[0].availability.kind).toBe("downloading");
  });

  it("un pachet în curs marchează tot sezonul ca în descărcare", () => {
    const rows = deriveSeasonRows(
      input({
        seasons: [{ seasonNumber: 1, episodeCount: 3 }],
        seasonSchema: [
          {
            seasonNumber: 1,
            episodes: [1, 2, 3].map((n) => ({
              episodeNum: n,
              title: `E${n}`,
              aired: true,
              airDate: "2026-01-01",
            })),
          },
        ],
        downloadingEntries: [downloading(1, null, true)],
      } as unknown as Partial<DeriveSeasonsInput>),
    );
    expect(rows[0].episodes.every((e) => e.availability.kind === "downloading")).toBe(true);
    // Pachetul deja în curs nu se mai oferă a doua oară.
    expect(rows[0].packTorrents).toEqual([]);
    expect(rows[0].packDownloading).toBe(true);
  });

  it("episodul nedifuzat încă apare ca „nelansat”, cu data lui", () => {
    const rows = deriveSeasonRows(
      input({
        seasons: [{ seasonNumber: 1, episodeCount: 1 }],
        seasonSchema: [
          {
            seasonNumber: 1,
            episodes: [{ episodeNum: 1, title: "E1", aired: false, airDate: "2026-12-01" }],
          },
        ],
      } as unknown as Partial<DeriveSeasonsInput>),
    );
    expect(rows[0].episodes[0].availability).toMatchObject({
      kind: "upcoming",
      airDate: "2026-12-01",
    });
  });

  it("un episod nedifuzat la TMDB, dar deja pe Filelist, se oferă la descărcare", () => {
    // Inversarea ordinii ramurilor ar ascunde aici o descărcare posibilă sub
    // un „încă nelansat" — TMDB se înșală des pe datele de difuzare.
    const rows = deriveSeasonRows(
      input({
        seasons: [{ seasonNumber: 1, episodeCount: 1 }],
        seasonSchema: [
          {
            seasonNumber: 1,
            episodes: [{ episodeNum: 1, title: "E1", aired: false, airDate: "2026-12-01" }],
          },
        ],
        seasonGroups: [
          {
            seasonNum: 1,
            byQuality: qualitySet(),
            episodes: new Map([[1, qualitySet([torrent("S01E01")])]]),
          },
        ],
      } as unknown as Partial<DeriveSeasonsInput>),
    );
    expect(rows[0].episodes[0].availability.kind).toBe("episode_torrent");
  });

  it("un sezon fără nicio urmă sintetizează sloturi „nelansat”, nu un ecran gol", () => {
    const rows = deriveSeasonRows(input({ seasons: [{ seasonNumber: 5, episodeCount: 4 }] }));
    expect(rows[0].episodes).toHaveLength(4);
    expect(rows[0].episodes.every((e) => e.availability.kind === "upcoming")).toBe(true);
  });

  it("episodul existent doar în pachet e marcat ca atare, nu ca indisponibil", () => {
    const rows = deriveSeasonRows(
      input({
        seasons: [{ seasonNumber: 1, episodeCount: 1 }],
        seasonSchema: [
          {
            seasonNumber: 1,
            episodes: [{ episodeNum: 1, title: "E1", aired: true, airDate: "2026-01-01" }],
          },
        ],
        seasonGroups: [
          { seasonNum: 1, byQuality: qualitySet([torrent("S01.PACK")]), episodes: new Map() },
        ],
      } as unknown as Partial<DeriveSeasonsInput>),
    );
    expect(rows[0].episodes[0].availability.kind).toBe("pack_only");
  });
});

describe("deriveSeasonRows — alte calități", () => {
  const aired = (n: number) => ({
    episodeNum: n,
    title: `E${n}`,
    aired: true,
    airDate: "2026-01-01",
  });
  const uhd = {
    id: 7,
    name: "Show.S01.2160p.WEB-DL.DV.HDR.H.265",
    seeders: 9,
  } as unknown as FilelistTorrent;

  it("arată calitățile la care există sezonul, când lipsește la cea aleasă", () => {
    const rows = deriveSeasonRows(
      input({
        seasonSchema: [{ seasonNumber: 1, episodes: [aired(1), aired(2)] }],
        seasonGroups: [
          {
            seasonNum: 1,
            byQuality: { t720: [], t1080: [], t1080Hdr: [], t4k: [], t4kHdr: [uhd] },
            episodes: new Map(),
          },
        ],
      } as unknown as Partial<DeriveSeasonsInput>),
    );
    expect(rows[0].episodes[0].availability.kind).toBe("unavailable");
    expect(rows[0].otherQualities).toEqual(["4K HDR"]);
  });

  it("nimic, când tot ce lipsește e disponibil la calitatea aleasă", () => {
    const rows = deriveSeasonRows(
      input({
        seasonSchema: [{ seasonNumber: 1, episodes: [aired(1)] }],
        seasonGroups: [
          { seasonNum: 1, byQuality: qualitySet([torrent("S01.PACK")]), episodes: new Map() },
        ],
      } as unknown as Partial<DeriveSeasonsInput>),
    );
    expect(rows[0].otherQualities).toEqual([]);
  });

  it("nu numără episoadele care nu lipsesc", () => {
    const sd = (n: number) =>
      ({
        id: 100 + n,
        name: `Show.S01E0${n}.720p.WEB-DL.x264`,
        seeders: 9,
      }) as unknown as FilelistTorrent;
    const rows = deriveSeasonRows(
      input({
        seasonSchema: [{ seasonNumber: 1, episodes: [aired(1), aired(2)] }],
        plexBySeason: new Map([[1, [{ num: 1, quality: "1080p", watched: false }]]]),
        seasonGroups: [
          {
            seasonNum: 1,
            byQuality: qualitySet(),
            episodes: new Map([
              [1, { t720: [sd(1)], t1080: [], t1080Hdr: [], t4k: [], t4kHdr: [] }],
            ]),
          },
        ],
      } as unknown as Partial<DeriveSeasonsInput>),
    );
    expect(rows[0].episodes[1].availability.kind).toBe("unavailable");
    expect(rows[0].otherQualities).toEqual([]);
  });
});
