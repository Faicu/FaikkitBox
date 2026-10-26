import { useEffect, useReducer } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ArrowLeft, Check } from "lucide-react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { adminStatusQuery } from "@/lib/queries";
import type { TmdbSearchResult } from "@/lib/tmdb/tmdb.functions";
import { SearchStep } from "./wizard/SearchStep";
import { ResultStep } from "./wizard/ResultStep";
import { PickStep } from "./wizard/PickStep";
import { ConfirmStep } from "./wizard/ConfirmStep";
import { DoneStep } from "./wizard/DoneStep";
import type { Step } from "./wizard/types";
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
  // Sare peste căutare — wizard deschis dintr-un titlu identificat (Descoperă).
  initialItem?: TmdbSearchResult | null;
}) {
  const { data: adminData } = useQuery(adminStatusQuery);
  const isAdmin = !!adminData?.isAdmin;

  const [state, dispatch] = useReducer(wizardReducer, initialWizardState);

  // Doar ce folosește shell-ul; pașii citesc restul din `state`.
  const { flow, query, results, searching, selected, checkResult, busy } = state;

  const step = flow.step;
  // Alegerea rămâne în indicator și în confirmare, dacă de acolo s-a ajuns (`back`).
  const hasPickStep =
    flow.step === "pick" || (flow.step === "confirm" && flow.back.step === "pick");
  const confirmTorrent = flow.step === "confirm" ? flow.target : null;
  const doneMessage = flow.step === "done" ? flow.message : null;

  const isTv = selected?.mediaType === "tv";

  // Hook-urile înaintea efectelor care le folosesc (`selectItem`, în efectul
  // de deschidere prefill).
  const { onQueryChange, selectItem } = useWizardData(dispatch);
  const { downloadOne, toggleMovieWatch } = useWizardDownload({ state, dispatch, isTv });

  function handleClose() {
    dispatch({ type: "RESET" });
    onClose();
  }

  // Deschis dintr-un titlu identificat — direct la verificare.
  useEffect(() => {
    if (open && initialItem) {
      selectItem(initialItem);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialItem?.id, initialItem?.mediaType]);

  // „Înapoi” real: destinația o știe reducer-ul (`flow.back` la confirmare).
  function goBack() {
    // Deschis prefill, nu există pas de căutare — „înapoi” din rezultat închide.
    if (step === "result" && initialItem) {
      handleClose();
      return;
    }
    dispatch({ type: "BACK" });
  }

  // Pașii din indicator: fără „Căutare” la prefill, iar „Alege torrent” doar
  // când chiar se ajunge acolo.
  const stepperSteps: Array<{ key: Step; label: string }> = [
    ...(initialItem ? [] : [{ key: "search" as Step, label: "Căutare" }]),
    { key: "checking", label: "Verificare" },
    { key: "result", label: "Rezultat" },
    ...(hasPickStep ? [{ key: "pick" as Step, label: "Alege torrent" }] : []),
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

            {flow.step === "pick" && <PickStep flow={flow} dispatch={dispatch} />}

            {confirmTorrent && (
              <ConfirmStep
                torrent={confirmTorrent.torrent}
                label={confirmTorrent.label}
                isAdmin={isAdmin}
                title={selected?.title ?? ""}
                originalTitle={checkResult?.originalTitle || selected?.title || ""}
                year={selected?.year ?? null}
                season={confirmTorrent.season}
                episode={confirmTorrent.episode}
                isSeasonPack={confirmTorrent.isSeasonPack}
                busy={busy}
                onCancel={goBack}
                onDeclineHdr={(quality) => dispatch({ type: "DECLINE_HDR", quality })}
                onConfirm={() =>
                  // Fără curățare aici: pasul devine "done" doar la succes, iar o
                  // țintă golită înainte lăsa, la eșec, un dialog gol.
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
