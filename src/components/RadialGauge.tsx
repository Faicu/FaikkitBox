import { useEffect, useId, useRef, useState } from "react";

interface Props {
  value: number; // 0-100
  label: string;
  centerText: string;
  sub?: string;
  colorClass?: string; // stroke color class
  size?: number;
}

export function RadialGauge({
  value,
  label,
  centerText,
  sub,
  colorClass = "text-primary",
  size = 96,
}: Props) {
  const pct = Math.min(100, Math.max(0, value));
  const r = 42;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct / 100);
  const gid = useId().replace(/[:]/g, "");
  const first = useRef(true);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 700);
    return () => clearTimeout(t);
  }, [centerText]);
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <defs>
            <linearGradient id={`grad-${gid}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.4" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="1" />
            </linearGradient>
            <filter id={`glow-${gid}`}>
              <feGaussianBlur stdDeviation="1.6" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <circle cx="50" cy="50" r={r} strokeWidth="8" className="fill-none stroke-muted/50" />
          <circle
            cx="50"
            cy="50"
            r={r}
            strokeWidth="8"
            strokeLinecap="round"
            className={`fill-none ${colorClass}`}
            stroke={`url(#grad-${gid})`}
            filter={`url(#glow-${gid})`}
            strokeDasharray={c}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 800ms cubic-bezier(0.22, 1, 0.36, 1)" }}
          />
        </svg>
        <div
          className="pointer-events-none absolute inset-0"
          style={{ animation: "scan 6s linear infinite" }}
        >
          <span
            className={`absolute left-1/2 top-1 h-1.5 w-1.5 -translate-x-1/2 rounded-full ${colorClass}`}
            style={{ background: "currentColor", boxShadow: "0 0 8px currentColor" }}
          />
        </div>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-sm font-semibold tabular-nums ${flash ? "tick-flash" : ""}`}>
            {centerText}
          </span>
          {sub && <span className="text-[9px] text-muted-foreground tabular-nums">{sub}</span>}
        </div>
      </div>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
    </div>
  );
}
