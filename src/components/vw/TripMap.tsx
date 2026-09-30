import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

import type { VwTripPoint } from "@/lib/vw/vw-trips.functions";

// Harta traseului (Leaflet + OpenStreetMap). Leaflet atinge `window` la import,
// deci îl încărcăm doar în browser, din efect.
export function TripMap({ points }: { points: VwTripPoint[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const coords = points
      .filter((p) => p.lat !== null && p.lon !== null)
      .map((p) => [p.lat, p.lon] as [number, number]);
    if (!ref.current || coords.length === 0) return;
    let map: import("leaflet").Map | null = null;
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !ref.current) return;
      map = L.map(ref.current, { zoomControl: true, attributionControl: true });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap",
      }).addTo(map);
      const line = L.polyline(coords, { color: "#38bdf8", weight: 5, opacity: 0.9 }).addTo(map);
      L.circleMarker(coords[0], {
        radius: 7,
        color: "#fff",
        weight: 2,
        fillColor: "#22c55e",
        fillOpacity: 1,
      }).addTo(map);
      L.circleMarker(coords[coords.length - 1], {
        radius: 7,
        color: "#fff",
        weight: 2,
        fillColor: "#ef4444",
        fillOpacity: 1,
      }).addTo(map);
      map.fitBounds(line.getBounds(), { padding: [24, 24], maxZoom: 16 });
    });
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [points]);

  const hasCoords = points.some((p) => p.lat !== null);
  return hasCoords ? (
    <div ref={ref} className="h-72 w-full overflow-hidden rounded-2xl" />
  ) : (
    <p className="rounded-2xl glass-card p-4 text-sm text-muted-foreground">
      Călătoria nu are poziții GPS.
    </p>
  );
}
