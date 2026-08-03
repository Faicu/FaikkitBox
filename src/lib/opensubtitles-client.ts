// ---------------------------------------------------------------------------
// Client OpenSubtitles (api.opensubtitles.com REST v1) — folosit ca sursă de
// rezervă pentru subtitrări în română când torrentul nu conține niciuna
// (nici încorporată, nici .srt separat). Vezi src/lib/filelist/subtitles.ts
// pentru logica de alegere/scoring a rezultatului potrivit.
// ---------------------------------------------------------------------------

const API_BASE = "https://api.opensubtitles.com/api/v1";

export interface OpenSubtitlesResult {
  fileId: number;
  release: string;
  downloadCount: number;
  rating: number;
  fps?: number;
  // Prezente doar la căutarea per sezon (searchSeasonSubtitles) — folosite
  // pentru a asocia fiecare rezultat cu episodul corect.
  seasonNumber?: number;
  episodeNumber?: number;
}

interface OsSubtitleFile {
  file_id: number;
  file_name?: string;
}

interface OsFeatureDetails {
  season_number?: number;
  episode_number?: number;
}

interface OsSubtitleAttributes {
  release?: string;
  download_count?: number;
  ratings?: number;
  fps?: number;
  files?: OsSubtitleFile[];
  feature_details?: OsFeatureDetails;
}

interface OsSearchResponse {
  data?: Array<{ attributes?: OsSubtitleAttributes }>;
}

function parseSearchResponse(data: OsSearchResponse): OpenSubtitlesResult[] {
  if (!Array.isArray(data.data)) return [];
  const results: OpenSubtitlesResult[] = [];
  for (const item of data.data) {
    const attrs = item.attributes;
    const fileId = attrs?.files?.[0]?.file_id;
    if (!fileId) continue;
    results.push({
      fileId,
      release: attrs?.release ?? "",
      downloadCount: attrs?.download_count ?? 0,
      rating: attrs?.ratings ?? 0,
      fps: attrs?.fps,
      seasonNumber: attrs?.feature_details?.season_number,
      episodeNumber: attrs?.feature_details?.episode_number,
    });
  }
  return results;
}

function apiKey(): string | null {
  return process.env.OPENSUBTITLES_API_KEY || null;
}

let cachedToken: string | null = null;

// Login opțional — necesar doar dacă limita anonimă de download e prea mică
// pentru volumul de descărcări; fail-soft dacă lipsesc credențialele.
async function getAuthToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  const key = apiKey();
  const username = process.env.OPENSUBTITLES_USERNAME;
  const password = process.env.OPENSUBTITLES_PASSWORD;
  if (!key || !username || !password) return null;

  try {
    const res = await fetch(`${API_BASE}/login`, {
      method: "POST",
      headers: {
        "Api-Key": key,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { token?: string };
    cachedToken = data.token ?? null;
    return cachedToken;
  } catch {
    return null;
  }
}

// Caută subtitrări pentru un IMDb id într-o limbă dată (implicit română).
// Returnează listă goală dacă lipsește cheia API sau la orice eroare —
// fail-soft, la fel ca restul integrărilor externe din proiect.
export async function searchSubtitles(
  imdbId: string,
  language = "ro",
): Promise<OpenSubtitlesResult[]> {
  const key = apiKey();
  if (!key) return [];

  const cleanImdb = imdbId.replace(/^tt/i, "");
  const params = new URLSearchParams({ imdb_id: cleanImdb, languages: language });

  try {
    const res = await fetch(`${API_BASE}/subtitles?${params.toString()}`, {
      headers: { "Api-Key": key, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    return parseSearchResponse((await res.json()) as OsSearchResponse);
  } catch {
    return [];
  }
}

// Caută subtitrări pentru TOT un sezon al unui serial, într-un singur apel —
// mult mai eficient decât un request per episod. `showImdbId` e IMDb id-ul
// serialului (nu al unui episod individual). Fiecare rezultat vine cu
// seasonNumber/episodeNumber populate, pentru asociere ulterioară cu
// episodul corect (vezi src/lib/filelist/subtitles.ts, processSeasonPack).
export async function searchSeasonSubtitles(
  showImdbId: string,
  seasonNumber: number,
  language = "ro",
): Promise<OpenSubtitlesResult[]> {
  const key = apiKey();
  if (!key) return [];

  const cleanImdb = showImdbId.replace(/^tt/i, "");
  const params = new URLSearchParams({
    parent_imdb_id: cleanImdb,
    season_number: String(seasonNumber),
    languages: language,
  });

  try {
    const res = await fetch(`${API_BASE}/subtitles?${params.toString()}`, {
      headers: { "Api-Key": key, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    return parseSearchResponse((await res.json()) as OsSearchResponse);
  } catch {
    return [];
  }
}

// Descarcă conținutul unei subtitrări identificate prin fileId (returnat de
// searchSubtitles). Întoarce bytes bruți (Buffer), nu text — fișierele .srt
// de pe OpenSubtitles nu sunt garantat UTF-8 (frecvent Windows-1250/ISO-8859-2
// la subtitrări românești), deci decodarea/conversia se face separat
// (ensureUtf8Srt, src/lib/filelist/subtitles.ts) după ce avem bytes-ii exacți
// — un `.text()` aici ar presupune greșit UTF-8 și ar corupe diacriticele.
// Returnează null la orice eroare.
export async function downloadSubtitle(fileId: number): Promise<Buffer | null> {
  const key = apiKey();
  if (!key) return null;

  try {
    const token = await getAuthToken();
    const res = await fetch(`${API_BASE}/download`, {
      method: "POST",
      headers: {
        "Api-Key": key,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ file_id: fileId }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { link?: string };
    if (!data.link) return null;

    const fileRes = await fetch(data.link, { signal: AbortSignal.timeout(20_000) });
    if (!fileRes.ok) return null;
    return Buffer.from(await fileRes.arrayBuffer());
  } catch {
    return null;
  }
}
