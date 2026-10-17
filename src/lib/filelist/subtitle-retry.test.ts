import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Ce torrente reîncearcă zilnic subtitrarea, pe o bază SQLite temporară.
// Calea bazei se setează ÎNAINTE de orice import al lui db.ts.
const dir = mkdtempSync(join(tmpdir(), "faikkitbox-test-"));
const dbFile = join(dir, "test.db");
process.env.FAIKKITBOX_DB_PATH = dbFile;

let db: ReturnType<typeof import("../db").getDb>;
let retry: typeof import("./subtitle-retry");

beforeAll(async () => {
  db = (await import("../db")).getDb();
  if (db.location() !== dbFile) throw new Error(`Altă bază decât cea temporară: ${db.location()}`);
  retry = await import("./subtitle-retry");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => db.exec("DELETE FROM media"));

function add(
  hash: string,
  o: {
    completedDaysAgo?: number;
    ro?: 0 | 1;
    audioRo?: 0 | 1;
    checkedHoursAgo?: number | null;
    episode?: number;
    approximate?: 0 | 1;
  } = {},
) {
  db.prepare(
    `INSERT INTO media (media_type, title, season, episode, torrent_name, torrent_hash,
                        completed_at, has_romanian_subtitle, has_romanian_audio, subtitle_checked_at,
                        subtitle_approximate)
     VALUES ('episode', 'Serial', 1, ?, ?, ?, datetime('now', ?), ?, ?,
             CASE WHEN ? IS NULL THEN NULL ELSE datetime('now', ?) END, ?)`,
  ).run(
    o.episode ?? 1,
    `Serial.S01E0${o.episode ?? 1}`,
    hash,
    `-${o.completedDaysAgo ?? 1} days`,
    o.ro ?? 0,
    o.audioRo ?? 0,
    o.checkedHoursAgo === undefined ? 30 : o.checkedHoursAgo,
    `-${o.checkedHoursAgo ?? 30} hours`,
    o.approximate ?? 0,
  );
}
const due = () => retry.listTorrentsDueForSubtitleRetry().map((t) => t.torrent_hash);

describe("listTorrentsDueForSubtitleRetry", () => {
  it("fără subtitrare, verificat acum 30h, descărcat ieri: reîncearcă", () => {
    add("a");
    expect(due()).toEqual(["a"]);
  });

  it("verificat de curând: așteaptă ziua următoare", () => {
    add("a", { checkedHoursAgo: 5 });
    expect(due()).toEqual([]);
  });

  it("niciodată verificat: reîncearcă", () => {
    add("a", { checkedHoursAgo: null });
    expect(due()).toEqual(["a"]);
  });

  it("are subtitrare sau audio în română: nu", () => {
    add("a", { ro: 1 });
    add("b", { audioRo: 1 });
    expect(due()).toEqual([]);
  });

  it("subtitrare aproximativă: reîncearcă, ca s-o înlocuiască (cu has_ro=1)", () => {
    add("a", { ro: 1, approximate: 1 });
    expect(retry.listTorrentsDueForSubtitleRetry()).toMatchObject([
      { torrent_hash: "a", has_ro: 1 },
    ]);
  });

  it("descărcat acum peste 14 zile: renunță", () => {
    add("a", { completedDaysAgo: 15 });
    expect(due()).toEqual([]);
  });

  it("un pachet de sezon apare o singură dată", () => {
    add("p", { episode: 1 });
    add("p", { episode: 2 });
    expect(due()).toEqual(["p"]);
  });

  it("un pachet cu un singur episod fără subtitrare: reîncearcă", () => {
    add("p", { episode: 1, ro: 1 });
    add("p", { episode: 2 });
    expect(due()).toEqual(["p"]);
  });
});

describe("approximateEpisodeKeys", () => {
  it("la un pachet, doar episoadele aproximative se reverifică", () => {
    add("p", { episode: 1, ro: 1, approximate: 1 });
    add("p", { episode: 2, ro: 1 });
    add("p", { episode: 3, ro: 1, approximate: 1 });
    expect([...(retry.approximateEpisodeKeys("p") ?? [])].sort()).toEqual(["S01E01", "S01E03"]);
    expect(retry.approximateEpisodeKeys("altul")).toBeUndefined();
  });
});

describe("updateMediaSubtitleStatus — reverificare fără schimbări", () => {
  const source = () =>
    (
      db.prepare("SELECT subtitle_source FROM media WHERE torrent_hash = 'a'").get() as {
        subtitle_source: string | null;
      }
    ).subtitle_source;

  it("păstrează sursa de la descărcare (S.W.A.T. Exiles S01E01)", async () => {
    const { updateMediaSubtitleStatus } = await import("../media/media");
    add("a");
    updateMediaSubtitleStatus("a", {
      outcome: "downloaded",
      detail: "de pe subs.ro",
      source: "subsro",
    });
    updateMediaSubtitleStatus("a", { outcome: "srt_already_ok", detail: "are deja .srt" });
    expect(source()).toBe("subsro");
    expect(
      (
        db.prepare("SELECT subtitle_detail FROM media WHERE torrent_hash = 'a'").get() as {
          subtitle_detail: string;
        }
      ).subtitle_detail,
    ).toBe("de pe subs.ro");
  });

  it("fără sursă înregistrată, rămâne „.srt din torrent”", async () => {
    const { updateMediaSubtitleStatus } = await import("../media/media");
    add("a");
    updateMediaSubtitleStatus("a", { outcome: "srt_already_ok", detail: "are deja .srt" });
    expect(source()).toBe("tracked_srt");
  });
});

describe("updateMediaSubtitleStatus — pachet de sezon", () => {
  const file = (episode: string, outcome: string, source: "subsro" | null) => ({
    torrent: "Serial.S01",
    episode,
    outcome: outcome as never,
    source,
    release: source ? `Serial.${episode}.WEB` : null,
    matchedCriteria: null,
    maxCriteria: null,
    syncScore: null,
    syncOffset: null,
    syncGood: null,
    compared: null,
    movedAside: null,
    replacedApproximate: false,
  });
  const rows = () =>
    db
      .prepare(
        `SELECT episode, has_romanian_subtitle AS ro, subtitle_source AS source,
                subtitle_detail AS detail, subtitle_report AS report
           FROM media WHERE torrent_hash = 'p' ORDER BY episode`,
      )
      .all() as unknown as Array<{
      episode: number;
      ro: number;
      source: string | null;
      detail: string;
      report: string | null;
    }>;

  it("fiecare episod primește rezultatul lui, nu agregatul sezonului", async () => {
    const { updateMediaSubtitleStatus } = await import("../media/media");
    add("p", { episode: 1 });
    add("p", { episode: 2 });
    add("p", { episode: 3 });
    updateMediaSubtitleStatus("p", {
      outcome: "season_corrected",
      detail: "3 episoade — agregat",
      files: [file("S01E01", "downloaded", "subsro"), file("S01E02", "no_subtitle_found", null)],
      rejected: [
        {
          torrent: "Serial.S01",
          episode: "S01E02",
          source: "opensubtitles",
          release: "x",
          reason: "nu e în română",
        },
      ],
      episodeDetails: { S01E01: "descărcată de pe subs.ro", S01E02: "nicio variantă" },
    });
    const [e1, e2, e3] = rows();
    expect([e1.ro, e1.source, e1.detail]).toEqual([1, "subsro", "descărcată de pe subs.ro"]);
    expect(JSON.parse(e1.report!).rejected).toEqual([]);
    expect([e2.ro, e2.source, e2.detail]).toEqual([0, null, "nicio variantă"]);
    expect(JSON.parse(e2.report!).rejected).toHaveLength(1);
    // Fără raport propriu (episod nerecunoscut în pachet): agregatul, cu
    // raportul întregului pachet.
    expect([e3.ro, e3.source, e3.detail]).toEqual([1, "season_aggregate", "3 episoade — agregat"]);
    expect(JSON.parse(e3.report!).files).toHaveLength(2);
  });

  it("episoadele create din placeholder primesc partea lor din raportul pachetului", async () => {
    const { updateMediaSubtitleStatus, episodeSubtitleState } = await import("../media/media");
    add("p", { episode: 1 });
    updateMediaSubtitleStatus("p", {
      outcome: "season_corrected",
      detail: "agregat",
      files: [file("S01E07", "downloaded", "subsro"), file("S01E08", "no_subtitle_found", null)],
      rejected: [
        {
          torrent: "Serial.S01",
          episode: "S01E08",
          source: "opensubtitles",
          release: "x",
          reason: "nu e în română",
        },
      ],
      episodeDetails: { S01E07: "de pe subs.ro", S01E08: "nicio variantă" },
    });
    const pack = db
      .prepare("SELECT * FROM media WHERE torrent_hash = 'p'")
      .get() as unknown as Parameters<typeof episodeSubtitleState>[0];
    expect(episodeSubtitleState(pack, 1, 7)).toMatchObject({
      hasRo: 1,
      source: "subsro",
      detail: "de pe subs.ro",
    });
    const e8 = episodeSubtitleState(pack, 1, 8);
    expect([e8.hasRo, e8.source, e8.detail]).toEqual([0, null, "nicio variantă"]);
    expect(JSON.parse(e8.report!).rejected).toHaveLength(1);
    // Episod absent din raport: moștenește starea pachetului.
    expect(episodeSubtitleState(pack, 1, 9)).toMatchObject({ detail: "agregat", report: null });
  });

  it("reverificarea fără schimbări păstrează sursa, detaliul și raportul episodului", async () => {
    const { updateMediaSubtitleStatus } = await import("../media/media");
    add("p", { episode: 1 });
    updateMediaSubtitleStatus("p", {
      outcome: "season_corrected",
      detail: "agregat",
      files: [file("S01E01", "downloaded", "subsro")],
      episodeDetails: { S01E01: "de pe subs.ro" },
    });
    const before = rows()[0];
    updateMediaSubtitleStatus("p", {
      outcome: "season_already_ok",
      detail: "agregat nou",
      files: [file("S01E01", "srt_already_ok", null)],
      episodeDetails: { S01E01: "are deja .srt" },
    });
    expect(rows()[0]).toEqual(before);
  });
});

describe("updateMediaSubtitleStatus — subtitle_approximate", () => {
  const approx = () =>
    (
      db.prepare("SELECT subtitle_approximate FROM media WHERE torrent_hash = 'a'").get() as {
        subtitle_approximate: number;
      }
    ).subtitle_approximate;

  it("se setează la o descărcare aproximativă, rămâne la reverificare, se șterge la înlocuire", async () => {
    const { updateMediaSubtitleStatus } = await import("../media/media");
    add("a");
    updateMediaSubtitleStatus("a", {
      outcome: "downloaded_approximate",
      detail: "aproximativă",
      source: "subsro",
    });
    expect(approx()).toBe(1);
    updateMediaSubtitleStatus("a", { outcome: "srt_already_ok", detail: "rămâne" });
    expect(approx()).toBe(1);
    updateMediaSubtitleStatus("a", { outcome: "downloaded", detail: "exactă", source: "subsro" });
    expect(approx()).toBe(0);
  });
});

describe("getSubtitleRetryStatus", () => {
  it("în căutare (14 zile), încheiate fără subtitrare, aproximativele doar cât durează căutarea", () => {
    add("a", { completedDaysAgo: 2, episode: 4 });
    add("b", { completedDaysAgo: 20, episode: 5 });
    add("c", { completedDaysAgo: 3, ro: 1, approximate: 1, episode: 6 });
    add("d", { completedDaysAgo: 20, ro: 1, approximate: 1, episode: 7 });
    add("e", { completedDaysAgo: 1, ro: 1, episode: 8 });
    const s = retry.getSubtitleRetryStatus();
    // Ordonate după cât mai au: cel care se încheie primul, primul.
    expect(s.searching.map((t) => [t.title, t.kind])).toEqual([
      ["Serial S01E06", "approximate"],
      ["Serial S01E04", "missing"],
    ]);
    expect(s.ended.map((t) => t.title)).toEqual(["Serial S01E05"]);
  });

  it("un pachet apare o singură dată, ca sezon", () => {
    add("p", { episode: 1 });
    add("p", { episode: 2 });
    db.prepare("UPDATE media SET is_season_pack = 1 WHERE torrent_hash = 'p'").run();
    expect(retry.getSubtitleRetryStatus().searching.map((t) => t.title)).toEqual([
      "Serial S01 (pachet)",
    ]);
  });
});
