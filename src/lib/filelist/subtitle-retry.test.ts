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
  } = {},
) {
  db.prepare(
    `INSERT INTO media (media_type, title, season, episode, torrent_name, torrent_hash,
                        completed_at, has_romanian_subtitle, has_romanian_audio, subtitle_checked_at)
     VALUES ('episode', 'Serial', 1, ?, ?, ?, datetime('now', ?), ?, ?,
             CASE WHEN ? IS NULL THEN NULL ELSE datetime('now', ?) END)`,
  ).run(
    o.episode ?? 1,
    `Serial.S01E0${o.episode ?? 1}`,
    hash,
    `-${o.completedDaysAgo ?? 1} days`,
    o.ro ?? 0,
    o.audioRo ?? 0,
    o.checkedHoursAgo === undefined ? 30 : o.checkedHoursAgo,
    `-${o.checkedHoursAgo ?? 30} hours`,
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

  it("descărcat acum peste 14 zile: renunță", () => {
    add("a", { completedDaysAgo: 15 });
    expect(due()).toEqual([]);
  });

  it("un pachet de sezon apare o singură dată", () => {
    add("p", { episode: 1 });
    add("p", { episode: 2 });
    expect(due()).toEqual(["p"]);
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
    updateMediaSubtitleStatus("a", "downloaded", "de pe subs.ro", "subsro");
    updateMediaSubtitleStatus("a", "srt_already_ok", "are deja .srt");
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
    updateMediaSubtitleStatus("a", "srt_already_ok", "are deja .srt");
    expect(source()).toBe("tracked_srt");
  });
});
