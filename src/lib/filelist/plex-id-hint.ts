// ---------------------------------------------------------------------------
// ID-ul IMDb în numele fișierului, ca Plex să potrivească titlul din prima.
//
// Fără el, Plex ghicește titlul doar din numele lansării — și greșește când
// există un titlu asemănător: „S.W.A.T. Exiles" (2026) ajungea la „S.W.A.T."
// (2017), „Runner" (2026) devenea a doua versiune a lui „The Runner" (2026).
// Legarea din `media` caută după TMDB, deci rămânea pe „Se procesează în
// Plex" fără nicio eroare. Cu `{imdb-tt…}` în nume, agenții Plex (Plex Movie /
// Plex TV Series) iau direct titlul cu acel ID — testat pe 28 sept 2026:
// film și episod direct în rădăcină, episod într-un folder de pachet, episod
// nou al unui serial deja existent, plus subtitrarea `.ro.srt` cu același nume.
//
// Redenumirea trece prin API-ul qBittorrent (nu direct pe disc), ca torrentul
// să rămână complet și să continue seed-ul. Rulează la finalul descărcării,
// înainte de subtitrare (care ia numele din qBittorrent, deci îl vede pe cel
// nou) și de refresh-ul Plex.
// ---------------------------------------------------------------------------

import { basename, dirname, extname } from "node:path";
import { MEDIA_EXTENSIONS } from "./subtitle-checks";

const HAS_HINT_RE = /\{(?:imdb|tmdb|tvdb)-[^}]*\}/i;

export interface PlannedRename {
  oldPath: string;
  newPath: string;
}

function isVideo(name: string): boolean {
  return MEDIA_EXTENSIONS.includes(extname(name).toLowerCase());
}

function joinRel(dir: string, file: string): string {
  return dir === "." ? file : `${dir}/${file}`;
}

// Ce trebuie redenumit, pentru lista de fișiere a unui torrent (căi relative,
// ca în /torrents/files). Fiecare fișier video primește ` {imdb-tt…}` înainte
// de extensie; fișierele din același folder care îi poartă numele (subtitrări
// `X.en.srt`, `X.srt` din torrent) sunt redenumite la fel, altfel Plex nu le
// mai asociază cu video-ul. Folderele rămân neatinse. Idempotent: un fișier
// care are deja un indiciu de ID e sărit.
export function planPlexIdRenames(fileNames: string[], imdbId: string): PlannedRename[] {
  if (!/^tt\d+$/.test(imdbId)) return [];
  const hint = ` {imdb-${imdbId}}`;
  const renames: PlannedRename[] = [];
  const taken = new Set<string>();

  for (const name of fileNames) {
    if (!isVideo(name) || HAS_HINT_RE.test(name)) continue;
    // Mostrele nu intră în bibliotecă (Plex le ignoră); nu are rost să le atingem.
    if (/(^|[\\/._ -])sample([\\/._ -]|$)/i.test(name)) continue;

    const dir = dirname(name);
    const ext = extname(name);
    const base = basename(name, ext);
    renames.push({ oldPath: name, newPath: joinRel(dir, `${base}${hint}${ext}`) });
    taken.add(name);

    for (const other of fileNames) {
      if (taken.has(other) || isVideo(other) || dirname(other) !== dir) continue;
      const otherBase = basename(other);
      if (!otherBase.startsWith(`${base}.`)) continue;
      renames.push({
        oldPath: other,
        newPath: joinRel(dir, `${base}${hint}${otherBase.slice(base.length)}`),
      });
      taken.add(other);
    }
  }
  return renames;
}

// ID-ul IMDb de pus în nume, din `media` — doar pentru rânduri confirmate de
// TMDB (tmdb_id setat). Un rând scris cu numele lansării, fără identificare
// TMDB, poartă cel mult ID-ul de pe Filelist, neverificat: mai bine fără
// indiciu (Plex ghicește, ca înainte) decât cu unul greșit, pe care Plex l-ar
// urma fără ezitare. Pe episoade, imdb_id e al serialului — exact ce vrea Plex.
async function imdbIdForTorrent(torrentHash: string): Promise<string | null> {
  const { getDb } = await import("../db");
  const row = getDb()
    .prepare(
      `SELECT imdb_id FROM media
        WHERE torrent_hash = ? AND imdb_id IS NOT NULL AND tmdb_id IS NOT NULL
        LIMIT 1`,
    )
    .get(torrentHash) as { imdb_id: string } | undefined;
  return row?.imdb_id ?? null;
}

// qBittorrent confirmă redenumirea imediat, dar mută fișierul pe disc
// asincron. Pasul următor (subtitrarea) citește fișierul video cu ffprobe și
// scrie `.ro.srt` lângă el — dacă ajunge înaintea mutării, ar vedea un fișier
// lipsă (și ar descărca inutil o subtitrare peste una încorporată). Așteptăm
// deci să apară noile nume pe disc, cu o limită: la depășire, continuăm
// oricum, cu un avertisment.
async function waitForRenamesOnDisk(
  params: { qbitUrl: string; qbitUser: string; qbitPass: string; torrentHash: string },
  renames: PlannedRename[],
): Promise<void> {
  const { access } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { qbitGet } = await import("../qbit-client");
  const res = await qbitGet(
    params.qbitUrl,
    `/api/v2/torrents/info?hashes=${params.torrentHash}`,
    params.qbitUser,
    params.qbitPass,
  );
  const savePath = res.ok
    ? ((await res.json()) as Array<{ save_path?: string }>)[0]?.save_path
    : undefined;
  if (!savePath) return;
  const paths = renames.map((r) => join(savePath, r.newPath));
  for (let i = 0; i < 60; i++) {
    const found = await Promise.all(
      paths.map((p) =>
        access(p).then(
          () => true,
          () => false,
        ),
      ),
    );
    if (found.every(Boolean)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  console.warn(`[plex-id] Redenumirile nu au apărut pe disc în 30s (${params.torrentHash})`);
}

// Aplică redenumirile pentru un torrent. Nu aruncă niciodată: o redenumire
// eșuată lasă fișierul cu numele vechi (Plex ghicește, ca înainte), dar nu
// trebuie să blocheze subtitrarea și legarea care urmează.
export async function applyPlexIdHint(params: {
  qbitUrl: string;
  qbitUser: string;
  qbitPass: string;
  torrentHash: string;
}): Promise<number> {
  const { qbitUrl, qbitUser, qbitPass, torrentHash } = params;
  try {
    const imdbId = await imdbIdForTorrent(torrentHash);
    if (!imdbId) return 0;
    const { qbitListFiles, qbitRenameFile } = await import("../qbit-client");
    const files = await qbitListFiles(qbitUrl, torrentHash, qbitUser, qbitPass);
    const renames = planPlexIdRenames(
      files.map((f) => f.name),
      imdbId,
    );
    let done = 0;
    for (const r of renames) {
      try {
        await qbitRenameFile(qbitUrl, torrentHash, r.oldPath, r.newPath, qbitUser, qbitPass);
        done++;
      } catch (e) {
        console.warn(`[plex-id] Redenumire eșuată „${r.oldPath}":`, e);
      }
    }
    if (done > 0) {
      await waitForRenamesOnDisk(params, renames);
      console.log(`[plex-id] ${done} fișiere redenumite cu {imdb-${imdbId}} (${torrentHash})`);
    }
    return done;
  } catch (e) {
    console.warn(`[plex-id] Nu am putut aplica ID-ul IMDb pentru ${torrentHash}:`, e);
    return 0;
  }
}
