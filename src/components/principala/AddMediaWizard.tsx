import { useEffect, useRef, useState } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, CheckCircle2, Download, Pin, ArrowLeft, Check, Info } from "lucide-react";
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
import { searchTmdb, getTmdbDetails, getTmdbAllSeasons } from "@/lib/tmdb.functions";
import type { TmdbDetails, TmdbSeasonSchema } from "@/lib/tmdb.functions";
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
import { ActionButton, TorrentPicker, NotFoundWithPin, PosterHero } from "./wizard/WizardControls";
import { SearchStep } from "./wizard/SearchStep";
import { DoneStep } from "./wizard/DoneStep";
import { SeasonAccordion } from "./wizard/SeasonAccordion";
import type { EpisodeAvailability, SeasonRowData } from "./wizard/SeasonAccordion";

type Quality = WatchQuality;
type Step = "search" | "checking" | "result" | "done";

interface CheckResult {
  imdbId: string | null;
  originalTitle: string;
  plexFound: boolean;
  plexQuality: string | null;
  torrents: FilelistTorrent[];
  seasons: Array<{ seasonNumber: number; episodeCount: number }>;
}

interface PlexSeasonEpisode {
  num: number;
  quality: string | null;
  watched: boolean;
}

interface BulkDownloadItem {
  torrent: FilelistTorrent;
  season: number;
  episode?: number;
  isSeasonPack: boolean;
  label: string;
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

function sortBySeeders(list: FilelistTorrent[]): FilelistTorrent[] {
  return [...list].sort((a, b) => b.seeders - a.seeders);
}

// Toate torrentele care se potrivesc la o calitate, sortate după seederi —
// spre deosebire de bestOf, păstrează toată lista, ca adminul să poată alege
// manual între release-uri diferite (ex. grupuri diferite cu același IMDb ID)
// — folosit doar pentru filme; sezoane/episoade descarcă direct cel mai bun
// candidat (vezi SeasonAccordion).
function matchesForQuality(torrents: FilelistTorrent[], quality: Quality): FilelistTorrent[] {
  return sortBySeeders(
    torrents.filter((t) => {
      const q = detectQuality(t.name);
      if (quality === "720p") return q.is720p;
      if (quality === "1080p") return q.is1080p;
      if (quality === "4K") return q.is4k;
      return q.is4kHdr;
    }),
  );
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
  const allSeasonsFn = useServerFn(getTmdbAllSeasons);
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
  const [busy, setBusy] = useState(false);
  const [downloadingTorrentId, setDownloadingTorrentId] = useState<number | null>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);
  // Schema completă (toate sezoanele + episoade + date de lansare) — un
  // singur request suplimentar (vezi getTmdbAllSeasons), adus o dată la
  // verificare, nu per sezon la extindere.
  const [seasonSchema, setSeasonSchema] = useState<TmdbSeasonSchema[]>([]);
  // Episoadele deja în Plex, per sezon — adus dintr-o dată pentru TOATE
  // sezoanele imediat ce serialul e identificat (selectItem).
  const [plexBySeason, setPlexBySeason] = useState<Map<number, PlexSeasonEpisode[]>>(new Map());
  // Torrentul ales manual de admin pentru filme, când sunt mai multe
  // disponibile la aceeași calitate (grupuri de release diferite etc) — dacă
  // nu alege nimeni explicit, cade pe cel cu cei mai mulți seederi. Sezoanele/
  // episoadele descarcă direct cel mai bun candidat, fără alegere manuală.
  const [selectedTorrentId, setSelectedTorrentId] = useState<number | null>(null);
  // Torrentul în așteptare de confirmare — nimic nu pornește efectiv în
  // qBittorrent până nu confirmă adminul din dialog. season/episode/
  // isSeasonPack descriu exact ce se descarcă, pentru `media`.
  const [confirmTorrent, setConfirmTorrent] = useState<{
    torrent: FilelistTorrent;
    label: string;
    season?: number;
    episode?: number;
    isSeasonPack?: boolean;
  } | null>(null);
  // Planul de descărcare în masă ("Descarcă tot ce lipsește") — listat
  // explicit înainte de confirmare, ca adminul să vadă exact ce urmează să
  // pornească (pachete de sezon + episoade individuale, acolo unde nu există
  // pachet complet).
  const [confirmBulk, setConfirmBulk] = useState<BulkDownloadItem[] | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function reset() {
    setStep("search");
    setQuery("");
    setResults([]);
    setSelected(null);
    setCheckResult(null);
    setTmdbDetails(null);
    setQuality("1080p");
    setBusy(false);
    setDownloadingTorrentId(null);
    setDoneMessage(null);
    setSeasonSchema([]);
    setPlexBySeason(new Map());
    setSelectedTorrentId(null);
    setConfirmTorrent(null);
    setConfirmBulk(null);
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

  // Alegerea manuală de torrent (filme) e legată de o listă de candidați la o
  // anumită calitate — dacă se schimbă calitatea, lista se schimbă și
  // alegerea veche nu mai are sens (cade înapoi pe "cel mai bun" automat).
  useEffect(() => {
    setSelectedTorrentId(null);
  }, [quality]);

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

      // Pentru seriale: schema completă (toate sezoanele/episoadele, un
      // singur request suplimentar) + statusul Plex per-sezon (pentru TOATE
      // sezoanele deodată) — totul gata înainte de a arăta ecranul de
      // rezultat, ca extinderea unui sezon să nu declanșeze cereri noi.
      if (item.mediaType === "tv" && seasons.length > 0) {
        const [plexResults, schema] = await Promise.all([
          Promise.allSettled(
            seasons.map((s) =>
              plexSeasonFn({ data: { showTitle: originalTitle, season: s.seasonNumber } }),
            ),
          ),
          allSeasonsFn({
            data: { tmdbId: item.id, seasonNumbers: seasons.map((s) => s.seasonNumber) },
          }),
        ]);
        const map = new Map<number, PlexSeasonEpisode[]>();
        seasons.forEach((s, i) => {
          const r = plexResults[i];
          map.set(s.seasonNumber, r.status === "fulfilled" ? r.value : []);
        });
        setPlexBySeason(map);
        setSeasonSchema(schema);
      }
      setStep("result");
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
  // `media` fără nicio căutare TMDB ulterioară (vezi Bibliotecă).
  function buildMediaPayload(opts: {
    season: number | null;
    episode: number | null;
    isSeasonPack: boolean;
  }) {
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
      season: isTv ? opts.season : null,
      episode: isTv ? opts.episode : null,
      overviewRo: tmdbDetails?.overview ?? null,
      genres: tmdbDetails?.genres ?? [],
      posterPath: selected.posterUrl ?? null,
      tvStatus: tmdbDetails?.tvStatus ?? null,
      isSeasonPack: opts.isSeasonPack,
      addedVia: "wizard" as const,
    };
  }

