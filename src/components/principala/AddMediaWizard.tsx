import { useEffect, useRef, useState } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import {
  Search,
  Loader2,
  Film,
  Tv,
  CheckCircle2,
  Download,
  Pin,
  ArrowLeft,
  Layers,
  Clapperboard,
  ListChecks,
  Check,
  Info,
} from "lucide-react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { DownloadConfirmDialog } from "@/components/pinned/DownloadConfirmDialog";
import { pinnedItemsQuery, adminStatusQuery } from "@/lib/queries";
import {
  searchTmdb,
  getTmdbDetails,
  getTmdbSeasonEpisodes,
  findEpisodeTitle,
} from "@/lib/tmdb.functions";
import type { TmdbEpisode, TmdbDetails } from "@/lib/tmdb.functions";
import type { TmdbSearchResult } from "@/lib/tmdb.functions";
import { checkPlexHasTitle, getPlexEpisodesInSeason } from "@/lib/services.functions";
import { checkFilelistForItem, downloadFilelist } from "@/lib/filelist.functions";
import type { FilelistTorrent } from "@/lib/filelist.functions";
import { setPinnedItems, setWatchSettings } from "@/lib/pinned.functions";
import type { WatchQuality } from "@/lib/pinned.functions";
import { ensureMediaEntryForSearch } from "@/lib/media";
import {
  detectQuality,
  groupTorrentsBySeasonEpisode,
  emptyQualitySet,
} from "@/components/pinned/utils";
import type { QualitySet } from "@/components/pinned/types";
import {
  ScopeOption,
  ActionButton,
  TorrentPicker,
  NotFoundWithPin,
  PosterHero,
} from "./wizard/WizardControls";
import { SearchStep } from "./wizard/SearchStep";
import { DoneStep } from "./wizard/DoneStep";

type Quality = WatchQuality;
type Step = "search" | "checking" | "tv-scope" | "result" | "done";
type TvScope = "series" | "season" | "episode";

interface CheckResult {
  imdbId: string | null;
  originalTitle: string;
  plexFound: boolean;
  plexQuality: string | null;
  torrents: FilelistTorrent[];
  seasons: Array<{ seasonNumber: number; episodeCount: number }>;
}

function pickFromSet(set: QualitySet, quality: Quality): FilelistTorrent[] {
  if (quality === "720p") return set.t720;
  if (quality === "1080p") return set.t1080;
  if (quality === "4K") return set.t4k;
  return set.t4kHdr;
}

// Statusurile TMDB pentru un serial care încă poate primi sezoane/episoade
// noi — restul ("Ended", "Canceled") înseamnă că seria s-a încheiat definitiv.
const ONGOING_TV_STATUSES = new Set(["Returning Series", "In Production", "Planned", "Pilot"]);

function tvStatusLabel(status: string): string {
  switch (status) {
    case "Returning Series":
      return "va reveni cu sezoane noi";
    case "In Production":
      return "sezon nou în lucru";
    case "Planned":
      return "sezon nou anunțat, nefilmat încă";
    case "Pilot":
      return "doar episod pilot deocamdată";
    default:
      return status;
  }
}

function bestOf(list: FilelistTorrent[]): FilelistTorrent | null {
  return list.length ? [...list].sort((a, b) => b.seeders - a.seeders)[0] : null;
}

// Toate torrentele care se potrivesc la o calitate, sortate după seederi —
// spre deosebire de bestOf, păstrează toată lista, ca adminul să poată alege
// manual între release-uri diferite (ex. grupuri diferite cu același IMDb ID).
function matchesForQuality(torrents: FilelistTorrent[], quality: Quality): FilelistTorrent[] {
  return torrents
    .filter((t) => {
      const q = detectQuality(t.name);
      if (quality === "720p") return q.is720p;
      if (quality === "1080p") return q.is1080p;
      if (quality === "4K") return q.is4k;
      return q.is4kHdr;
    })
    .sort((a, b) => b.seeders - a.seeders);
}

