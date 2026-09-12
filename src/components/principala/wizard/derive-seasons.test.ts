import { describe, it, expect } from "vitest";

import { deriveSeasonRows, deriveBulkPlan, type DeriveSeasonsInput } from "./derive-seasons";
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
  return { t720: [], t1080: torrents, t4k: [], t4kHdr: [] };
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

describe("deriveBulkPlan", () => {
  const aired = (n: number) => ({
    episodeNum: n,
    title: `E${n}`,
    aired: true,
    airDate: "2026-01-01",
  });

  it("preferă pachetul de sezon când există", () => {
    const rows = deriveSeasonRows(
      input({
        seasons: [{ seasonNumber: 2, episodeCount: 2 }],
        seasonSchema: [{ seasonNumber: 2, episodes: [aired(1), aired(2)] }],
        seasonGroups: [
          {
            seasonNum: 2,
            byQuality: qualitySet([torrent("S02.PACK")]),
            episodes: new Map([[1, qualitySet([torrent("S02E01")])]]),
          },
        ],
      } as unknown as Partial<DeriveSeasonsInput>),
    );
    const plan = deriveBulkPlan(rows);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ isSeasonPack: true, season: 2 });
  });

  it("cade pe episoade individuale când nu există pachet", () => {
    const rows = deriveSeasonRows(
      input({
        seasons: [{ seasonNumber: 1, episodeCount: 2 }],
        seasonSchema: [{ seasonNumber: 1, episodes: [aired(1), aired(2)] }],
        seasonGroups: [
          {
            seasonNum: 1,
            byQuality: qualitySet(),
            episodes: new Map([
              [1, qualitySet([torrent("S01E01")])],
              [2, qualitySet([torrent("S01E02")])],
            ]),
          },
        ],
      } as unknown as Partial<DeriveSeasonsInput>),
    );
    const plan = deriveBulkPlan(rows);
    expect(plan.map((p) => p.label)).toEqual(["S01E01", "S01E02"]);
  });

  it("sare peste un sezon complet în Plex", () => {
    const rows = deriveSeasonRows(
      input({
        seasons: [{ seasonNumber: 1, episodeCount: 2 }],
        seasonSchema: [{ seasonNumber: 1, episodes: [aired(1), aired(2)] }],
        plexBySeason: new Map([
          [
            1,
            [
              { num: 1, quality: "1080p", watched: true },
              { num: 2, quality: "1080p", watched: false },
            ],
          ],
        ]),
        seasonGroups: [
          { seasonNum: 1, byQuality: qualitySet([torrent("S01.PACK")]), episodes: new Map() },
        ],
      } as unknown as Partial<DeriveSeasonsInput>),
    );
    expect(deriveBulkPlan(rows)).toEqual([]);
  });

  it("nu propune nimic pentru episoade nelansate", () => {
    const rows = deriveSeasonRows(input({ seasons: [{ seasonNumber: 9, episodeCount: 3 }] }));
    expect(deriveBulkPlan(rows)).toEqual([]);
  });
});
