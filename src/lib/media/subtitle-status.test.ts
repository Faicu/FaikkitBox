import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SubtitleFileReport } from "../filelist/subtitle-outcomes";

// Starea subtitrării în `media` după resincronizare și după o aproximativă
// păstrată, pe o bază SQLite temporară (calea setată înainte de db.ts).
const dir = mkdtempSync(join(tmpdir(), "faikkitbox-test-"));
const dbFile = join(dir, "test.db");
process.env.FAIKKITBOX_DB_PATH = dbFile;

let db: ReturnType<typeof import("../db").getDb>;
let media: typeof import("./media");

beforeAll(async () => {
  db = (await import("../db")).getDb();
  if (db.location() !== dbFile) throw new Error(`Altă bază decât cea temporară: ${db.location()}`);
  media = await import("./media");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => db.exec("DELETE FROM media"));

const file = (o: Partial<SubtitleFileReport>): SubtitleFileReport => ({
  torrent: "Film.2026.1080p.WEB-DL-GRP",
  episode: null,
  outcome: "downloaded_approximate",
  source: null,
  release: null,
  matchedCriteria: null,
  maxCriteria: null,
  syncScore: null,
  syncOffset: null,
  syncGood: null,
  compared: null,
  movedAside: null,
  replacedApproximate: false,
  ...o,
});

function addApproximateMovie() {
  const previous = file({
    source: "subsro",
    release: "WEB-DL Film.2026.2160p-LiVED",
    matchedCriteria: 1,
    maxCriteria: 5,
    syncScore: 0.56,
    syncOffset: -3.5,
    syncGood: false,
  });
  db.prepare(
    `INSERT INTO media (media_type, title, torrent_name, torrent_hash, has_romanian_subtitle,
                        subtitle_source, subtitle_detail, subtitle_approximate, subtitle_report)
     VALUES ('movie', 'Film', 'Film.2026.1080p.WEB-DL-GRP', 'h1', 1, 'subsro', 'aproximativă', 1, ?)`,
  ).run(JSON.stringify({ file: previous, rejected: [] }));
}

const row = () =>
  db
    .prepare(
      "SELECT has_romanian_subtitle, subtitle_source, subtitle_detail, subtitle_approximate, subtitle_report FROM media WHERE torrent_hash = 'h1'",
    )
    .get() as {
    has_romanian_subtitle: number;
    subtitle_source: string;
    subtitle_detail: string;
    subtitle_approximate: number;
    subtitle_report: string;
  };

describe("starea subtitrării", () => {
  it("resincronizarea păstrează sursa și release-ul, nu mai e aproximativă", () => {
    addApproximateMovie();
    const files = [
      file({ outcome: "retimed_srt", syncScore: 0.86, syncOffset: 0, syncGood: true }),
    ];
    media.fillRetimedSources("h1", files);
    expect(files[0].source).toBe("subsro");
    expect(files[0].release).toBe("WEB-DL Film.2026.2160p-LiVED");
    media.updateMediaSubtitleStatus("h1", {
      outcome: "retimed_srt",
      detail: "resincronizată",
      files,
    });
    const r = row();
    expect(r.subtitle_source).toBe("subsro");
    expect(r.subtitle_approximate).toBe(0);
    expect(r.subtitle_detail).toBe("resincronizată");
    expect(JSON.parse(r.subtitle_report).file.outcome).toBe("retimed_srt");
  });

  it("aproximativa păstrată nu schimbă nimic din stare", () => {
    addApproximateMovie();
    media.updateMediaSubtitleStatus("h1", {
      outcome: "approximate_kept",
      detail: "rămâne",
      files: [file({ outcome: "approximate_kept" })],
    });
    const r = row();
    expect(r.has_romanian_subtitle).toBe(1);
    expect(r.subtitle_approximate).toBe(1);
    expect(r.subtitle_detail).toBe("aproximativă");
    expect(JSON.parse(r.subtitle_report).file.outcome).toBe("downloaded_approximate");
  });
});