export function AddMediaWizard({
  open,
  onClose,
  initialItem,
}: {
  open: boolean;
  onClose: () => void;
  // Sare peste pasul de căutare — folosit când wizard-ul e deschis direct
  // dintr-un titlu deja identificat (ex. butonul "Adaugă" din Descoperă).
  initialItem?: TmdbSearchResult | null;
}) {
  const queryClient = useQueryClient();
  const { data: pinned = [] } = useQuery(pinnedItemsQuery);
  const { data: adminData } = useQuery(adminStatusQuery);
  const isAdmin = !!adminData?.isAdmin;

  const searchFn = useServerFn(searchTmdb);
  const detailsFn = useServerFn(getTmdbDetails);
  const plexFn = useServerFn(checkPlexHasTitle);
  const plexSeasonFn = useServerFn(getPlexEpisodesInSeason);
  const filelistFn = useServerFn(checkFilelistForItem);
  const episodesFn = useServerFn(getTmdbSeasonEpisodes);
  const downloadFn = useServerFn(downloadFilelist);
  const setPinnedFn = useServerFn(setPinnedItems);
  const setWatchFn = useServerFn(setWatchSettings);
  const ensureMediaEntryFn = useServerFn(ensureMediaEntryForSearch);

  const [step, setStep] = useState<Step>("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TmdbSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<TmdbSearchResult | null>(null);
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  // Detaliile TMDB complete (gen, rezumat RO, tmdb id, status) — reținute ca
  // să poată fi trimise mai departe la pornirea descărcării, populând
  // tabela `media`, fără să le mai cerem o dată de la TMDB.
  const [tmdbDetails, setTmdbDetails] = useState<TmdbDetails | null>(null);
  const [quality, setQuality] = useState<Quality>("1080p");
  const [tvScope, setTvScope] = useState<TvScope>("series");
  const [tvSeason, setTvSeason] = useState<number | null>(null);
  const [tvEpisode, setTvEpisode] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);
  // Numerele episoadelor deja în Plex, per sezon — adus dintr-o dată pentru
  // TOATE sezoanele imediat ce serialul e identificat (selectItem), nu doar
  // pentru sezonul ales, ca badge-ul "Plex" să apară și pe butoanele de
  // sezon, nu doar în lista de episoade a sezonului curent selectat.
  const [plexBySeason, setPlexBySeason] = useState<Map<number, number[]>>(new Map());
  // Titlurile episoadelor sezonului ales (RO, cu fallback EN din server) —
  // cheia ține evidența pentru ce sezon sunt încărcate, ca să nu arătăm
  // titluri vechi cât timp se încarcă cele noi.
  const [episodeTitles, setEpisodeTitles] = useState<{
    season: number;
    episodes: TmdbEpisode[];
  } | null>(null);
  const [loadingEpisodeTitles, setLoadingEpisodeTitles] = useState(false);
  // Torrentul ales manual de admin, când sunt mai multe disponibile la
  // aceeași calitate (grupuri de release diferite etc) — dacă nu alege
  // nimeni explicit, cade pe cel cu cei mai mulți seederi.
  const [selectedTorrentId, setSelectedTorrentId] = useState<number | null>(null);
  // Torrentul/pachetele în așteptare de confirmare — nimic nu pornește
  // efectiv în qBittorrent până nu confirmă adminul din dialog.
  const [confirmTorrent, setConfirmTorrent] = useState<{
    torrent: FilelistTorrent;
    label: string;
  } | null>(null);
  const [confirmSeries, setConfirmSeries] = useState<Array<{
    season: number;
    torrent: FilelistTorrent;
  }> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function reset() {
    setStep("search");
    setQuery("");
    setResults([]);
    setSelected(null);
    setCheckResult(null);
    setTmdbDetails(null);
    setQuality("1080p");
    setTvScope("series");
    setTvSeason(null);
    setTvEpisode(null);
    setBusy(false);
    setDoneMessage(null);
    setPlexBySeason(new Map());
    setEpisodeTitles(null);
    setLoadingEpisodeTitles(false);
    setSelectedTorrentId(null);
    setConfirmTorrent(null);
    setConfirmSeries(null);
  }

  // Încarcă titlurile episoadelor sezonului ales. Statusul Plex e deja
  // disponibil pentru toate sezoanele deodată (prefetch în selectItem), nu
  // mai e nevoie să fie reluat aici.
  async function selectSeason(seasonNumber: number) {
    setTvSeason(seasonNumber);
    setTvEpisode(null);
    if (!selected || !checkResult) return;
    setLoadingEpisodeTitles(true);
    try {
      const episodes = await episodesFn({
        data: { tmdbId: selected.id, seasonNum: seasonNumber },
      });
      setEpisodeTitles({ season: seasonNumber, episodes });
    } catch {
      setEpisodeTitles({ season: seasonNumber, episodes: [] });
    }
    setLoadingEpisodeTitles(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  // Deschis direct dintr-un titlu deja identificat (ex. Descoperă) — sare
  // peste pasul de căutare și pornește direct verificarea.
  useEffect(() => {
    if (open && initialItem) {
      selectItem(initialItem);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialItem?.id, initialItem?.mediaType]);

  // Alegerea manuală de torrent e legată de o listă de candidați anume — dacă
  // se schimbă calitatea, scopul sau sezonul/episodul ales, lista se schimbă
  // și alegerea veche nu mai are sens (cade înapoi pe "cel mai bun" automat).
  useEffect(() => {
    setSelectedTorrentId(null);
  }, [quality, tvScope, tvSeason, tvEpisode]);

  function onQueryChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = value.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        setResults(await searchFn({ data: { query: q } }));
      } finally {
        setSearching(false);
      }
    }, 400);
  }

  async function selectItem(item: TmdbSearchResult) {
    setSelected(item);
    setStep("checking");
    try {
      const details = await detailsFn({ data: { id: item.id, mediaType: item.mediaType } });
      setTmdbDetails(details);
      const originalTitle = details.literalTitle || details.originalTitle || item.originalTitle;
      const [plexRes, filelistRes] = await Promise.all([
        plexFn({ data: { title: item.title, originalTitle, mediaType: item.mediaType } }),
        filelistFn({
          data: {
            title: item.title,
            originalTitle,
            imdbId: details.imdbId,
            mediaType: item.mediaType,
          },
        }),
      ]);
      const seasons = details.seasons
        .filter((s) => s.seasonNumber > 0)
        .map((s) => ({ seasonNumber: s.seasonNumber, episodeCount: s.episodeCount }));

      // Orice titlu identificat aici intră în `media` — indiferent dacă
      // userul ajunge să-l descarce sau doar îl fixează pentru urmărire (vezi
      // planul de unificare Lansări → Acasă+Bibliotecă). Best-effort, nu
      // blochează fluxul dacă eșuează.
      ensureMediaEntryFn({
        data: {
          mediaType: item.mediaType,
          imdbId: details.imdbId,
          tmdbId: item.id,
          title: item.title,
          originalTitle,
          literalTitle: details.literalTitle,
          year: item.year ? Number(item.year) : null,
          overviewRo: details.overview,
          genres: details.genres,
          posterPath: item.posterUrl,
          tvStatus: details.tvStatus,
        },
      }).catch(() => {});

      setCheckResult({
        imdbId: details.imdbId,
        originalTitle,
        plexFound: !!plexRes?.found,
        plexQuality: plexRes?.quality ?? null,
        torrents: filelistRes.status === "ok" ? filelistRes.torrents : [],
        seasons,
      });
      // Pentru seriale, "există în Plex" e la nivel de titlu — nu spune nimic
      // despre sezonul/episodul cerut (un serial în producție poate avea
      // sezoane vechi complete și unul nou parțial). Mergem mereu la alegerea
      // scopului; verificarea Plex per-sezon/episod (pentru TOATE sezoanele
      // deodată, ca badge-ul "Plex" să apară deja pe butoanele de sezon) se
      // face aici, înainte de a afișa pasul de scop.
      if (item.mediaType === "tv") {
        if (seasons.length > 0) {
          const plexResults = await Promise.allSettled(
            seasons.map((s) =>
              plexSeasonFn({ data: { showTitle: originalTitle, season: s.seasonNumber } }),
            ),
          );
          const map = new Map<number, number[]>();
          seasons.forEach((s, i) => {
            const r = plexResults[i];
            map.set(s.seasonNumber, r.status === "fulfilled" ? r.value.map((e) => e.num) : []);
          });
          setPlexBySeason(map);
        }
        setStep("tv-scope");
      } else {
        setStep("result");
      }
    } catch (e) {
      toast.error("Eroare la verificare", {
        description: e instanceof Error ? e.message : String(e),
      });
      setCheckResult({
        imdbId: null,
        originalTitle: item.originalTitle,
        plexFound: false,
        plexQuality: null,
        torrents: [],
        seasons: [],
      });
      setStep("result");
    }
  }

  // Metadatele TMDB deja cunoscute (titlu, gen, rezumat RO, imdb/tmdb id) —
  // trimise o dată cu descărcarea, ca torrentul să apară direct în tabela
  // `media` fără nicio căutare TMDB ulterioară (vezi Bibliotecă). `season`
  // vine explicit din apelant (nu din tvSeason) — la "Serial complet",
  // fiecare pachet descărcat e pentru un sezon diferit de starea curentă.
  function buildMediaPayload(season?: number) {
    if (!selected || !checkResult) return undefined;
    const parsedYear = selected.year ? Number(selected.year) : NaN;
    return {
      mediaType: (isTv ? "episode" : "movie") as "episode" | "movie",
      imdbId: checkResult.imdbId,
      tmdbId: selected.id,
      title: selected.title,
      originalTitle: checkResult.originalTitle,
      literalTitle: tmdbDetails?.literalTitle ?? null,
      year: Number.isFinite(parsedYear) ? parsedYear : null,
      season: isTv ? (season ?? tvSeason) : null,
      episode: isTv && tvScope === "episode" ? tvEpisode : null,
      overviewRo: tmdbDetails?.overview ?? null,
      genres: tmdbDetails?.genres ?? [],
      posterPath: selected.posterUrl ?? null,
      tvStatus: tmdbDetails?.tvStatus ?? null,
      isSeasonPack: isTv && tvScope !== "episode",
      addedVia: "wizard" as const,
    };
  }

  async function downloadNow(torrent: FilelistTorrent, season?: number) {
    setBusy(true);
    const toastId = toast.loading(`Se descarcă: ${torrent.name}…`);
    try {
      const res = await downloadFn({
        data: {
          torrentId: torrent.id,
          torrentName: torrent.name,
          categoryId: torrent.category,
          categoryName: torrent.categoryName,
          size: torrent.size,
          freeleech: torrent.freeleech,
          internal: torrent.internal,
          imdb: torrent.imdb,
          media: buildMediaPayload(season),
        },
      });
      if (res.status === "ok") {
        toast.success("Adăugat în qBittorrent!", {
          id: toastId,
          description: `${torrent.name} → ${res.savePath}`,
          duration: 6000,
        });
        queryClient.invalidateQueries({ queryKey: ["filelistLog"] });
        return true;
      }
      toast.error("Eroare la descărcare", { id: toastId, description: res.error, duration: 8000 });
      return false;
    } catch (e) {
      toast.error("Eroare neașteptată", {
        id: toastId,
        description: e instanceof Error ? e.message : String(e),
        duration: 8000,
      });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function downloadOne(torrent: FilelistTorrent) {
    if (await downloadNow(torrent)) {
      setDoneMessage(`„${torrent.name}” a fost adăugat în qBittorrent.`);
      setStep("done");
    }
  }

  // "Serial complet" — descarcă în serie (nu paralel, ca să nu suprasolicităm
  // qBittorrent/autentificarea) pachetul de sezon găsit pentru fiecare sezon
  // detectat pe Filelist la calitatea aleasă; sezoanele fără pachet disponibil
  // rămân nedescărcate (afișate separat), nu improvizăm cu episoade individuale.
  async function downloadAllAvailableSeasons(
    seasonPacks: Array<{ season: number; torrent: FilelistTorrent }>,
  ) {
    setBusy(true);
    let okCount = 0;
    for (const { season, torrent } of seasonPacks) {
      if (await downloadNow(torrent, season)) okCount++;
    }
    setBusy(false);
    if (okCount > 0) {
      toast.success(`${okCount}/${seasonPacks.length} sezoane adăugate în qBittorrent`);
      setDoneMessage(`${okCount}/${seasonPacks.length} sezoane adăugate în qBittorrent.`);
      setStep("done");
    }
  }

  async function pinForMonitoring() {
    if (!selected || !checkResult) return;
    setBusy(true);
    try {
      const alreadyPinned = pinned.some(
        (p) => p.id === selected.id && p.mediaType === selected.mediaType,
      );
      if (!alreadyPinned) {
        const next = [
          ...pinned,
          {
            id: selected.id,
            mediaType: selected.mediaType,
            title: selected.title,
            originalTitle: checkResult.originalTitle,
            posterUrl: selected.posterUrl ?? null,
          },
        ];
        await setPinnedFn({ data: { items: next } });
      }
      await setWatchFn({
        data: {
          id: selected.id,
          mediaType: selected.mediaType,
          watchFilelist: true,
          watchFilelistSeason: false,
          watchTmdb: false,
          autoDownload: true,
          autoDownloadQuality: quality,
        },
      });
      queryClient.invalidateQueries({ queryKey: ["pinnedItems"] });
      toast.success("Fixat pentru monitorizare automată", {
        description: `Se descarcă automat orice sezon nou apărut, la calitatea ${quality}.`,
        duration: 6000,
      });
      setDoneMessage(
        `Fixat pentru monitorizare automată — se descarcă orice sezon nou apărut, la calitatea ${quality}.`,
      );
      setStep("done");
    } catch (e) {
      toast.error("Eroare la fixare", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  const isTv = selected?.mediaType === "tv";
  const seasonGroups = checkResult ? groupTorrentsBySeasonEpisode(checkResult.torrents) : [];
  const selectedSeasonGroup = seasonGroups.find((g) => g.seasonNum === tvSeason) ?? null;
  const selectedSeasonMeta = checkResult?.seasons.find((s) => s.seasonNumber === tvSeason) ?? null;
  // Un sezon cu episodeCount 0 (anunțat, dar netransmis încă) nu poate fi
  // niciodată "complet" — fără garda asta, 0 episoade în Plex >= 0 episoade
  // TMDB ar da fals pozitiv.
  const isSeasonCompleteInPlex = (seasonNumber: number, episodeCount: number) =>
    episodeCount > 0 && (plexBySeason.get(seasonNumber)?.length ?? 0) >= episodeCount;
  const plexCompleteSeasonsCount =
    checkResult?.seasons.filter((s) => isSeasonCompleteInPlex(s.seasonNumber, s.episodeCount))
      .length ?? 0;

  // Ce a găsit Filelist per sezon, la calitatea aleasă — fie pachet de sezon
  // întreg, fie doar episoade individuale — folosit ca legătura TMDB↔Filelist
  // să fie vizibilă direct în lista de sezoane, nu doar aflată abia după ce
  // alegi un scop și descoperi lipsa la ecranul următor.
  function filelistStatusForSeason(seasonNum: number): "pack" | "episodes" | "none" {
    const g = seasonGroups.find((sg) => sg.seasonNum === seasonNum);
    if (!g) return "none";
    if (pickFromSet(g.byQuality, quality).length > 0) return "pack";
    if ([...g.episodes.values()].some((q) => pickFromSet(q, quality).length > 0)) return "episodes";
    return "none";
  }
  const filelistSeasonsFoundCount =
    checkResult?.seasons.filter((s) => filelistStatusForSeason(s.seasonNumber) !== "none").length ??
    0;

  // Rezultatul concret de arătat la pasul final, în funcție de tip și scop —
  // lista completă de candidați (nu doar cel mai bun), ca adminul să poată
  // alege manual între release-uri diferite; selecția efectivă cade pe
  // torrentul ales explicit (selectedTorrentId) dacă există în listă, altfel
  // pe cel cu cei mai mulți seederi.
  const sortBySeeders = (list: FilelistTorrent[]) =>
    [...list].sort((a, b) => b.seeders - a.seeders);

  const movieMatches = !isTv && checkResult ? matchesForQuality(checkResult.torrents, quality) : [];
  const movieMatch = movieMatches.find((t) => t.id === selectedTorrentId) ?? bestOf(movieMatches);

  const seasonMatches =
    isTv && tvScope === "season" && selectedSeasonGroup
      ? sortBySeeders(pickFromSet(selectedSeasonGroup.byQuality, quality))
      : [];
  const seasonMatch =
    seasonMatches.find((t) => t.id === selectedTorrentId) ?? bestOf(seasonMatches);

  const episodeMatches =
    isTv && tvScope === "episode" && selectedSeasonGroup && tvEpisode
      ? sortBySeeders(
          pickFromSet(selectedSeasonGroup.episodes.get(tvEpisode) ?? emptyQualitySet(), quality),
        )
      : [];
  const episodeMatch =
    episodeMatches.find((t) => t.id === selectedTorrentId) ?? bestOf(episodeMatches);
  // Sezoanele deja complete în Plex nu se mai propun la descărcare — nici ca
  // pachet disponibil, nici ca "lipsă" (nu lipsesc, sunt deja deținute).
  const seriesPacks =
    isTv && tvScope === "series" && checkResult
      ? checkResult.seasons
          .filter((s) => !isSeasonCompleteInPlex(s.seasonNumber, s.episodeCount))
          .map((s) => {
            const g = seasonGroups.find((sg) => sg.seasonNum === s.seasonNumber);
            const torrent = g ? bestOf(pickFromSet(g.byQuality, quality)) : null;
            return torrent ? { season: s.seasonNumber, torrent } : null;
          })
          .filter((x): x is { season: number; torrent: FilelistTorrent } => x !== null)
      : [];
  const seriesMissingSeasons =
    isTv && tvScope === "series" && checkResult
      ? checkResult.seasons
          .filter((s) => !isSeasonCompleteInPlex(s.seasonNumber, s.episodeCount))
          .map((s) => s.seasonNumber)
          .filter((sn) => !seriesPacks.some((p) => p.season === sn))
      : [];

  // Numerele episoadelor deja în Plex pentru sezonul curent ales — prefetch-uite
  // pentru toate sezoanele deodată în selectItem().
  const plexNumsForSeason = tvSeason !== null ? (plexBySeason.get(tvSeason) ?? null) : null;

  // Pentru filme, "există în Plex" e suficient (verificare atomică). Pentru
  // seriale, folosim strict verificarea per-sezon/episod — nu
  // checkResult.plexFound (la nivel de titlu, ar bloca greșit un serial în
  // producție care are doar sezoane vechi complete).
  const plexSeasonComplete =
    isTv &&
    tvScope === "season" &&
    !!selectedSeasonMeta &&
    isSeasonCompleteInPlex(selectedSeasonMeta.seasonNumber, selectedSeasonMeta.episodeCount);
  const plexEpisodeDone =
    isTv &&
    tvScope === "episode" &&
    plexNumsForSeason !== null &&
    tvEpisode !== null &&
    plexNumsForSeason.includes(tvEpisode);
  const plexSeriesComplete =
    isTv &&
    tvScope === "series" &&
    !!checkResult &&
    checkResult.seasons.length > 0 &&
    checkResult.seasons.every((s) => isSeasonCompleteInPlex(s.seasonNumber, s.episodeCount));
  const alreadyInPlex =
    (!isTv && !!checkResult?.plexFound) ||
    plexSeasonComplete ||
    plexEpisodeDone ||
    plexSeriesComplete;

  const showQualityAndAction = !!checkResult && !alreadyInPlex;

  // Navigare "înapoi" reală (nu doar reset complet) — revine la pasul
  // anterior semnificativ din flux, păstrând căutarea/rezultatele deja
  // încărcate acolo unde are sens. Când wizard-ul e deschis prefill (din
  // Descoperă), nu există pas de căutare la care să te întorci — înapoi
  // închide direct.
  function goBack() {
    if (initialItem) {
      handleClose();
      return;
    }
    if (step === "tv-scope") {
      setStep("search");
      setSelected(null);
      setCheckResult(null);
      setTmdbDetails(null);
      setTvScope("series");
      setTvSeason(null);
      setTvEpisode(null);
      setPlexBySeason(new Map());
      setEpisodeTitles(null);
      setSelectedTorrentId(null);
      return;
    }
    if (step === "result") {
      if (isTv) {
        setStep("tv-scope");
        setSelectedTorrentId(null);
        return;
      }
      setStep("search");
      setSelected(null);
      setCheckResult(null);
      setTmdbDetails(null);
      setSelectedTorrentId(null);
      return;
    }
  }

  // Statusul Plex al sezonului ales e deja încărcat din selectItem() — aici
  // doar trecem la pasul de rezultat.
  function proceedToResult() {
    setStep("result");
  }

  // Pașii afișați în indicatorul de progres — dinamici, în funcție de tip
  // (serialele au un pas în plus, "Scop") și de faptul că pasul de căutare
  // e sărit când wizard-ul a fost deschis prefill.
  const stepperSteps: Array<{ key: Step; label: string }> = [
    ...(initialItem ? [] : [{ key: "search" as Step, label: "Căutare" }]),
    { key: "checking", label: "Verificare" },
    ...(isTv ? [{ key: "tv-scope" as Step, label: "Scop" }] : []),
    { key: "result", label: "Rezultat" },
  ];
  const effectiveStep = step === "search" && initialItem ? "checking" : step;
  const stepperIndex = stepperSteps.findIndex((s) => s.key === effectiveStep);

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
        <DialogContent className="top-8 flex max-h-[calc(100dvh-4rem)] w-[calc(100%-2rem)] max-w-md translate-y-0 flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:w-full">
          <DialogHeader className="shrink-0 space-y-0 p-4 pb-0 text-left">
            <div className="flex items-center gap-2">
              {(step === "result" || step === "tv-scope") && (
                <button
                  type="button"
                  onClick={goBack}
                  className="shrink-0 rounded-lg p-1 text-muted-foreground hover:text-foreground hover:bg-muted/60"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
              )}
              <DialogTitle className="flex-1 pr-6">Adaugă film/serial</DialogTitle>
            </div>
            {step !== "done" && stepperSteps.length > 1 && (
              <div className="flex items-center gap-1 pt-2">
                {stepperSteps.map((s, i) => (
                  <div key={s.key} className="flex flex-1 items-center gap-1">
                    <div
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold transition-colors ${
                        i < stepperIndex
                          ? "bg-primary text-primary-foreground"
                          : i === stepperIndex
                            ? "bg-primary/20 text-primary ring-1 ring-primary"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {i < stepperIndex ? <Check className="h-3 w-3" /> : i + 1}
                    </div>
                    {i < stepperSteps.length - 1 && (
                      <div
                        className={`h-0.5 flex-1 rounded-full transition-colors ${
                          i < stepperIndex ? "bg-primary" : "bg-muted"
                        }`}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto px-4 pb-6 pt-3">
            {step === "search" && !initialItem && (
              <SearchStep
                query={query}
                onQueryChange={onQueryChange}
                searching={searching}
                results={results}
                onSelect={selectItem}
              />
            )}

            {(step === "checking" || (step === "search" && initialItem)) && (
              <div className="animate-in fade-in duration-200 space-y-4">
                <div className="relative h-28 animate-pulse overflow-hidden rounded-2xl bg-muted/40" />
                <div className="space-y-2">
                  <div className="h-4 w-2/3 animate-pulse rounded bg-muted/40" />
                  <div className="h-3 w-1/3 animate-pulse rounded bg-muted/40" />
                </div>
                <div className="flex items-center justify-center gap-2 pt-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Verific Plex și Filelist pentru „{selected?.title ?? initialItem?.title}”…
                </div>
              </div>
            )}

            {step === "tv-scope" && selected && checkResult && (
              <div className="animate-in fade-in slide-in-from-right-2 duration-200 space-y-4">
                <PosterHero
                  posterUrl={selected.posterUrl}
                  mediaType={selected.mediaType}
                  title={selected.title}
                  subtitle={checkResult.originalTitle}
                />
                {tmdbDetails?.tvStatus && ONGOING_TV_STATUSES.has(tmdbDetails.tvStatus) && (
                  <div className="space-y-2 rounded-xl bg-amber-500/10 p-3 text-xs text-amber-300">
                    <div className="flex items-start gap-2">
                      <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>
                        {tmdbDetails.nextEpisode
                          ? `Episodul S${String(tmdbDetails.nextEpisode.seasonNumber).padStart(2, "0")}E${String(tmdbDetails.nextEpisode.episodeNumber).padStart(2, "0")} apare pe ${new Date(tmdbDetails.nextEpisode.airDate).toLocaleDateString("ro-RO", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Bucharest" })}.`
                          : `Serialul e reînnoit (${tvStatusLabel(tmdbDetails.tvStatus)}), dar fără dată anunțată încă pentru episoade noi.`}{" "}
                        Fixează-l pentru urmărire, ca sezoanele/episoadele noi să fie descărcate
                        automat imediat ce apar.
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={pinForMonitoring}
                      className="flex w-full items-center justify-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/15 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/25 disabled:opacity-50"
                    >
                      {busy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Pin className="h-3.5 w-3.5" />
                      )}
                      Fixează pentru urmărire automată ({quality})
                    </button>
                  </div>
                )}
                <div className="text-sm text-muted-foreground">
                  Ce vrei să descarci din{" "}
                  <span className="font-medium text-foreground">{selected.title}</span>?
                </div>
                <div className="space-y-2">
                  <ScopeOption
                    icon={<Layers className="h-4 w-4" />}
                    label="Serial complet"
                    description={`${plexCompleteSeasonsCount}/${checkResult.seasons.length} sezoane complete în Plex · ${filelistSeasonsFoundCount}/${checkResult.seasons.length} găsite pe Filelist (${quality})`}
                    meta={`${checkResult.seasons.length} sezoane`}
                    active={tvScope === "series"}
                    onClick={() => setTvScope("series")}
                  />
                  <ScopeOption
                    icon={<Clapperboard className="h-4 w-4" />}
                    label="Un sezon anume"
                    description="Alege sezonul de mai jos"
                    meta={`${plexCompleteSeasonsCount}/${checkResult.seasons.length} complete în Plex`}
                    active={tvScope === "season"}
                    onClick={() => setTvScope("season")}
                  />
                  <ScopeOption
                    icon={<Film className="h-4 w-4" />}
                    label="Un episod anume"
                    description="Alege sezonul și episodul"
                    active={tvScope === "episode"}
                    onClick={() => setTvScope("episode")}
                  />
                </div>

                {/* Legătura TMDB ↔ Filelist, vizibilă direct, sezon cu sezon —
                    nu abia după ce alegi un scop. */}
                <div>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Ce am găsit, sezon cu sezon
                  </div>
                  <div className="space-y-1">
                    {checkResult.seasons.map((s) => {
                      const plexNums = plexBySeason.get(s.seasonNumber) ?? [];
                      const plexFull = isSeasonCompleteInPlex(s.seasonNumber, s.episodeCount);
                      const filelistStatus = filelistStatusForSeason(s.seasonNumber);
                      return (
                        <div
                          key={s.seasonNumber}
                          className="flex items-center justify-between gap-2 rounded-lg bg-muted/30 px-2.5 py-1.5 text-xs"
                        >
                          <span className="font-medium">
                            S{String(s.seasonNumber).padStart(2, "0")}
                            <span className="ml-1 font-normal text-muted-foreground">
                              ({s.episodeCount} ep)
                            </span>
                          </span>
                          <div className="flex items-center gap-1.5">
                            {plexFull ? (
                              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                                Plex complet
                              </span>
                            ) : plexNums.length > 0 ? (
                              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                                Plex {plexNums.length}/{s.episodeCount}
                              </span>
                            ) : null}
                            {filelistStatus === "pack" ? (
                              <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium text-sky-400">
                                Pachet pe Filelist
                              </span>
                            ) : filelistStatus === "episodes" ? (
                              <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium text-sky-400">
                                Episoade pe Filelist
                              </span>
                            ) : (
                              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                Negăsit ({quality})
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {(tvScope === "season" || tvScope === "episode") && (
                  <div>
                    <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Sezon
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {checkResult.seasons.map((s) => {
                        const plexNums = plexBySeason.get(s.seasonNumber) ?? [];
                        const plexFull = plexNums.length >= s.episodeCount && s.episodeCount > 0;
                        const plexPartial = plexNums.length > 0 && !plexFull;
                        return (
                          <button
                            key={s.seasonNumber}
                            type="button"
                            onClick={() => selectSeason(s.seasonNumber)}
                            className={`relative rounded-lg border px-2.5 py-1.5 text-sm font-medium transition-colors active:scale-95 ${
                              tvSeason === s.seasonNumber
                                ? "border-primary bg-primary/15 text-primary"
                                : "border-border bg-muted/40 text-muted-foreground hover:bg-muted/60"
                            }`}
                          >
                            {(plexFull || plexPartial) && (
                              <span
                                className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ${
                                  plexFull ? "bg-emerald-400" : "bg-emerald-400/50"
                                }`}
                                title={
                                  plexFull
                                    ? "Sezon complet în Plex"
                                    : `${plexNums.length}/${s.episodeCount} episoade în Plex`
                                }
                              />
                            )}
                            <div className="leading-tight">
                              S{String(s.seasonNumber).padStart(2, "0")}
                            </div>
                            <div className="text-[9px] font-normal text-muted-foreground">
                              {s.episodeCount} ep
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {tvScope === "episode" && selectedSeasonMeta && (
                  <div>
                    <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Episod
                    </div>
                    {loadingEpisodeTitles && episodeTitles?.season !== tvSeason ? (
                      <div className="space-y-1.5">
                        {Array.from({ length: 3 }).map((_, i) => (
                          <div key={i} className="h-11 animate-pulse rounded-lg bg-muted/40" />
                        ))}
                      </div>
                    ) : selectedSeasonMeta.episodeCount === 0 ? (
                      <div className="rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">
                        Nu are încă niciun episod anunțat cu număr — alege alt sezon.
                      </div>
                    ) : (
                      <div className="max-h-56 space-y-1.5 overflow-y-auto pr-0.5">
                        {Array.from(
                          { length: selectedSeasonMeta.episodeCount },
                          (_, i) => i + 1,
                        ).map((ep) => {
                          const inPlex = plexNumsForSeason?.includes(ep) ?? false;
                          const epTitle =
                            episodeTitles?.season === tvSeason
                              ? findEpisodeTitle(episodeTitles.episodes, ep)
                              : undefined;
                          return (
                            <button
                              key={ep}
                              type="button"
                              onClick={() => setTvEpisode(ep)}
                              className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm font-medium transition-colors active:scale-[0.98] ${
                                tvEpisode === ep
                                  ? "border-primary bg-primary/15 text-primary"
                                  : "border-border bg-muted/40 text-muted-foreground hover:bg-muted/60"
                              }`}
                            >
                              <span className="shrink-0 tabular-nums">
                                E{String(ep).padStart(2, "0")}
                              </span>
                              <span className="min-w-0 flex-1 truncate">
                                {epTitle ?? `Episodul ${ep}`}
                              </span>
                              {inPlex && (
                                <span
                                  className="flex shrink-0 items-center gap-0.5 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400"
                                  title="Deja în bibliotecă Plex"
                                >
                                  <CheckCircle2 className="h-2.5 w-2.5" /> Plex
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  disabled={
                    (tvScope === "season" && tvSeason === null) ||
                    (tvScope === "episode" && (tvSeason === null || tvEpisode === null)) ||
                    loadingEpisodeTitles
                  }
                  onClick={proceedToResult}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-40"
                >
                  {loadingEpisodeTitles && <Loader2 className="h-4 w-4 animate-spin" />}
                  Continuă
                </button>
              </div>
            )}

            {step === "result" && selected && checkResult && (
              <div className="animate-in fade-in slide-in-from-right-2 duration-200 space-y-4">
                <PosterHero
                  posterUrl={selected.posterUrl}
                  mediaType={selected.mediaType}
                  title={
                    selected.title +
                    (isTv && tvScope === "season" && tvSeason
                      ? ` — S${String(tvSeason).padStart(2, "0")}`
                      : "") +
                    (isTv && tvScope === "episode" && tvSeason && tvEpisode
                      ? ` — S${String(tvSeason).padStart(2, "0")}E${String(tvEpisode).padStart(2, "0")}`
                      : "")
                  }
                  subtitle={
                    isTv && tvScope === "episode" && episodeTitles?.season === tvSeason && tvEpisode
                      ? findEpisodeTitle(episodeTitles.episodes, tvEpisode)
                      : checkResult.originalTitle + (selected.year ? ` · ${selected.year}` : "")
                  }
                />

                {alreadyInPlex ? (
                  <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-400">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    {!isTv && "Deja în bibliotecă Plex"}
                    {!isTv && checkResult.plexQuality ? ` — ${checkResult.plexQuality}` : ""}
                    {isTv && tvScope === "season" && `Sezonul ${tvSeason} e deja complet în Plex`}
                    {isTv &&
                      tvScope === "episode" &&
                      `Episodul S${String(tvSeason).padStart(2, "0")}E${String(tvEpisode).padStart(2, "0")} e deja în Plex`}
                    {isTv && tvScope === "series" && "Toate sezoanele sunt deja complete în Plex"}
                  </div>
                ) : (
                  showQualityAndAction && (
                    <>
                      {isTv &&
                        tvScope === "season" &&
                        selectedSeasonMeta &&
                        plexNumsForSeason !== null &&
                        plexNumsForSeason.length > 0 && (
                          <div className="rounded-xl border border-border bg-card p-3 text-xs text-muted-foreground">
                            {plexNumsForSeason.length}/{selectedSeasonMeta.episodeCount} episoade
                            deja în Plex — descarci pachetul complet de sezon oricum, ca să prinzi
                            și episoadele lipsă/noi.
                          </div>
                        )}
                      <div>
                        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Calitate
                        </div>
                        <div className="flex gap-2">
                          {(
                            [
                              { q: "720p", color: "neutral" },
                              { q: "1080p", color: "blue" },
                              { q: "4K", color: "purple" },
                              { q: "4K HDR", color: "amber" },
                            ] as const
                          ).map(({ q, color }) => {
                            const active = quality === q;
                            const styles = {
                              neutral: active
                                ? "border-neutral-400/70 bg-neutral-500/30 text-neutral-200 shadow-sm shadow-neutral-500/30"
                                : "border-neutral-500/40 bg-neutral-500/10 text-neutral-400 hover:bg-neutral-500/20 hover:text-neutral-300",
                              blue: active
                                ? "border-blue-400/70 bg-blue-500/30 text-blue-200 shadow-sm shadow-blue-500/30"
                                : "border-blue-500/40 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 hover:text-blue-300",
                              purple: active
                                ? "border-purple-400/70 bg-purple-500/30 text-purple-200 shadow-sm shadow-purple-500/30"
                                : "border-purple-500/40 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 hover:text-purple-300",
                              amber: active
                                ? "border-amber-400/70 bg-amber-500/30 text-amber-200 shadow-sm shadow-amber-500/30"
                                : "border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 hover:text-amber-300",
                            };
                            return (
                              <button
                                key={q}
                                type="button"
                                onClick={() => setQuality(q)}
                                className={`flex-1 rounded-xl border px-3 py-1.5 text-sm font-medium transition-colors active:scale-95 ${styles[color]}`}
                              >
                                {q}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Film */}
                      {!isTv && movieMatch && (
                        <>
                          {isAdmin && (
                            <TorrentPicker
                              matches={movieMatches}
                              selectedId={movieMatch.id}
                              onSelect={setSelectedTorrentId}
                            />
                          )}
                          <ActionButton
                            busy={busy}
                            icon={<Download className="h-4 w-4" />}
                            label="Descarcă acum"
                            onClick={() =>
                              setConfirmTorrent({ torrent: movieMatch, label: "Film" })
                            }
                          />
                        </>
                      )}
                      {!isTv && !movieMatch && (
                        <NotFoundWithPin
                          quality={quality}
                          busy={busy}
                          onPin={pinForMonitoring}
                          label="filmul"
                        />
                      )}

                      {/* Sezon */}
                      {isTv && tvScope === "season" && seasonMatch && (
                        <>
                          {isAdmin && (
                            <TorrentPicker
                              matches={seasonMatches}
                              selectedId={seasonMatch.id}
                              onSelect={setSelectedTorrentId}
                            />
                          )}
                          <ActionButton
                            busy={busy}
                            icon={<Download className="h-4 w-4" />}
                            label="Descarcă sezonul"
                            onClick={() =>
                              setConfirmTorrent({ torrent: seasonMatch, label: "Sezon complet" })
                            }
                          />
                        </>
                      )}
                      {isTv && tvScope === "season" && !seasonMatch && (
                        <NotFoundWithPin
                          quality={quality}
                          busy={busy}
                          onPin={pinForMonitoring}
                          label="serialul"
                        />
                      )}

                      {/* Episod */}
                      {isTv && tvScope === "episode" && episodeMatch && (
                        <>
                          {isAdmin && (
                            <TorrentPicker
                              matches={episodeMatches}
                              selectedId={episodeMatch.id}
                              onSelect={setSelectedTorrentId}
                            />
                          )}
                          <ActionButton
                            busy={busy}
                            icon={<Download className="h-4 w-4" />}
                            label="Descarcă episodul"
                            onClick={() =>
                              setConfirmTorrent({ torrent: episodeMatch, label: "Episod" })
                            }
                          />
                        </>
                      )}
                      {isTv && tvScope === "episode" && !episodeMatch && (
                        <NotFoundWithPin
                          quality={quality}
                          busy={busy}
                          onPin={pinForMonitoring}
                          label="serialul"
                        />
                      )}

                      {/* Serial complet */}
                      {isTv && tvScope === "series" && (
                        <div className="space-y-2">
                          {seriesPacks.length > 0 && (
                            <div className="rounded-xl border border-border bg-card p-3 text-sm">
                              <div className="mb-1 font-medium">Sezoane disponibile acum:</div>
                              <div className="text-muted-foreground">
                                {seriesPacks
                                  .map((p) => `S${String(p.season).padStart(2, "0")}`)
                                  .join(", ")}
                              </div>
                            </div>
                          )}
                          {seriesMissingSeasons.length > 0 && (
                            <div className="rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">
                              Încă nu au pachet complet la {quality}:{" "}
                              {seriesMissingSeasons
                                .map((s) => `S${String(s).padStart(2, "0")}`)
                                .join(", ")}
                            </div>
                          )}
                          {seriesPacks.length > 0 && (
                            <ActionButton
                              busy={busy}
                              icon={<Download className="h-4 w-4" />}
                              label={`Descarcă ${seriesPacks.length} sezon(oane) disponibile`}
                              onClick={() => setConfirmSeries(seriesPacks)}
                            />
                          )}
                          {(seriesMissingSeasons.length > 0 ||
                            (tmdbDetails?.tvStatus &&
                              ONGOING_TV_STATUSES.has(tmdbDetails.tvStatus))) && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={pinForMonitoring}
                              className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-muted/40 py-2.5 text-sm font-semibold text-foreground hover:bg-muted/60 disabled:opacity-50"
                            >
                              {busy ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Pin className="h-4 w-4" />
                              )}
                              Fixează pentru monitorizare automată ({quality})
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )
                )}
              </div>
            )}

            {step === "done" && <DoneStep doneMessage={doneMessage} onClose={handleClose} />}
          </div>
        </DialogContent>
      </Dialog>

      {confirmTorrent && (
        <DownloadConfirmDialog
          torrent={confirmTorrent.torrent}
          label={confirmTorrent.label}
          onCancel={() => setConfirmTorrent(null)}
          onConfirm={() => {
            downloadOne(confirmTorrent.torrent);
            setConfirmTorrent(null);
          }}
        />
      )}

      <AlertDialog open={!!confirmSeries} onOpenChange={(o) => !o && setConfirmSeries(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmare descărcare</AlertDialogTitle>
            <AlertDialogDescription>
              Descarci pachetul complet pentru {confirmSeries?.length} sezon(oane)?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1">
            {confirmSeries?.map((p) => (
              <div key={p.season} className="break-all text-xs text-foreground">
                S{String(p.season).padStart(2, "0")} — {p.torrent.name}
              </div>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Anulează</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmSeries) downloadAllAvailableSeasons(confirmSeries);
                setConfirmSeries(null);
              }}
            >
              Descarcă
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
