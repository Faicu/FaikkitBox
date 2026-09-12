// Încărcarea datelor wizard-ului: căutarea TMDB (cu debounce) și verificarea
// completă a unui titlu.
//
// Verificarea e o singură cerere către server (`checkTitleForWizard`), care
// agregă acolo tot ce se cerea înainte din client în zece cereri separate —
// vezi măsurătorile din wizard-check.functions.ts.
//
// Scos din componentă la pasul 3 al refactorizării. Nu ține stare proprie:
// primește `dispatch` și scrie în reducer, ca sursa de adevăr să rămână una
// singură.
//
// Capcană cunoscută: `useServerFn` NU e memoizat — identitatea lui se schimbă
// la fiecare randare. Nu-l pune în deps de `useEffect`, altfel efectul rulează
// la nesfârșit. Aici funcțiile sunt chemate din handlere, nu din efecte, deci
// problema nu apare; efectul care cheamă `selectItem` la deschiderea prefill
// a rămas în componentă, cu deps pe id-ul titlului, nu pe funcție.

import { useRef } from "react";
import type { Dispatch } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { searchTmdb } from "@/lib/tmdb/tmdb.functions";
import type { TmdbSearchResult } from "@/lib/tmdb/tmdb.functions";
import { checkTitleForWizard } from "@/lib/wizard-check.functions";
import type { WizardAction } from "./state";

export function useWizardData(dispatch: Dispatch<WizardAction>) {
  const searchFn = useServerFn(searchTmdb);
  const checkFn = useServerFn(checkTitleForWizard);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onQueryChange(value: string) {
    dispatch({ type: "QUERY_CHANGED", query: value });
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = value.trim();
    if (q.length < 2) return;
    debounceRef.current = setTimeout(async () => {
      dispatch({ type: "SEARCH_STARTED" });
      try {
        dispatch({ type: "SEARCH_RESULTS", results: await searchFn({ data: { query: q } }) });
      } catch {
        dispatch({ type: "SEARCH_RESULTS", results: [] });
      }
    }, 400);
  }

  async function selectItem(item: TmdbSearchResult) {
    dispatch({ type: "SELECT_ITEM", item });
    try {
      // O singură cerere. Înainte erau zece, în trei valuri secvențiale —
      // vezi comentariul din wizard-check.functions.ts pentru măsurători.
      const res = await checkFn({
        data: {
          tmdbId: item.id,
          mediaType: item.mediaType,
          title: item.title,
          fallbackOriginalTitle: item.originalTitle,
        },
      });

      dispatch({
        type: "CHECK_LOADED",
        payload: {
          checkResult: {
            imdbId: res.details.imdbId,
            originalTitle: res.originalTitle,
            plexFound: res.plexFound,
            plexQuality: res.plexQuality,
            torrents: res.torrents,
            seasons: res.seasons,
          },
          tmdbDetails: res.details,
          seasonSchema: res.seasonSchema,
          tvmazeAirstamps: res.tvmazeAirstamps,
          // Map-ul nu supraviețuiește trecerii prin JSON, deci vine ca listă
          // de perechi și se reface aici.
          plexBySeason: new Map(res.plexBySeason),
          downloadingEntries: res.downloadingEntries,
          wantedEntry: res.wantedEntry,
        },
      });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      toast.error("Eroare la verificare", { description: error });
      dispatch({
        type: "CHECK_FAILED",
        error,
        fallback: {
          imdbId: null,
          originalTitle: item.originalTitle,
          plexFound: false,
          plexQuality: null,
          torrents: [],
          seasons: [],
        },
      });
    }
  }

  return { onQueryChange, selectItem };
}
