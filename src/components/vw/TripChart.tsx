import type { VwTripPoint } from "@/lib/vw/vw-trips.functions";

// Viteza (albastru) și turația (portocaliu, pe scara din dreapta) în timp, SVG simplu.
export function TripChart({ points }: { points: VwTripPoint[] }) {
  if (points.length < 2) return null;
  const W = 600;
  const H = 160;
  const t0 = new Date(points[0].t).getTime();
  const t1 = new Date(points[points.length - 1].t).getTime();
  const span = Math.max(1, t1 - t0);
  const maxSpeed = Math.max(30, ...points.map((p) => p.speed ?? 0));
  const maxRpm = Math.max(1000, ...points.map((p) => p.rpm ?? 0));
  const x = (t: string) => ((new Date(t).getTime() - t0) / span) * W;
  const path = (val: (p: VwTripPoint) => number | null, max: number) =>
    points
      .filter((p) => val(p) !== null)
      .map(
        (p, i) =>
          `${i ? "L" : "M"}${x(p.t).toFixed(1)},${(H - ((val(p) ?? 0) / max) * H).toFixed(1)}`,
      )
      .join(" ");

  return (
    <div className="rounded-2xl glass-card p-3">
      <div className="mb-1 flex justify-between text-xs text-muted-foreground">
        <span className="text-sky-400">viteză (max {Math.round(maxSpeed)} km/h)</span>
        <span className="text-orange-400">turație (max {maxRpm} rpm)</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-40 w-full" preserveAspectRatio="none">
        <path
          d={path((p) => p.rpm, maxRpm)}
          fill="none"
          stroke="#fb923c"
          strokeWidth="1.5"
          opacity="0.7"
        />
        <path d={path((p) => p.speed, maxSpeed)} fill="none" stroke="#38bdf8" strokeWidth="2" />
      </svg>
    </div>
  );
}
