import { fetchJson, type ServiceStatus } from "./shared";
import {
  discoverPlexUrl,
  normalizeShowTitle,
  plexQualityFromMedia,
  plexQualitiesFromItem,
  plexMediaForPath,
  type PlexApiResponse,
  type PlexMetadataItem,
} from "./plex-shared";

// ---------------------------------------------------------------------------
// Căutare titluri/episoade în biblioteca Plex — folosit de wizard (Acasă)
// pentru a verifica dacă un film/episod e deja disponibil. Extras din fostul
// plex.ts monolitic.
// ---------------------------------------------------------------------------

export interface ShowEpisodeInfo {
  season: number;
  episode: number;
  title: string;
  airDateIso: string;
}

export interface ShowStatusData {
  status: ServiceStatus;
  error?: string;
  show: string;
  lastAired: (ShowEpisodeInfo & { inLibrary: boolean | null }) | null;
  next: ShowEpisodeInfo | null;
}

// Cache scurt pentru key-urile secțiunilor (filme / seriale), ca să nu
// interogăm /library/sections la fiecare căutare de fallback.
const sectionCache = new Map<string, { url: string; key: string; expiresAt: number }>();

async function findSectionKey(
  url: string,
  headers: Record<string, string>,
  type: "movie" | "show",
): Promise<string | undefined> {
  const cached = sectionCache.get(type);
  if (cached && cached.url === url && cached.expiresAt > Date.now()) return cached.key;
  const sections = await fetchJson<PlexApiResponse>(`${url}/library/sections`, { headers }, 8000);
  const dirs = sections?.MediaContainer?.Directory ?? [];
  const section = dirs.find((d) => d.type === type);
  if (!section?.key) return undefined;
  sectionCache.set(type, { url, key: section.key, expiresAt: Date.now() + 5 * 60 * 1000 });
  return section.key;
}

// Ce știm despre titlul căutat. `tmdbId` e reperul sigur; titlurile servesc
// doar la căutare — și, când ID-ul lipsește, la potrivirea exactă.
export interface PlexLookup {
  tmdbId: number | null;
  titles: string[];
}

function hasTmdbId(item: PlexMetadataItem, tmdbId: number): boolean {
  return (item.Guid ?? []).some((g) => g.id === `tmdb://${tmdbId}`);
}

// Potrivirea unui item Plex cu titlul căutat.
//
// Cu ID TMDB, doar ID-ul decide. Titlul nu e un reper: biblioteca Plex e în
// română („Imperiul Mafiei" pentru MobLand, „Străina" pentru Outlander), deci
// titlul găsit diferă des de cel căutat, iar potrivirea „conține" sau „primul
// rezultat" lega, la titluri scurte sau fără rezultat bun, alt serial (You →
// Younger) — fără nicio eroare, doar cu alt ratingKey pe rând.
//
// Fără ID (o descărcare pe care TMDB n-a recunoscut-o, cu numele lansării pe
// post de titlu), doar potrivirea exactă: mai bine nelegat decât legat greșit.
function matchesLookup(item: PlexMetadataItem, lookup: PlexLookup): boolean {
  if (lookup.tmdbId != null) return hasTmdbId(item, lookup.tmdbId);
  const wanted = new Set(lookup.titles.filter(Boolean).map(normalizeShowTitle));
  return [item.title, item.originalTitle].some(
    (t) => t != null && wanted.has(normalizeShowTitle(String(t))),
  );
}

