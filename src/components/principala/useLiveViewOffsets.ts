// ---------------------------------------------------------------------------
// Interpolează local poziția de redare a sesiunilor Plex, ca ceasul h:m:s să
// avanseze în fiecare secundă.
//
// Plex nu raportează progresul continuu: clienții trimit actualizări la
// intervale proprii (tipic ~10s), deci `viewOffset` din /status/sessions se
// schimbă în trepte, oricât de des am întreba noi. Rezultatul era un ceas care
// "sărea" din 10 în 10 secunde.
//
// Fiindcă e doar un timp care curge, nu trebuie cerut de la server: reținem
// valoarea primită și momentul primirii, apoi adăugăm timpul scurs local. La
// fiecare valoare nouă de la server ne resincronizăm — deci nu putem devia.
// Zero cereri în plus.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";

interface LiveSession {
  playerState: string;
  viewOffsetMs: number;
  durationMs: number;
}

export function useLiveViewOffsets<T extends LiveSession>(sessions: T[] | undefined): number[] {
  // Ancora: ultima valoare venită de la server + momentul (local) al sosirii.
  const anchors = useRef<Map<number, { offset: number; at: number }>>(new Map());
  const [, tick] = useState(0);

  const list = sessions ?? [];
  // Cheia unei sesiuni în hartă e indexul ei — suficient, fiindcă lista se
  // reconstruiește la fiecare răspuns și e afișată în aceeași ordine.
  for (let i = 0; i < list.length; i++) {
    const prev = anchors.current.get(i);
    if (!prev || prev.offset !== list[i].viewOffsetMs) {
      anchors.current.set(i, { offset: list[i].viewOffsetMs, at: Date.now() });
    }
  }
  for (const key of anchors.current.keys()) {
    if (key >= list.length) anchors.current.delete(key);
  }

  // Un singur timer pentru toate sesiunile, activ doar cât ceva chiar rulează.
  const anyPlaying = list.some((s) => s.playerState === "playing");
  useEffect(() => {
    if (!anyPlaying) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [anyPlaying]);

  return list.map((s, i) => {
    const a = anchors.current.get(i);
    if (!a) return s.viewOffsetMs;
    // Pe pauză poziția nu avansează; la redare adăugăm timpul scurs de la
    // ultima valoare de la server, plafonat la durata totală.
    if (s.playerState !== "playing") return a.offset;
    const projected = a.offset + (Date.now() - a.at);
    return s.durationMs > 0 ? Math.min(projected, s.durationMs) : projected;
  });
}
