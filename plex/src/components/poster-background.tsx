import { useEffect, useState } from "react";
import { getPublicPosterPaths } from "@/lib/media.functions";

// Fundal animat cu postere reale din librăria Plex, pentru paginile publice
// (/, /login, /register) — cerință explicită: pagina de start trebuie să
// arate conținutul din bibliotecă înainte de login, actualizat constant.
export function PosterBackground() {
  const [paths, setPaths] = useState<string[]>([]);

  useEffect(() => {
    getPublicPosterPaths().then((p) => setPaths(p as string[]));
  }, []);

  if (paths.length === 0) return null;

  // repetăm lista ca să umplem grid-ul indiferent de câte postere avem
  const tiles = Array.from({ length: 48 }, (_, i) => paths[i % paths.length]);

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-neutral-950">
      <div className="poster-bg-grid grid grid-cols-4 gap-1 opacity-25 sm:grid-cols-6 md:grid-cols-8">
        {tiles.map((path, i) => (
          <img
            key={`${path}-${i}`}
            src={`/api/plex-thumb?path=${encodeURIComponent(path)}`}
            alt=""
            loading="lazy"
            className="aspect-[2/3] w-full object-cover"
            style={{ animationDelay: `${(i % 12) * 0.4}s` }}
          />
        ))}
      </div>
      <div className="absolute inset-0 bg-gradient-to-b from-neutral-950/70 via-neutral-950/85 to-neutral-950" />
    </div>
  );
}