// Găsește item-ul Plex (film sau serial) pentru un titlu: întâi prin căutare,
// apoi, dacă nu apare acolo, în lista completă a secțiunii — căutarea Plex nu
// găsește mereu după titlul original (ex. „Élite" nu dă nimic, deși serialul
// e în bibliotecă ca „Elita"). `includeGuids=1` e obligatoriu: fără el, Plex
// nu întoarce `Guid` deloc.
async function findItem(
  url: string,
  headers: Record<string, string>,
  type: "movie" | "show",
  lookup: PlexLookup,
): Promise<PlexMetadataItem | undefined> {
  const plexType = type === "movie" ? 1 : 2;
  const queries = [
    ...new Set(lookup.titles.filter(Boolean).flatMap((t) => [t, normalizeShowTitle(t)])),
  ];
  for (const q of queries) {
    const search = await fetchJson<PlexApiResponse>(
      `${url}/search?query=${encodeURIComponent(q)}&type=${plexType}&includeGuids=1`,
      { headers },
      8000,
    );
    const found = (search?.MediaContainer?.Metadata ?? []).find(
      (r) => r.type === type && matchesLookup(r, lookup),
    );
    if (found) return found;
  }

  const sectionKey = await findSectionKey(url, headers, type);
  if (!sectionKey) return undefined;
  const all = await fetchJson<PlexApiResponse>(
    `${url}/library/sections/${sectionKey}/all?type=${plexType}&includeGuids=1`,
    { headers },
    10000,
  );
  return (all?.MediaContainer?.Metadata ?? []).find(
    (r) => r.type === type && matchesLookup(r, lookup),
  );
}

// Găsește serialul și întoarce lista brută de episoade dintr-un sezon dat —
// comun pentru episodesInSeason și legarea episoadelor.
async function findSeasonEpisodes(
  url: string,
  headers: Record<string, string>,
  show: PlexLookup,
  season: number,
): Promise<PlexMetadataItem[] | null> {
  const found = await findItem(url, headers, "show", show);
  if (!found) return null;

  const seasons = await fetchJson<PlexApiResponse>(
    `${url}/library/metadata/${found.ratingKey}/children`,
    { headers },
    8000,
  );
  const seasonsMd = seasons?.MediaContainer?.Metadata ?? [];
  const seasonMatch = seasonsMd.find((s: PlexMetadataItem) => Number(s.index) === season);
  if (!seasonMatch) return null;

  const episodes = await fetchJson<PlexApiResponse>(
    `${url}/library/metadata/${seasonMatch.ratingKey}/children`,
    { headers },
    8000,
  );
  return episodes?.MediaContainer?.Metadata ?? [];
}

async function episodesInSeason(
  url: string,
  headers: Record<string, string>,
  show: PlexLookup,
  season: number,
): Promise<{ num: number; quality: string | null; watched: boolean }[]> {
  const episodesMd = await findSeasonEpisodes(url, headers, show, season);
  if (!episodesMd) return [];
  return episodesMd
    .filter((e: PlexMetadataItem) => Number(e.index) > 0)
    .map((e: PlexMetadataItem) => ({
      num: Number(e.index),
      quality: plexQualityFromMedia(e.Media?.[0]),
      watched: Number(e.viewCount ?? 0) > 0,
    }));
}

async function findByTitle(
  url: string,
  headers: Record<string, string>,
  lookup: PlexLookup,
  mediaType: "movie" | "tv",
): Promise<{ found: boolean; qualities: string[] }> {
  const found = await findItem(url, headers, mediaType === "movie" ? "movie" : "show", lookup);
  if (!found) return { found: false, qualities: [] };
  // Toate versiunile, nu doar prima: un film poate fi în bibliotecă simultan
  // la 4K HDR și 1080p, iar wizard-ul trebuie să știe ambele ca să nu-ți
  // ofere ceva ce deja ai.
  const full = found.ratingKey
    ? ((await fetchItemWithStreams(url, headers, String(found.ratingKey))) ?? found)
    : found;
  return { found: true, qualities: plexQualitiesFromItem(full) };
}

// Item-ul complet, cu stream-urile fiecărei versiuni.
//
// `/search` întoarce Media și Part, dar NU și `Part.Stream` — adică exact
// câmpurile din care se vede HDR-ul fără echivoc (colorTrc, DOVIPresent).
// Fără trecerea asta, eticheta ar depinde de numele fișierului, care nu spune
// mereu adevărul (o lansare marcată doar „DV" n-are „HDR" în nume). Plex e
// local, deci cererea în plus costă milisecunde.
async function fetchItemWithStreams(
  url: string,
  headers: Record<string, string>,
  ratingKey: string,
): Promise<PlexMetadataItem | undefined> {
  const detail = await fetchJson<PlexApiResponse>(
    `${url}/library/metadata/${ratingKey}`,
    { headers },
    8000,
  );
  return detail?.MediaContainer?.Metadata?.[0];
}

