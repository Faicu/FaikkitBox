// ---------------------------------------------------------------------------
// ID-ul IMDb în numele fișierului, ca Plex să potrivească titlul din prima.
// Altfel Plex ghicește după nume și greșește la titluri asemănătoare
// („S.W.A.T. Exiles” → „S.W.A.T.” 2017), iar titlul rămânea pe „Se procesează
// în Plex”. Cu `{imdb-tt…}` agenții Plex iau direct titlul (testat 28 sept.
// 2026: film, episod în rădăcină, în pachet, episod nou, `.ro.srt`).
//
// Redenumirea trece prin API-ul qBittorrent, ca seed-ul să continue; rulează
// înainte de subtitrare și de refresh-ul Plex.
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

// Redenumirile pentru lista de fișiere a unui torrent: fiecare video primește
// ` {imdb-tt…}`, iar fișierele cu același nume din folder (subtitrări) la fel,
// ca Plex să le asocieze. Idempotent.
export function planPlexIdRenames(fileNames: string[], imdbId: string): PlannedRename[] {
  if (!/^tt\d+$/.test(imdbId)) return [];
  const hint = ` {imdb-${imdbId}}`;
  const renames: PlannedRename[] = [];
  const taken = new Set<string>();

  for (const name of fileNames) {
    if (!isVideo(name) || HAS_HINT_RE.test(name)) continue;
    // Mostrele nu intră în bibliotecă.
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

// ID-ul IMDb din `media`, doar pentru rânduri confirmate de TMDB — un ID
// neverificat de pe Filelist ar fi urmat de Plex fără ezitare, deci mai bine
// fără. Pe episoade, imdb_id e al serialului — exact ce vrea Plex.
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

// qBittorrent confirmă redenumirea imediat, dar mută fișierul asincron. Dacă
// subtitrarea ajunge înaintea mutării, vede un fișier lipsă — așteptăm noile
// nume pe disc, cu limită (apoi continuăm, cu avertisment).
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

// Nu aruncă niciodată: o redenumire eșuată nu blochează subtitrarea și legarea.
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
    const done: PlannedRename[] = [];
    for (const r of renames) {
      try {
        await qbitRenameFile(qbitUrl, torrentHash, r.oldPath, r.newPath, qbitUser, qbitPass);
        done.push(r);
      } catch (e) {
        console.warn(`[plex-id] Redenumire eșuată „${r.oldPath}":`, e);
      }
    }
    if (done.length > 0) {
      await waitForRenamesOnDisk(params, done);
      console.log(
        `[plex-id] ${done.length} fișiere redenumite cu {imdb-${imdbId}} (${torrentHash})`,
      );
    }
    return done.length;
  } catch (e) {
    console.warn(`[plex-id] Nu am putut aplica ID-ul IMDb pentru ${torrentHash}:`, e);
    return 0;
  }
}
