import { useEffect, useReducer, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ArrowLeft, Check } from "lucide-react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { adminStatusQuery } from "@/lib/queries";
import type { TmdbSearchResult } from "@/lib/tmdb/tmdb.functions";
import { SearchStep } from "./wizard/SearchStep";
import { ResultStep } from "./wizard/ResultStep";
import { PickStep } from "./wizard/PickStep";
import { ConfirmBulkStep } from "./wizard/ConfirmBulkStep";
import { ConfirmStep } from "./wizard/ConfirmStep";
import { DoneStep } from "./wizard/DoneStep";
import type { Step, TorrentChoiceContext } from "./wizard/types";
import { useWizardData } from "./wizard/use-wizard-data";
import { useWizardDownload } from "./wizard/use-wizard-download";
import { wizardReducer, initialWizardState } from "./wizard/state";

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
  const { data: adminData } = useQuery(adminStatusQuery);
  const isAdmin = !!adminData?.isAdmin;

  const [state, dispatch] = useReducer(wizardReducer, initialWizardState);

  // Doar ce folosește chiar shell-ul: restul stării ajunge la pași prin
  // `state`, pe care fiecare îl citește cât îi trebuie.
  const {
    flow,
    query,
    results,
    searching,
    selected,
    checkResult,
    quality,
    pickedTorrentId,
    busy,
    bulkProgress,
  } = state;

  const step = flow.step;
  // Lista de candidați e vie și în timpul confirmării, dacă de acolo s-a
  // ajuns — de-asta o citim și din `back`, nu doar din pasul "pick".
  const torrentChoice: TorrentChoiceContext | null =
    flow.step === "pick"
      ? flow.choice
      : flow.step === "confirm" && flow.back.step === "pick"
        ? flow.back.choice
        : null;
  const confirmTorrent =
    flow.step === "confirm" && flow.target.kind === "single" ? flow.target : null;
  const confirmBulk =
    flow.step === "confirm" && flow.target.kind === "bulk" ? flow.target.items : null;
  const doneMessage = flow.step === "done" ? flow.message : null;

  const cancelBulkRef = useRef(false);

  const isTv = selected?.mediaType === "tv";

  // Hook-urile stau înaintea efectelor care le folosesc: `selectItem` e
  // chemat din efectul de deschidere prefill, iar o declarație de după s-ar
  // fi bazat pe faptul că efectul rulează oricum mai târziu — adevărat, dar
  // fragil de citit.
  const { onQueryChange, selectItem } = useWizardData(dispatch);
  const { downloadOne, downloadBulk, toggleMovieWatch } = useWizardDownload({
    state,
    dispatch,
    isTv,
    cancelBulkRef,
  });

  function reset() {
    dispatch({ type: "RESET" });
    cancelBulkRef.current = false;
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

  // Utilizatorii obișnuiți descarcă mereu la 1080p — dacă cineva ajunge cu
  // altă calitate selectată (ex. sesiune de admin expirată între timp),
  // cădem înapoi automat.
  useEffect(() => {
    if (!isAdmin) dispatch({ type: "SET_QUALITY", quality: "1080p" });
  }, [isAdmin]);

  // Navigare "înapoi" reală — revine la căutare, păstrând rezultatele deja
  // încărcate acolo unde are sens. Destinația nu mai e ghicită aici: reducer-ul
  // o citește din `flow.back` pentru confirmare (deci întoarcerea regăsește
  // exact lista de candidați din care venise) și o știe din pas pentru rest.
  function goBack() {
    // Singura decizie care depinde de props, nu de stare: când wizard-ul e
    // deschis prefill (din Descoperă), nu există pas de căutare la care să te
    // întorci, deci "înapoi" din rezultat închide.
    if (step === "result" && initialItem) {
      handleClose();
      return;
    }
    dispatch({ type: "BACK" });
  }

  // Pașii afișați în indicatorul de progres — sărim peste "Căutare" când
  // wizard-ul a fost deschis prefill, la fel cum sărim peste "Alege torrent"
  // când nu există de fapt o alegere de făcut (utilizator obișnuit, sau
  // admin cu un singur candidat) — apare doar când chiar se ajunge acolo.
  const stepperSteps: Array<{ key: Step; label: string }> = [
    ...(initialItem ? [] : [{ key: "search" as Step, label: "Căutare" }]),
    { key: "checking", label: "Verificare" },
    { key: "result", label: "Rezultat" },
    ...(torrentChoice || step === "pick" ? [{ key: "pick" as Step, label: "Alege torrent" }] : []),
    { key: "confirm", label: "Confirmare" },
  ];
  const effectiveStep = step === "search" && initialItem ? "checking" : step;
  const stepperIndex = stepperSteps.findIndex((s) => s.key === effectiveStep);

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && !busy && handleClose()}>
        <DialogContent className="top-8 flex max-h-[calc(100dvh-4rem)] w-[calc(100%-2rem)] max-w-md translate-y-0 flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:w-full">
          <DialogHeader className="shrink-0 space-y-0 p-4 pb-0 text-left">
            <div className="flex items-center gap-2">
              {(step === "result" || step === "pick" || step === "confirm") && (
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
            {effectiveStep !== "search" && step !== "done" && stepperSteps.length > 1 && (
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
                <div className="relative h-28 skeleton-sweep overflow-hidden rounded-2xl" />
                <div className="space-y-2">
                  <div className="h-4 w-2/3 skeleton-sweep rounded" />
                  <div className="h-3 w-1/3 skeleton-sweep rounded" />
                </div>
                <div className="flex items-center justify-center gap-2 pt-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Verific Plex și Filelist pentru „{selected?.title ?? initialItem?.title}”…
                </div>
              </div>
            )}

            {step === "result" && selected && checkResult && (
              <ResultStep
                state={state}
                dispatch={dispatch}
                isAdmin={isAdmin}
                isTv={isTv}
                selected={selected}
                checkResult={checkResult}
                onRetry={() => selectItem(selected)}
                onToggleWatch={toggleMovieWatch}
              />
            )}

            {step === "pick" && torrentChoice && (
              <PickStep
                choice={torrentChoice}
                pickedTorrentId={pickedTorrentId}
                dispatch={dispatch}
              />
            )}

            {step === "confirm" && confirmBulk && (
              <ConfirmBulkStep
                items={confirmBulk}
                quality={quality}
                bulkProgress={bulkProgress}
                cancelBulkRef={cancelBulkRef}
                onCancel={() => dispatch({ type: "BACK" })}
                onConfirm={() => downloadBulk(confirmBulk)}
              />
            )}

            {step === "confirm" && !confirmBulk && confirmTorrent && (
              <ConfirmStep
                torrent={confirmTorrent.torrent}
                label={confirmTorrent.label}
                onCancel={goBack}
                onConfirm={() =>
                  // Fără curățare aici: `downloadOne` schimbă pasul pe "done"
                  // DOAR la succes, iar dacă goleam ținta înainte de a ști
                  // rezultatul, o descărcare eșuată lăsa pasul "confirm" fără
                  // țintă — un corp de dialog gol. Acum ținta E pasul, deci
                  // starea aia nici nu e reprezentabilă.
                  downloadOne(confirmTorrent.torrent, {
                    season: confirmTorrent.season ?? null,
                    episode: confirmTorrent.episode ?? null,
                    isSeasonPack: confirmTorrent.isSeasonPack ?? false,
                  })
                }
              />
            )}

            {step === "done" && <DoneStep doneMessage={doneMessage} onClose={handleClose} />}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
