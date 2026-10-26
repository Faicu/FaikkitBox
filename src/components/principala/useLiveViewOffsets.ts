// ---------------------------------------------------------------------------
// Poziția de redare Plex, interpolată local ca ceasul să avanseze la fiecare
// secundă: clienții Plex raportează în trepte (~10s). Reținem ultima valoare și
// momentul ei și adăugăm timpul scurs; fiecare valoare nouă resincronizează.
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
  // Cheia e indexul — lista se reconstruiește la fiecare răspuns, în aceeași ordine.
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
    // Pe pauză nu avansează; la redare, timpul scurs, plafonat la durată.
    if (s.playerState !== "playing") return a.offset;
    const projected = a.offset + (Date.now() - a.at);
    return s.durationMs > 0 ? Math.min(projected, s.durationMs) : projected;
  });
}
