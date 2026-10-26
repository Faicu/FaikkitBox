// Client OpenSubtitles (REST v1) — subtitrări române când torrentul n-are.

const API_BASE = "https://api.opensubtitles.com/api/v1";

export interface OpenSubtitlesResult {
  fileId: number;
  release: string;
  downloadCount: number;
  rating: number;
  fps?: number;
  // Doar la căutarea pe sezon — pentru asocierea cu episodul.
  seasonNumber?: number;
  episodeNumber?: number;
  // Numele .srt-ului — a doua sursă pentru SxxEyy, pe lângă release.
  fileName?: string;
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
  ai_translated?: boolean;
  machine_translated?: boolean;
  uploader?: { name?: string };
}

interface OsSearchResponse {
  data?: Array<{ attributes?: OsSubtitleAttributes }>;
  total_pages?: number;
}

// Pagini de câte 50 citite cel mult — un sezon lung cu multe variante depășește
// 50, iar episoadele de pe pagina a doua rămâneau fără subtitrare.
const MAX_PAGES = 5;

function parseSearchResponse(data: OsSearchResponse): OpenSubtitlesResult[] {
  if (!Array.isArray(data.data)) return [];
  const results: OpenSubtitlesResult[] = [];
  for (const item of data.data) {
    const attrs = item.attributes;
    const fileId = attrs?.files?.[0]?.file_id;
    if (!fileId) continue;
    // Traducerile automate sunt ignorate (decizia userului, 9 oct. 2026): mai
    // bine fără subtitrare câteva zile decât cu una proastă care pare „găsită”.
    if (attrs?.ai_translated || attrs?.machine_translated) continue;
    // La fel tot ce urcă „os-auto”, contul automat — și traducerile lui
    // nemarcate (The Invite: fără legătură cu traducerile umane).
    if (attrs?.uploader?.name?.toLowerCase() === "os-auto") continue;
    results.push({
      fileId,
      release: attrs?.release ?? "",
      downloadCount: attrs?.download_count ?? 0,
      rating: attrs?.ratings ?? 0,
      fps: attrs?.fps,
      seasonNumber: attrs?.feature_details?.season_number,
      episodeNumber: attrs?.feature_details?.episode_number,
      fileName: attrs?.files?.[0]?.file_name,
    });
  }
  return results;
}

function apiKey(): string | null {
  return process.env.OPENSUBTITLES_API_KEY || null;
}

let cachedToken: string | null = null;

// Login opțional — doar dacă limita anonimă de descărcări nu ajunge.
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

// Căutările trec printr-un cache Cloudflare comun tuturor utilizatorilor API
// (24h), cu URL-ul drept cheie — nici cheia API, nici `no-cache` nu contează.
// O variantă nouă rămânea invizibilă ore întregi (MobLand S02E05, 16 oct.).
// Parametrul `_`, ignorat de API, schimbă cheia din oră în oră.
function cacheBucket(): string {
  return new Date().toISOString().slice(0, 13).replace(/\D/g, "");
}

// Parametrii în ordine alfabetică — altfel API-ul răspunde 301 spre varianta
// sortată și fiecare căutare costă două cereri.
async function osSearch(params: Record<string, string>): Promise<OpenSubtitlesResult[]> {
  const key = apiKey();
  if (!key) return [];
  const results: OpenSubtitlesResult[] = [];
  const bucketed = { ...params, _: cacheBucket() };
  for (let page = 1; page <= MAX_PAGES; page++) {
    const query = new URLSearchParams(
      Object.entries(page > 1 ? { ...bucketed, page: String(page) } : bucketed).sort(([a], [b]) =>
        a.localeCompare(b),
      ),
    );
    try {
      const res = await fetch(`${API_BASE}/subtitles?${query.toString()}`, {
        headers: { "Api-Key": key, Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) break;
      const data = (await res.json()) as OsSearchResponse;
      results.push(...parseSearchResponse(data));
      if (page >= (data.total_pages ?? 1)) break;
    } catch {
      break;
    }
  }
  return results;
}

// Subtitrările unui IMDb id (implicit română). Fail-soft: listă goală.
export async function searchSubtitles(
  imdbId: string,
  language = "ro",
): Promise<OpenSubtitlesResult[]> {
  return osSearch({ imdb_id: imdbId.replace(/^tt/i, ""), languages: language });
}

// Subtitrările unui episod: prin serial (`parent_imdb_id`) + sezon + episod —
// `imdb_id` cu id-ul serialului dă mereu 0 rezultate (până pe 9 oct. 2026,
// niciun episod individual nu primea subtitrare de aici). Dacă id-ul e chiar
// al episodului (găsit după nume), căutare directă.
export async function searchEpisodeSubtitles(
  imdbId: string,
  season: number,
  episode: number,
  language = "ro",
): Promise<OpenSubtitlesResult[]> {
  const cleanImdb = imdbId.replace(/^tt/i, "");
  const byShow = await osSearch({
    parent_imdb_id: cleanImdb,
    season_number: String(season),
    episode_number: String(episode),
    languages: language,
  });
  return byShow.length > 0 ? byShow : searchSubtitles(imdbId, language);
}

// Tot un sezon, într-un singur apel (`showImdbId` = serialul), cu sezon și
// episod pe fiecare rezultat.
export async function searchSeasonSubtitles(
  showImdbId: string,
  seasonNumber: number,
  language = "ro",
): Promise<OpenSubtitlesResult[]> {
  return osSearch({
    parent_imdb_id: showImdbId.replace(/^tt/i, ""),
    season_number: String(seasonNumber),
    languages: language,
  });
}

// Conținutul unei subtitrări, ca bytes: .srt-urile românești sunt des
// Windows-1250/ISO-8859-2, iar un `.text()` ar presupune UTF-8 și ar strica
// diacriticele (conversia: ensureUtf8Srt). null la eroare.
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
