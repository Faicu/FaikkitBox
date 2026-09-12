// Pasul de alegere manuală a torrentului — apare doar pentru admin, când
// există mai mulți candidați la aceeași calitate.

import type { Dispatch } from "react";
import { Download } from "lucide-react";

import { ActionButton, TorrentPicker } from "./WizardControls";
import { bestOf } from "./selection";
import type { TorrentChoiceContext } from "./types";
import type { WizardAction } from "./state";

export function PickStep({
  choice,
  pickedTorrentId,
  dispatch,
}: {
  choice: TorrentChoiceContext;
  pickedTorrentId: number | null;
  dispatch: Dispatch<WizardAction>;
}) {
  return (
    <div className="animate-in fade-in slide-in-from-right-2 duration-200 space-y-4">
      <div className="text-sm font-semibold">Alege torrentul — {choice.label}</div>
      <TorrentPicker
        matches={choice.candidates}
        selectedId={pickedTorrentId ?? choice.candidates[0].id}
        onSelect={(id) => dispatch({ type: "PICK_TORRENT", torrentId: id })}
      />
      <ActionButton
        busy={false}
        icon={<Download className="h-4 w-4" />}
        label="Continuă"
        onClick={() => {
          const chosen =
            choice.candidates.find((t) => t.id === pickedTorrentId) ?? bestOf(choice.candidates)!;
          // `back` reține alegerea: săgeata de înapoi din confirmare readuce
          // exact lista de candidați, nu un ecran de rezultat care ar pierde
          // selecția.
          dispatch({
            type: "OPEN_CONFIRM",
            target: {
              kind: "single",
              torrent: chosen,
              label: choice.label,
              season: choice.season,
              episode: choice.episode,
              isSeasonPack: choice.isSeasonPack,
            },
            back: { step: "pick", choice },
          });
        }}
      />
    </div>
  );
}
