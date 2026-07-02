import { RefreshCw } from "lucide-react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";

interface Props {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}

export function AppHeader({ title, subtitle, right }: Props) {
  const qc = useQueryClient();
  const isFetching = useIsFetching() > 0;
  return (
    <header
      className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold leading-tight">{title}</h1>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {right}
          <button
            onClick={() => qc.invalidateQueries()}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
            aria-label="Reîmprospătează"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>
    </header>
  );
}