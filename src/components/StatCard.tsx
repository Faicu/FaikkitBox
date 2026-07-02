import type { ReactNode } from "react";

interface Props {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  accent?: string;
}

export function StatCard({ label, value, sub, icon, accent }: Props) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="uppercase tracking-wide">{label}</span>
        {icon && <span className={accent}>{icon}</span>}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-foreground">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">{sub}</div>}
    </div>
  );
}