// Item-ul Plex cu toate versiunile lui, după ratingKey — pentru recalcularea
// etichetelor de calitate ale rândurilor deja legate (media.ts).
export async function fetchPlexItemVersions(
  ratingKey: string,
): Promise<PlexMetadataItem | undefined> {
  const token = process.env.PLEX_TOKEN;
  const base = process.env.PLEX_URL;
  if (!token) return undefined;
  try {
    const headers = { Accept: "application/json", "X-Plex-Token": token };
    const { url } = await discoverPlexUrl(token, base);
    return await fetchItemWithStreams(url, headers, ratingKey);
  } catch {
    return undefined;
  }
}

export interface PlexItemLink {
  ratingKey: string;
  quality: string | null;
  durationMs: number;
  // `null` când item-ul Plex are mai multe versiuni: `addedAt` e al ITEM-ului,
  // adică data la care a intrat PRIMA versiune, nu a noastră. Scriind-o pe
  // rândul nou, filmul proaspăt descărcat sărea instant în josul Bibliotecii,
  // la data celui vechi. Apelantul lasă atunci coloana goală, iar sortarea
  // cade pe `added_at` — când l-am adăugat noi (vezi rowAddedAt).
  addedAt: number | null;
}

// Ce scriem în `media` despre un item Plex: care versiune e a noastră, cu ce
// calitate, durată și dată. Regula stă aici, într-un singur loc, fiindcă e
// nevoie de ea din două direcții — la prima legare (findPlexMovieLink, care
// caută item-ul după titlu) și la recalcularea unui rând deja legat (media.ts,
// care pornește direct de la ratingKey).
export function versionLinkFromItem(
  item: PlexMetadataItem,
  contentPath: string | null,
  torrentName: string | null,
): PlexItemLink | null {
  if (!item.ratingKey) return null;
  const ours = plexMediaForPath(item, contentPath, torrentName);
  return {
    ratingKey: String(item.ratingKey),
    quality: plexQualityFromMedia(ours),
    // Durata e a versiunii noastre când o știm; altfel cea a item-ului, care
    // pentru un film e oricum aceeași în toate versiunile.
    durationMs: Number(ours?.Part?.[0]?.duration ?? item.duration ?? 0),
    addedAt: (item.Media ?? []).length > 1 ? null : Number(item.addedAt ?? 0),
  };
}

// Găsește ratingKey-ul + calitatea/durata unui film deja apărut în Plex (după
// ID-ul TMDB — vezi findItem, de ce nu după titlu) — folosit ca să legăm un rând din tabela `media` de item-ul lui real din
// Plex, o singură dată, cache-uit permanent acolo (vezi media.ts).
// `contentPath` (calea reală de pe disk, din qBittorrent) identifică fișierul
// NOSTRU printre versiunile item-ului Plex (vezi plexMediaForPath). Fără el —
// sau când nu se potrivește nimic — legarea se face oricum (ratingKey-ul e al
// item-ului, deci corect), dar calitatea rămâne null: mai bine lipsă decât
// preluată de la altă versiune.
export async function findPlexMovieLink(
  movie: PlexLookup,
  contentPath: string | null = null,
  torrentName: string | null = null,
): Promise<PlexItemLink | null> {
  const token = process.env.PLEX_TOKEN;
  const base = process.env.PLEX_URL;
  if (!token) return null;
  try {
    const headers = { Accept: "application/json", "X-Plex-Token": token };
    const { url } = await discoverPlexUrl(token, base);
    const found = await findItem(url, headers, "movie", movie);
    if (!found?.ratingKey) return null;
    const item = (await fetchItemWithStreams(url, headers, String(found.ratingKey))) ?? found;
    return versionLinkFromItem(item, contentPath, torrentName);
  } catch {
    return null;
  }
}

