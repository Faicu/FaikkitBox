interface Props {
  value: number; // 0-100
  label: string;
  centerText: string;
  sub?: string;
  colorClass?: string; // stroke color class
  size?: number;
}

export function RadialGauge({ value, label, centerText, sub, colorClass = "text-primary", size = 96 }: Props) {
  const pct = Math.min(100, Math.max(0, value));
  const r = 42;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct / 100);
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle cx="50" cy="50" r={r} strokeWidth="8" className="fill-none stroke-muted" />
          <circle
            cx="50"
            cy="50"
            r={r}
            strokeWidth="8"
            strokeLinecap="round"
            className={`fill-none ${colorClass} transition-all`}
            stroke="currentColor"
            strokeDasharray={c}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-sm font-semibold tabular-nums">{centerText}</span>
          {sub && <span className="text-[9px] text-muted-foreground tabular-nums">{sub}</span>}
        </div>
      </div>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
    </div>
  );
}