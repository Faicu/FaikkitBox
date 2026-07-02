import { useEffect, useRef, useState, type ReactNode } from "react";

interface Props {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  accent?: string;
}

export function StatCard({ label, value, sub, icon, accent }: Props) {
  // Micro-flash whenever the displayed value changes
  const key = typeof value === "string" || typeof value === "number" ? String(value) : undefined;
  const first = useRef(true);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 700);
    return () => clearTimeout(t);
  }, [key]);
  return (
    <div className="glass-card glass-card-hover relative overflow-hidden rounded-2xl p-3">
      <div className="relative z-10 flex items-center justify-between text-xs text-muted-foreground">
        <span className="uppercase tracking-wide">{label}</span>
        {icon && <span className={accent}>{icon}</span>}
      </div>
      <div
        className={`relative z-10 mt-1 text-xl font-semibold tabular-nums text-foreground ${flash ? "tick-flash" : ""}`}
      >
        {value}
      </div>
      {sub && <div className="relative z-10 mt-0.5 text-xs text-muted-foreground tabular-nums">{sub}</div>}
    </div>
  );
}