// Echivalentul de mai sus, pentru un episod anume — reutilizează
// findSeasonEpisodes (aceeași sursă ca getPlexEpisodesInSeason).
export async function findPlexEpisodeLink(
  show: PlexLookup,
  season: number,
  episode: number,
): Promise<PlexItemLink | null> {
  const token = process.env.PLEX_TOKEN;
  const base = process.env.PLEX_URL;
  if (!token) return null;
  try {
    const headers = { Accept: "application/json", "X-Plex-Token": token };
    const { url } = await discoverPlexUrl(token, base);
    const episodesMd = await findSeasonEpisodes(url, headers, show, season);
    const item = episodesMd?.find((e) => Number(e.index) === episode);
    if (item?.ratingKey) {
      return {
        ratingKey: String(item.ratingKey),
        quality: plexQualityFromMedia(item.Media?.[0]),
        durationMs: Number(item.duration ?? 0),
        addedAt: Number(item.addedAt ?? 0),
      };
    }
    return null;
  } catch {
    return null;
  }
}

// Ca findPlexEpisodeLink, dar pentru un sezon întreg dintr-o singură cerere
// Plex — folosit la legarea pachetelor de sezon (media.ts), unde un rând
// unic "pachet" trebuie desfăcut în câte un rând per episod, fiecare cu
// propriul ratingKey.
export async function findPlexSeasonLinks(
  show: PlexLookup,
  season: number,
): Promise<Map<number, PlexItemLink> | null> {
  const token = process.env.PLEX_TOKEN;
  const base = process.env.PLEX_URL;
  if (!token) return null;
  try {
    const headers = { Accept: "application/json", "X-Plex-Token": token };
    const { url } = await discoverPlexUrl(token, base);
    const episodesMd = await findSeasonEpisodes(url, headers, show, season);
    if (!episodesMd) return null;
    const links = new Map<number, PlexItemLink>();
    for (const e of episodesMd) {
      const num = Number(e.index);
      if (!num || !e.ratingKey) continue;
      links.set(num, {
        ratingKey: String(e.ratingKey),
        quality: plexQualityFromMedia(e.Media?.[0]),
        durationMs: Number(e.duration ?? 0),
        addedAt: Number(e.addedAt ?? 0),
      });
    }
    return links;
  } catch {
    return null;
  }
}

// Verificările din Plex apelate de `wizard-check.functions.ts`, care face
// toată munca unui titlu într-o singură cerere venită de la client.
//
// Sufixul "Internal" e o rămășiță: peste ele au existat și server function-uri
// publice (checkPlexHasTitle, getPlexEpisodesInSeason, checkPlexHasEpisode),
// de pe vremea când wizard-ul făcea zece cereri separate. După consolidare
// nu le-a mai chemat nimeni, așa că au fost șterse.

export async function checkPlexHasTitleInternal(data: {
  tmdbId: number;
  title: string;
  originalTitle: string;
  mediaType: "movie" | "tv";
}): Promise<{ found: boolean; qualities: string[] } | null> {
  const token = process.env.PLEX_TOKEN;
  const base = process.env.PLEX_URL;
  if (!token) return null;
  try {
    const headers = { Accept: "application/json", "X-Plex-Token": token };
    const discovered = await discoverPlexUrl(token, base);
    return await findByTitle(
      discovered.url,
      headers,
      { tmdbId: data.tmdbId, titles: [data.title, data.originalTitle] },
      data.mediaType,
    );
  } catch {
    return null;
  }
}

export async function getPlexEpisodesInSeasonInternal(data: {
  tmdbId: number;
  showTitle: string;
  season: number;
}): Promise<{ num: number; quality: string | null; watched: boolean }[]> {
  const token = process.env.PLEX_TOKEN;
  const base = process.env.PLEX_URL;
  if (!token) return [];
  try {
    const headers = { Accept: "application/json", "X-Plex-Token": token };
    const discovered = await discoverPlexUrl(token, base);
    return await episodesInSeason(
      discovered.url,
      headers,
      { tmdbId: data.tmdbId, titles: [data.showTitle] },
      data.season,
    );
  } catch {
    return [];
  }
}
