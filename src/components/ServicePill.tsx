import type { ServiceStatus } from "@/lib/services.functions";
import { CircleCheck, CircleAlert, Loader2 } from "lucide-react";

interface Props {
  status: ServiceStatus | "loading";
  label?: string;
}

export function ServicePill({ status, label }: Props) {
  const map = {
    ok: { bg: "bg-emerald-500/15 text-emerald-500", Icon: CircleCheck, text: label ?? "Online" },
    error: { bg: "bg-red-500/15 text-red-500", Icon: CircleAlert, text: label ?? "Offline" },
    loading: { bg: "bg-muted text-muted-foreground", Icon: Loader2, text: label ?? "Se încarcă" },
  } as const;
  const cfg = map[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.bg}`}>
      <cfg.Icon className={`h-3.5 w-3.5 ${status === "loading" ? "animate-spin" : ""}`} />
      {cfg.text}
    </span>
  );
}