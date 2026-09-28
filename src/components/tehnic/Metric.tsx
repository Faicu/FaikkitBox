import { useFlashOnChange } from "@/hooks/use-flash-on-change";

export function Metric({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  const flash = useFlashOnChange(value);
  return (
    <div className="min-w-0 rounded-xl border border-border bg-muted/40 px-2.5 py-2 text-center">
      {icon && <div className="flex justify-center mb-1 text-muted-foreground">{icon}</div>}
      <div className={`truncate text-sm font-semibold tabular-nums ${flash ? "tick-flash" : ""}`}>
        {value}
      </div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