  async function downloadNow(
    torrent: FilelistTorrent,
    opts: { season: number | null; episode: number | null; isSeasonPack: boolean },
  ) {
    setBusy(true);
    setDownloadingTorrentId(torrent.id);
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
          media: buildMediaPayload(opts),
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
      setDownloadingTorrentId(null);
    }
  }

  async function downloadOne(
    torrent: FilelistTorrent,
    opts: { season: number | null; episode: number | null; isSeasonPack: boolean },
  ) {
    if (await downloadNow(torrent, opts)) {
      setDoneMessage(`„${torrent.name}” a fost adăugat în qBittorrent.`);
      setStep("done");
    }
  }

  // "Descarcă tot ce lipsește" — pornește în serie (nu paralel, ca să nu
  // suprasolicităm qBittorrent/autentificarea) fiecare element din plan:
  // pachet de sezon acolo unde există, altfel fiecare episod individual găsit
  // (vezi computeBulkPlan) — nimic din ce e disponibil nu rămâne pe dinafară.
  async function downloadBulk(items: BulkDownloadItem[]) {
    setBusy(true);
    let okCount = 0;
    for (const item of items) {
      const success = await downloadNow(item.torrent, {
        season: item.season,
        episode: item.episode ?? null,
        isSeasonPack: item.isSeasonPack,
      });
      if (success) okCount++;
    }
    setBusy(false);
    if (okCount > 0) {
      toast.success(`${okCount}/${items.length} descărcări adăugate în qBittorrent`);
      setDoneMessage(`${okCount}/${items.length} descărcări adăugate în qBittorrent.`);
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

  // Schema per-sezon afișată în accordion: pentru fiecare episod, exact una
  // din cele 4 stări cerute — deja în Plex, lipsă+descărcabil, lipsă+
  // indisponibil, sau nelansat încă (cu dată, dacă TMDB o are stabilită; fără
  // dată cunoscută, tratăm episodul ca "indisponibil", nu ca "nelansat" — nu
  // inventăm o dată care nu există).
  const seasonRows: SeasonRowData[] =
    isTv && checkResult
      ? checkResult.seasons.map((s) => {
          const schema = seasonSchema.find((x) => x.seasonNumber === s.seasonNumber);
          const group = seasonGroups.find((g) => g.seasonNum === s.seasonNumber);
          const plexMap = new Map((plexBySeason.get(s.seasonNumber) ?? []).map((e) => [e.num, e]));
          const packTorrent = group ? bestOf(pickFromSet(group.byQuality, quality)) : null;

          const tmdbEpisodes = schema?.episodes ?? [];
          const filelistEpNums = Array.from(group?.episodes.keys() ?? []).sort((a, b) => a - b);
          // Sezon complet fără nicio urmă nicăieri (nici TMDB, nici Filelist,
          // nici pachet) — anunțat doar cu un număr de episoade planificate
          // (episodeCount din rezumatul serialului). Sintetizăm acele
          // "sloturi" ca nelansate, fără dată — altfel sezonul ar arăta gol/
          // "—", indistigabil de o eroare, deși chiar urmează să apară. Dacă
          // există fie episoade TMDB, fie ceva pe Filelist (episoade sau
          // pachet), NU sintetizăm nimic — folosim datele reale, ca să nu
          // ascundem un pachet deja disponibil sub un fals "nelansat".
          const seasonHasNoData =
            tmdbEpisodes.length === 0 && filelistEpNums.length === 0 && !packTorrent;
          const episodeNums =
            tmdbEpisodes.length > 0
              ? tmdbEpisodes.map((e) => e.episodeNum)
              : filelistEpNums.length > 0
                ? filelistEpNums
                : seasonHasNoData
                  ? Array.from({ length: s.episodeCount }, (_, i) => i + 1)
                  : [];

          const episodes = episodeNums.map((epNum) => {
            const tmdbEp = tmdbEpisodes.find((e) => e.episodeNum === epNum);
            const plexEp = plexMap.get(epNum);
            const title = tmdbEp?.title ?? `Episodul ${epNum}`;

            let availability: EpisodeAvailability;
            if (plexEp) {
              availability = { kind: "in_plex", quality: plexEp.quality };
            } else if (tmdbEp && !tmdbEp.aired) {
              availability = { kind: "upcoming", airDate: tmdbEp.airDate };
            } else if (!tmdbEp && seasonHasNoData) {
              availability = { kind: "upcoming", airDate: null };
            } else {
              const epTorrent = bestOf(
                pickFromSet(group?.episodes.get(epNum) ?? emptyQualitySet(), quality),
              );
              if (epTorrent) availability = { kind: "episode_torrent", torrent: epTorrent };
              else if (packTorrent) availability = { kind: "pack_only" };
              else availability = { kind: "unavailable" };
            }
            return { episodeNum: epNum, title, availability };
          });

          return { seasonNumber: s.seasonNumber, packTorrent, episodes };
        })
      : [];

  // "Descarcă tot ce lipsește" — sare peste sezoanele deja complete în Plex;
  // pentru restul, ia pachetul dacă există, altfel fiecare episod individual
  // găsit (niciodată ambele deodată pentru același sezon, ca să nu descărcăm
  // un pachet ȘI episoadele lui separat).
  const bulkPlan: BulkDownloadItem[] = seasonRows.flatMap((season): BulkDownloadItem[] => {
    if (
      season.episodes.length > 0 &&
      season.episodes.every((e) => e.availability.kind === "in_plex")
    ) {
      return [];
    }
    if (season.packTorrent) {
      return [
        {
          torrent: season.packTorrent,
          season: season.seasonNumber,
          isSeasonPack: true,
          label: `Sezonul ${season.seasonNumber} (pachet)`,
        },
      ];
    }
    return season.episodes
      .filter(
        (
          e,
        ): e is typeof e & {
          availability: Extract<EpisodeAvailability, { kind: "episode_torrent" }>;
        } => e.availability.kind === "episode_torrent",
      )
      .map((e) => ({
        torrent: e.availability.torrent,
        season: season.seasonNumber,
        episode: e.episodeNum,
        isSeasonPack: false,
        label: `S${String(season.seasonNumber).padStart(2, "0")}E${String(e.episodeNum).padStart(2, "0")}`,
      }));
  });

  const movieMatches = !isTv && checkResult ? matchesForQuality(checkResult.torrents, quality) : [];
  const movieMatch = movieMatches.find((t) => t.id === selectedTorrentId) ?? bestOf(movieMatches);

  // Pentru filme, "există în Plex" e suficient (verificare atomică).
  const alreadyInPlex = !isTv && !!checkResult?.plexFound;
  const showQualityAndAction = !isTv && !!checkResult && !alreadyInPlex;

  function handleDownloadPack(season: SeasonRowData, torrent: FilelistTorrent) {
    setConfirmTorrent({
      torrent,
      label: `Sezonul ${season.seasonNumber} (pachet)`,
      season: season.seasonNumber,
      isSeasonPack: true,
    });
  }

  function handleDownloadEpisode(
    season: SeasonRowData,
    episode: SeasonRowData["episodes"][number],
    torrent: FilelistTorrent,
  ) {
    setConfirmTorrent({
      torrent,
      label: `S${String(season.seasonNumber).padStart(2, "0")}E${String(episode.episodeNum).padStart(2, "0")}`,
      season: season.seasonNumber,
      episode: episode.episodeNum,
      isSeasonPack: false,
    });
  }

  // Navigare "înapoi" reală — revine la căutare, păstrând rezultatele deja
  // încărcate acolo unde are sens. Când wizard-ul e deschis prefill (din
  // Descoperă), nu există pas de căutare la care să te întorci — înapoi
  // închide direct.
  function goBack() {
    if (initialItem) {
      handleClose();
      return;
    }
    if (step === "result") {
      setStep("search");
      setSelected(null);
      setCheckResult(null);
      setTmdbDetails(null);
      setSeasonSchema([]);
      setPlexBySeason(new Map());
      setSelectedTorrentId(null);
      return;
    }
  }

  // Pașii afișați în indicatorul de progres — sărim peste "Căutare" când
  // wizard-ul a fost deschis prefill.
  const stepperSteps: Array<{ key: Step; label: string }> = [
    ...(initialItem ? [] : [{ key: "search" as Step, label: "Căutare" }]),
    { key: "checking", label: "Verificare" },
    { key: "result", label: "Rezultat" },
  ];
  const effectiveStep = step === "search" && initialItem ? "checking" : step;
  const stepperIndex = stepperSteps.findIndex((s) => s.key === effectiveStep);

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && !busy && handleClose()}>
        <DialogContent className="top-8 flex max-h-[calc(100dvh-4rem)] w-[calc(100%-2rem)] max-w-md translate-y-0 flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:w-full">
          <DialogHeader className="shrink-0 space-y-0 p-4 pb-0 text-left">
            <div className="flex items-center gap-2">
              {step === "result" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={goBack}
                  className="shrink-0 rounded-lg p-1 text-muted-foreground hover:text-foreground hover:bg-muted/60 disabled:opacity-40"
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

            {step === "result" && selected && checkResult && (
              <div className="animate-in fade-in slide-in-from-right-2 duration-200 space-y-4">
                <PosterHero
                  posterUrl={selected.posterUrl}
                  mediaType={selected.mediaType}
                  title={selected.title}
                  subtitle={
                    checkResult.originalTitle + (selected.year ? ` · ${selected.year}` : "")
                  }
                />

                {isTv ? (
                  <>
                    {tmdbDetails?.tvStatus && ONGOING_TV_STATUSES.has(tmdbDetails.tvStatus) && (
                      <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-xs text-amber-300">
                        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        <span>
                          {tmdbDetails.nextEpisode
                            ? `Episodul S${String(tmdbDetails.nextEpisode.seasonNumber).padStart(2, "0")}E${String(tmdbDetails.nextEpisode.episodeNumber).padStart(2, "0")} apare pe ${new Date(tmdbDetails.nextEpisode.airDate).toLocaleDateString("ro-RO", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Bucharest" })}.`
                            : `Serialul e reînnoit (${tvStatusLabel(tmdbDetails.tvStatus)}), dar fără dată anunțată încă pentru episoade noi.`}
                        </span>
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

                    <button
                      type="button"
                      disabled={busy}
                      onClick={pinForMonitoring}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-muted/40 py-2.5 text-sm font-semibold text-foreground hover:bg-muted/60 disabled:opacity-50"
                    >
                      {busy && !downloadingTorrentId ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Pin className="h-4 w-4" />
                      )}
                      Fixează pentru urmărire automată ({quality})
                    </button>

                    {bulkPlan.length > 0 && (
                      <ActionButton
                        busy={busy}
                        icon={<Download className="h-4 w-4" />}
                        label={`Descarcă tot ce lipsește (${bulkPlan.length})`}
                        onClick={() => setConfirmBulk(bulkPlan)}
                      />
                    )}

                    <div>
                      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Sezoane
                      </div>
                      <SeasonAccordion
                        seasons={seasonRows}
                        busy={busy}
                        downloadingTorrentId={downloadingTorrentId}
                        onDownloadPack={handleDownloadPack}
                        onDownloadEpisode={handleDownloadEpisode}
                      />
                    </div>
                  </>
                ) : alreadyInPlex ? (
                  <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-400">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    Deja în bibliotecă Plex
                    {checkResult.plexQuality ? ` — ${checkResult.plexQuality}` : ""}
                  </div>
                ) : (
                  showQualityAndAction && (
                    <>
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

                      {movieMatch ? (
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
                              setConfirmTorrent({
                                torrent: movieMatch,
                                label: "Film",
                                season: undefined,
                                episode: undefined,
                                isSeasonPack: false,
                              })
                            }
                          />
                        </>
                      ) : (
                        <NotFoundWithPin
                          quality={quality}
                          busy={busy}
                          onPin={pinForMonitoring}
                          label="filmul"
                        />
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
            downloadOne(confirmTorrent.torrent, {
              season: confirmTorrent.season ?? null,
              episode: confirmTorrent.episode ?? null,
              isSeasonPack: confirmTorrent.isSeasonPack ?? false,
            });
            setConfirmTorrent(null);
          }}
        />
      )}

      <AlertDialog open={!!confirmBulk} onOpenChange={(o) => !o && setConfirmBulk(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmare descărcare</AlertDialogTitle>
            <AlertDialogDescription>
              Pornești {confirmBulk?.length} descărcări — tot ce lipsește și e disponibil pe
              Filelist, la calitatea {quality}?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {confirmBulk?.map((item) => (
              <div key={`${item.season}-${item.episode ?? "pack"}`} className="text-xs">
                <span className="font-medium text-foreground">{item.label}</span>{" "}
                <span className="break-all text-muted-foreground">— {item.torrent.name}</span>
              </div>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Anulează</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmBulk) downloadBulk(confirmBulk);
                setConfirmBulk(null);
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
