// ---------------------------------------------------------------------------
// Client subs.ro (api.subs.ro/v1.0) — sursă de rezervă pentru subtitrări în
// română când OpenSubtitles nu are o potrivire exactă de sursă/rezoluție.
// Arhivele subs.ro conțin adesea mai multe variante de fișier (una per
// combinație sursă+rezoluție), extrase și scorate la fel ca rezultatele
// OpenSubtitles — vezi src/lib/filelist/subtitles.ts (pickBestByRelease).
// ---------------------------------------------------------------------------

import AdmZip from "adm-zip";

const API_BASE = "https://api.subs.ro/v1.0";

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

// Caută subtitrări pentru un IMDb id. Nu trimitem parametrul `language` —
// subs.ro publică exclusiv subtitrări românești, dar eticheta internă
// `language` a itemelor e uneori greșită (ex. "The Invite" 2026, marcată
// "en" deși descrierea/traducătorul arată clar RO), iar filtrarea după ea
// ratează rezultate reale.
// Fail-soft: listă goală la orice eroare sau lipsă cheie API — consistent
// cu restul integrărilor externe. Loghează distinct fiecare caz de eșec
// (cheie lipsă / HTTP non-ok / excepție) ca să se poată diagnostica ulterior
// de ce o căutare a întors 0 rezultate.
export async function searchSubsRo(imdbId: string): Promise<SubsRoItem[]> {
  const key = apiKey();
  const ttImdbId = withTtPrefix(imdbId);
  if (!key) {
    console.warn(`[subsro] căutare ${ttImdbId} săltată — SUBSRO_API_KEY lipsă`);
    return [];
  }

  try {
    const res = await fetch(
      `${API_BASE}/search/imdbid/${encodeURIComponent(ttImdbId)}`,
      {
        headers: { "X-Subs-Api-Key": key, Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      },
    );
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
    const items = (data.items ?? []).map((it) => ({
      id: it.id,
      title: it.title ?? "",
      description: it.description ?? "",
      translator: it.translator ?? "",
      language: it.language ?? "ro",
    }));
    console.log(`[subsro] căutare ${ttImdbId} → ${items.length} rezultat(e)`);
    return items;
  } catch (err) {
    console.warn(`[subsro] căutare ${ttImdbId} — excepție: ${(err as Error).message}`);
    return [];
  }
}

// Pentru seriale, o căutare după IMDb id-ul serialului întoarce rezultate
// pentru toate sezoanele — filtrăm după numărul sezonului căutat, extras din
// title/description (ex. "The Rookie - Sezonul 8", "Sezonul 8 complet, 18
// episoade..."). Case insensitive, acceptă și "sezon" fără "ul".
export function subsRoItemMatchesSeason(item: SubsRoItem, seasonNumber: number): boolean {
  const text = `${item.title} ${item.description}`;
  const m = text.match(/sezon(?:ul)?\s+0*(\d{1,3})\b/i);
  return m ? Number(m[1]) === seasonNumber : false;
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
      console.warn(`[subsro] descărcare arhivă ${id} eșuată — HTTP ${res.status} ${res.statusText}`);
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.warn(`[subsro] descărcare arhivă ${id} — excepție: ${(err as Error).message}`);
    return null;
  }
}

export interface SubsRoSrtEntry {
  // Numele fișierului din arhivă, fără extensie — de obicei chiar numele
  // lansării exacte (ex. "Disclosure.Day.2026.1080p.MA.WEB-DL...-BYNDR"),
  // folosit pentru scorare la fel ca "release" de la OpenSubtitles.
  release: string;
  content: Buffer;
}

// Extrage toate fișierele .srt dintr-o arhivă subs.ro — poate conține mai
// multe variante (una per sursă/rezoluție). Fail-soft: listă goală dacă
// arhiva nu poate fi citită.
export function extractSrtEntriesFromZip(buf: Buffer): SubsRoSrtEntry[] {
  try {
    const zip = new AdmZip(buf);
    return zip
      .getEntries()
      .filter((e) => !e.isDirectory && e.entryName.toLowerCase().endsWith(".srt"))
      .map((e) => ({
        release: (e.entryName.split("/").pop() ?? e.entryName).replace(/\.srt$/i, ""),
        content: e.getData(),
      }));
  } catch {
    return [];
  }
}
