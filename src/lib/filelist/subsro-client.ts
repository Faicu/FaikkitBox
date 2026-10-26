// Client subs.ro (api.subs.ro/v1.0). Arhivele au adesea mai multe variante
// (sursă/rezoluție), scorate la fel ca rezultatele OpenSubtitles.

import AdmZip from "adm-zip";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { promisify } from "node:util";
import { agreedEpisodeKey, extractEpisodeKey } from "./subtitle-checks";

const execFileAsync = promisify(execFile);

const API_BASE = "https://api.subs.ro/v1.0";

// Traducători ignorați: „Ai” publică traduceri automate — userul nu le vrea.
const IGNORED_TRANSLATORS = ["ai"];

export interface SubsRoItem {
  id: number;
  title: string;
  description: string;
  translator: string;
  language: string;
}

function apiKey(): string | null {
  return process.env.SUBSRO_API_KEY || null;
}

// subs.ro vrea IMDb id cu prefixul "tt" (spre deosebire de OpenSubtitles).
function withTtPrefix(imdbId: string): string {
  return /^tt/i.test(imdbId) ? imdbId : `tt${imdbId}`;
}

// Subtitrările unui IMDb id. Fără parametrul `language`: subs.ro are și
// originale în engleză, iar limba se decide după conținutul fiecărui fișier,
// nu după etichetă. Fail-soft (listă goală), cu fiecare eșec logat distinct
// (cheie lipsă / HTTP / excepție).
export async function searchSubsRo(imdbId: string): Promise<SubsRoItem[]> {
  const key = apiKey();
  const ttImdbId = withTtPrefix(imdbId);
  if (!key) {
    console.warn(`[subsro] căutare ${ttImdbId} săltată — SUBSRO_API_KEY lipsă`);
    return [];
  }

  try {
    const res = await fetch(`${API_BASE}/search/imdbid/${encodeURIComponent(ttImdbId)}`, {
      headers: { "X-Subs-Api-Key": key, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn(`[subsro] căutare ${ttImdbId} eșuată — HTTP ${res.status} ${res.statusText}`);
      return [];
    }
    const data = (await res.json()) as {
      items?: Array<{
        id: number;
        title?: string;
        description?: string;
        translator?: string;
        language?: string;
      }>;
    };
    const items = (data.items ?? [])
      .map((it) => ({
        id: it.id,
        title: it.title ?? "",
        description: it.description ?? "",
        translator: it.translator ?? "",
        language: it.language ?? "ro",
      }))
      .filter((it) => !IGNORED_TRANSLATORS.includes(it.translator.trim().toLowerCase()));
    console.log(`[subsro] căutare ${ttImdbId} → ${items.length} rezultat(e)`);
    return items;
  } catch (err) {
    console.warn(`[subsro] căutare ${ttImdbId} — excepție: ${(err as Error).message}`);
    return [];
  }
}

// Căutarea după serial aduce toate sezoanele — filtrăm după sezonul din titlu
// sau descriere („Sezonul 8”, „Sezoanele 1-2”, „Sezonul 1-3”, „Sezoanele 1, 2
// și 3”). Lista cu virgulă doar la plural: în „Sezonul 8, 18 episoade” virgula
// nu leagă alt sezon.
export function subsRoItemMatchesSeason(item: SubsRoItem, seasonNumber: number): boolean {
  const text = `${item.title} ${item.description}`;
  const plural = text.match(/sezoanele\s+(\d{1,3}(?:(?:\s*[-–,&]\s*|\s+(?:și|si)\s+)\d{1,3})*)\b/i);
  if (plural) return seasonInList(plural[1], seasonNumber);
  const range = text.match(/sezon(?:ul)?\s+0*(\d{1,3})\s*[-–]\s*0*(\d{1,3})\b/i);
  if (range) return Number(range[1]) <= seasonNumber && seasonNumber <= Number(range[2]);
  const m = text.match(/sezon(?:ul)?\s+0*(\d{1,3})\b/i);
  if (m) return Number(m[1]) === seasonNumber;
  // Și „S02E04" / „S02" în titlu, pentru arhivele fără „Sezonul N".
  const se = text.match(/\bS(\d{1,3})(?:E\d{1,3})?\b/i);
  return se ? Number(se[1]) === seasonNumber : false;
}

// „1-2", „1, 2 și 3", „1-3, 5" → dacă sezonul e printre ele.
function seasonInList(list: string, seasonNumber: number): boolean {
  return list.split(/\s*[,&]\s*|\s+(?:și|si)\s+/i).some((part) => {
    const [from, to] = part.split(/\s*[-–]\s*/).map(Number);
    return to === undefined ? from === seasonNumber : from <= seasonNumber && seasonNumber <= to;
  });
}

// Descarcă arhiva .zip a unei subtitrări (bytes bruți). null la orice eroare.
export async function downloadSubsRoZip(id: number): Promise<Buffer | null> {
  const key = apiKey();
  if (!key) {
    console.warn(`[subsro] descărcare arhivă ${id} săltată — SUBSRO_API_KEY lipsă`);
    return null;
  }

  try {
    const res = await fetch(`${API_BASE}/subtitle/${id}/download`, {
      headers: { "X-Subs-Api-Key": key },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.warn(
        `[subsro] descărcare arhivă ${id} eșuată — HTTP ${res.status} ${res.statusText}`,
      );
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.warn(`[subsro] descărcare arhivă ${id} — excepție: ${(err as Error).message}`);
    return null;
  }
}

export interface SubsRoSrtEntry {
  // Numele fișierului din arhivă — de obicei chiar release-ul, pentru scorare.
  release: string;
  // Reperul de episod e numele fișierului, nu folderul („S02E01-E04” nu spune
  // nimic despre fișierul din el).
  fileName: string;
  content: Buffer;
}

// Arhiva poate fi .zip sau .rar (The Invite) — detectat din magic bytes.
function isRarArchive(buf: Buffer): boolean {
  return buf.length >= 6 && buf.subarray(0, 6).toString("hex") === "526172211a07";
}

// Release-ul e adesea în folderul din arhivă („The.Crown.S02.1080p.BluRay…/
// Episode.rum.srt”) — fără folder, scorarea nu vedea niciun tag și nu alegea
// niciodată o potrivire perfectă (The Crown S02, 2 sept. 2026).
function releaseFromEntryPath(entryPath: string): { release: string; fileName: string } {
  const fileName = (entryPath.split("/").pop() ?? entryPath).replace(/\.srt$/i, "");
  const dirName = entryPath.includes("/") ? entryPath.slice(0, entryPath.lastIndexOf("/")) : "";
  return { release: dirName ? `${dirName} ${fileName}` : fileName, fileName };
}

// Episodul din numele fișierului; folderul doar dacă fișierul n-are SxxEyy și
// folderul numește un singur episod.
export function subsRoEntryEpisodeKey(entry: { release: string; fileName: string }): string | null {
  return (
    agreedEpisodeKey([entry.fileName]) ??
    (extractEpisodeKey(entry.fileName) == null ? agreedEpisodeKey([entry.release]) : null)
  );
}

function extractSrtEntriesFromZip(buf: Buffer): SubsRoSrtEntry[] {
  const zip = new AdmZip(buf);
  return zip
    .getEntries()
    .filter((e) => !e.isDirectory && e.entryName.toLowerCase().endsWith(".srt"))
    .map((e) => ({
      ...releaseFromEntryPath(e.entryName),
      content: e.getData(),
    }));
}

// RAR prin `unrar` (apt) — nicio librărie JS pentru RAR5 nu era destul de
// fiabilă.
async function extractSrtEntriesFromRar(buf: Buffer): Promise<SubsRoSrtEntry[]> {
  const dir = await mkdtemp(join(tmpdir(), "subsro-rar-"));
  try {
    const rarPath = join(dir, "archive.rar");
    await writeFile(rarPath, buf);
    await execFileAsync("unrar", ["x", "-y", "-inul", rarPath, dir + "/"], {
      timeout: 15_000,
    });
    const names = await readdir(dir, { recursive: true });
    const entries: SubsRoSrtEntry[] = [];
    for (const name of names) {
      if (!name.toLowerCase().endsWith(".srt")) continue;
      entries.push({
        ...releaseFromEntryPath(name.split(sep).join("/")),
        content: await readFile(join(dir, name)),
      });
    }
    return entries;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Toate .srt-urile dintr-o arhivă. Fail-soft, cu eșecul de extragere logat
// distinct de „0 fișiere .srt” (un .rar tratat ca .zip era indistinguibil).
export async function extractSrtEntries(buf: Buffer): Promise<SubsRoSrtEntry[]> {
  try {
    const entries = isRarArchive(buf)
      ? await extractSrtEntriesFromRar(buf)
      : extractSrtEntriesFromZip(buf);
    if (entries.length === 0) {
      console.warn(
        `[subsro] arhivă (${isRarArchive(buf) ? "rar" : "zip"}, ${buf.length} bytes) — 0 fișiere .srt extrase`,
      );
    }
    return entries;
  } catch (err) {
    console.warn(
      `[subsro] extragere arhivă (${isRarArchive(buf) ? "rar" : "zip"}) eșuată — ${(err as Error).message}`,
    );
    return [];
  }
}
