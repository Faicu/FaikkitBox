// Grafic mic de tendință (ultimele 10 minute) — linie subțire cu o umbră
// discretă dedesubt. Fără axe: valoarea curentă stă oricum lângă, în cifre.

interface Series {
  values: Array<number | undefined>;
  // Clasă de culoare Tailwind (text-*), folosită prin currentColor.
  className: string;
}

interface Props {
  series: Series[];
  // Scară fixă (ex. 100 pentru procente); altfel maximul datelor, dar cel
  // puțin `minMax`, ca zgomotul de repaus să nu pară un munte.
  max?: number;
  minMax?: number;
  className?: string;
}

const W = 100;
const H = 30;

function path(values: Array<number | undefined>, max: number): string {
  const n = values.length;
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) {
      pen = false;
      return;
    }
    const x = n > 1 ? (i / (n - 1)) * W : W;
    const y = H - (Math.min(v, max) / max) * (H - 2) - 1;
    d += `${pen ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
    pen = true;
  });
  return d;
}

export function Sparkline({ series, max, minMax = 0, className }: Props) {
  const longest = Math.max(0, ...series.map((s) => s.values.length));
  if (longest < 2) return null;
  const dataMax = Math.max(
    minMax,
    ...series.flatMap((s) => s.values.filter((v): v is number => v != null && Number.isFinite(v))),
  );
  const scale = max ?? (dataMax > 0 ? dataMax : 1);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden
      className={`pointer-events-none block w-full ${className ?? ""}`}
    >
      {series.map((s, i) => {
        const line = path(s.values, scale);
        if (!line) return null;
        // Umbra doar sub segmentul continuu complet; la goluri, doar linia.
        const continuous = !s.values.some((v) => v == null);
        return (
          <g key={i} className={s.className}>
            {continuous && (
              <path d={`${line}L${W},${H}L0,${H}Z`} fill="currentColor" opacity={0.12} />
            )}
            <path
              d={line}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              opacity={0.9}
            />
          </g>
        );
      })}
    </svg>
  );
}
