interface Props {
  value: number;
  label?: string;
  right?: string;
  tone?: "default" | "warn" | "danger";
}

export function Meter({ value, label, right, tone }: Props) {
  const pct = Math.min(100, Math.max(0, value));
  const auto: "default" | "warn" | "danger" = pct >= 90 ? "danger" : pct >= 75 ? "warn" : "default";
  const t = tone ?? auto;
  const color = t === "danger" ? "bg-red-500" : t === "warn" ? "bg-amber-500" : "bg-primary";
  return (
    <div>
      {(label || right) && (
        <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
          {label && <span>{label}</span>}
          {right && <span className="tabular-nums">{right}</span>}
        </div>
      )}
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}