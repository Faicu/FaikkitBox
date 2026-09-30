import { MapPin } from "lucide-react";

import { TripMap } from "./TripMap";
import type { VwPosition } from "@/lib/vw/vw-car.functions";
import { relativeTime } from "@/components/tehnic/utils";

// „Unde e mașina”: ultima poziție GPS primită de la VW Welcome.
export function CarPosition({ position }: { position: VwPosition | null }) {
  if (!position) return null;
  const moving =
    (position.speed ?? 0) >= 3 && Date.now() - new Date(position.t).getTime() < 120_000;
  const time = new Date(position.t).toLocaleString("ro-RO", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between rounded-2xl glass-card p-4">
        <div className="flex items-center gap-2.5">
          <MapPin className="h-5 w-5 text-sky-400" />
          <div>
            <p className="font-semibold">{moving ? "Mașina e în mers" : "Mașina e parcată aici"}</p>
            <p className="text-xs text-muted-foreground">
              ultima poziție: {time} ({relativeTime(position.t)})
            </p>
          </div>
        </div>
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${position.lat},${position.lon}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg px-3 py-1.5 text-sm text-sky-400 hover:bg-sky-500/10"
        >
          Google Maps
        </a>
      </div>
      <TripMap
        points={[{ t: position.t, lat: position.lat, lon: position.lon, speed: null, rpm: null }]}
      />
    </div>
  );
}
