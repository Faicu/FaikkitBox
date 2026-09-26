import { ChevronRight } from "lucide-react";

import { relativeTime } from "./utils";
import type { PluginInfo } from "./plugins";

// Un rând de plugin: în lista din Tehnic și pe paginile de serviciu (Immich).
export function PluginRow({
  plugin,
  description,
  lastTs,
  onOpen,
}: {
  plugin: PluginInfo;
  description?: string;
  lastTs: string | null;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="press-tile flex w-full items-center gap-3 px-3 py-3 text-left transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-muted/40"
    >
      <div className="shrink-0">{plugin.icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium leading-tight">{plugin.label}</div>
        <div className="truncate text-[11px] text-muted-foreground">
          {description ?? plugin.description}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {/* live-dot pulsează; e nepot al lui stagger-in, nu copil direct,
            deci propriul lui `animation` nu intră în conflict cu animația de
            intrare a rândului. */}
        <span className="live-dot" />
        {lastTs && (
          <span className="whitespace-nowrap text-[10px] text-muted-foreground">
            {relativeTime(lastTs)}
          </span>
        )}
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
    </button>
  );
}
