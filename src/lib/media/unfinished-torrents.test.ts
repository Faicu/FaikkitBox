import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Testul rulează pe o bază SQLite reală, temporară — nu pe mock-uri. Ce
// verificăm aici e un SELECT cu patru filtre, iar un mock de DB ar testa
// mock-ul, nu interogarea. `FAIKKITBOX_DB_PATH` trebuie setat ÎNAINTE de
// import: getDb() citește calea la prima chemare și apoi ține conexiunea în
// cache, deci un import static de sus ar deschide baza de producție.
const dir = mkdtempSync(join(tmpdir(), "faikkitbox-test-"));
process.env.FAIKKITBOX_DB_PATH = join(dir, "test.db");

type MediaModule = typeof import("./media");
type DbModule = typeof import("../db");

let media: MediaModule;
let db: ReturnType<DbModule["getDb"]>;

// Un rând `media` minimal, cu doar câmpurile care contează pentru interogare.
// `added_at` primește implicit datetime('now') din schemă — îl suprascriem
// explicit acolo unde vechimea e chiar subiectul testului.
function insertMedia(row: {
  title: string;
  hash: string | null;
  completedAt?: string | null;
  plexKey?: string | null;
  addedAt?: string;
  mediaType?: string;
  category?: number | null;
  imdb?: string | null;
}): void {
  db.prepare(
    `INSERT INTO media (media_type, title, torrent_name, torrent_hash, category, imdb_id,
                        completed_at, plex_rating_key, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
  ).run(
    row.mediaType ?? "movie",
    row.title,
    row.title,
    row.hash,
    row.category === undefined ? 1 : row.category,
    row.imdb ?? null,
    row.completedAt ?? null,
    row.plexKey ?? null,
    row.addedAt ?? null,
  );
}

beforeAll(async () => {
  media = await import("./media");
  db = (await import("../db")).getDb();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

// De ce contează interogarea asta: pe ea se sprijină singură reluarea
// polling-ului după un restart (server/plugins/filelist-resume.ts). Dacă
// ratează un torrent, acela se termină în qBittorrent, dar aplicația nu află
// niciodată — fără subtitrare, fără completed_at, fără notificare, fără
// legare la Plex, și complet tăcut. Dacă, invers, întoarce prea mult,
// pornește bucle de polling pentru torrente care nu mai există.
describe("listUnfinishedTorrents", () => {
  it("întoarce o descărcare în curs", () => {
    insertMedia({ title: "Film în curs", hash: "aaa", imdb: "tt1" });

    const result = media.listUnfinishedTorrents();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ torrentHash: "aaa", imdbId: "tt1", isMovie: true });
  });

  it("nu întoarce descărcările deja terminate", () => {
    insertMedia({ title: "Film gata", hash: "bbb", completedAt: "2026-09-01 10:00:00" });

    expect(media.listUnfinishedTorrents().map((r) => r.torrentHash)).not.toContain("bbb");
  });

  it("nu întoarce rândurile deja legate la Plex, chiar fără completed_at", () => {
    // Exact cele 77 de rânduri lăsate de backfill-ul Plex din 15 august: au
    // hash, n-au completed_at, dar titlul e demult pe disc și indexat. Fără
    // filtrul pe plex_rating_key, fiecare pornire relua polling-ul pentru
    // torrente care nu mai există în qBittorrent.
    insertMedia({ title: "Backfill Plex", hash: "ccc", plexKey: "12345" });

    expect(media.listUnfinishedTorrents().map((r) => r.torrentHash)).not.toContain("ccc");
  });

  it("nu întoarce descărcări mai vechi de 48h", () => {
    // Fereastra în care pollUntilComplete renunță oricum — un torrent
    // abandonat săptămâna trecută n-are ce relua.
    insertMedia({ title: "Abandonat", hash: "ddd", addedAt: "2026-01-01 00:00:00" });

    expect(media.listUnfinishedTorrents().map((r) => r.torrentHash)).not.toContain("ddd");
  });

  it("ignoră rândurile fără torrent_hash", () => {
    // Rândul-părinte al unui serial (ensureMediaPlaceholder) are prin
    // construcție hash NULL — nu e o descărcare, n-are ce urmări.
    insertMedia({ title: "Serial părinte", hash: null, mediaType: "tv_show" });

    expect(media.listUnfinishedTorrents().every((r) => r.torrentHash)).toBe(true);
  });

  it("dă un singur rând pentru un pachet de sezon, nu unul per episod", () => {
    // Cazul care a motivat gruparea: 12 episoade cu același hash înseamnă un
    // singur torrent și o singură buclă de polling. Înainte, reluarea pornea
    // 12 bucle identice pe același torrent.
    for (let ep = 1; ep <= 12; ep++) {
      insertMedia({ title: `Pachet S01E${ep}`, hash: "pack", mediaType: "episode", category: 21 });
    }

    const forPack = media.listUnfinishedTorrents().filter((r) => r.torrentHash === "pack");
    expect(forPack).toHaveLength(1);
    expect(forPack[0].isMovie).toBe(false);
  });

  it("marchează ca film pachetul în care măcar un rând e film", () => {
    // isMovie e fallback-ul pentru cazul în care categoria Filelist lipsește;
    // media_type e mereu populat, deci el decide biblioteca Plex de rescanat.
    insertMedia({ title: "Film fără categorie", hash: "eee", category: null });

    const row = media.listUnfinishedTorrents().find((r) => r.torrentHash === "eee");
    expect(row?.isMovie).toBe(true);
    expect(row?.category).toBeNull();
  });
});

// Garda de finalizare: dacă nu e atomică, o descărcare prinsă de un restart
// ajunge la 100% în două bucle simultan (cea originală și cea reluată) și
// trimite două notificări, rulează de două ori pipeline-ul de subtitrări.
describe("markMediaCompleted", () => {
  it("întoarce true o singură dată pentru același torrent", () => {
    insertMedia({ title: "Cursă", hash: "race" });

    expect(media.markMediaCompleted("race")).toBe(true);
    expect(media.markMediaCompleted("race")).toBe(false);
  });

  it("marchează toate episoadele unui pachet dintr-o singură chemare", () => {
    for (let ep = 1; ep <= 3; ep++) {
      insertMedia({ title: `Pachet2 E${ep}`, hash: "pack2", mediaType: "episode" });
    }

    expect(media.markMediaCompleted("pack2")).toBe(true);

    const left = db
      .prepare(
        "SELECT COUNT(*) AS c FROM media WHERE torrent_hash = 'pack2' AND completed_at IS NULL",
      )
      .get() as { c: number };
    expect(left.c).toBe(0);
  });

  it("întoarce false pentru un hash necunoscut", () => {
    expect(media.markMediaCompleted("nu-exista")).toBe(false);
  });
});
