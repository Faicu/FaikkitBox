import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { adminStatusQuery, errorLogQuery } from "@/lib/queries";
import { clearErrorLogs } from "@/lib/error-log";
import { relativeTime } from "../utils";

const SOURCE_LABEL: Record<string, string> = {
  "server-fn": "Server",
  ssr: "SSR",
  client: "Browser",
};

export function ErrorLogSection() {
  const admin = useQuery(adminStatusQuery);
  const isAdmin = !!admin.data?.isAdmin;
  const errorLog = useQuery({ ...errorLogQuery, enabled: isAdmin });
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const qc = useQueryClient();
  const clearErrorLogsFn = useServerFn(clearErrorLogs);
  const clearMutation = useMutation({
    mutationFn: () => clearErrorLogsFn(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["errorLog"] });
      toast.success("Jurnalul de erori a fost golit");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (!isAdmin) return null;

  const entries = errorLog.data ?? [];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block w-full rounded-2xl border border-border bg-card p-4 text-left active:scale-[0.99] transition-transform"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="text-red-400">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <span className="font-semibold">Erori aplicație</span>
          </div>
          <span className="text-xs text-muted-foreground">›</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {errorLog.isLoading
            ? "Se încarcă..."
            : entries.length === 0
              ? "Nicio eroare înregistrată."
              : `${entries.length} ${entries.length === 1 ? "eroare înregistrată" : "erori înregistrate"}`}
        </p>
      </button>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="text-left">
            <DrawerTitle>Erori aplicație</DrawerTitle>
            <DrawerDescription>
              Ultimele {entries.length} erori de rulare (server, SSR, browser).
            </DrawerDescription>
          </DrawerHeader>
          <div className="space-y-2 overflow-y-auto px-4 pb-16">
            {entries.length > 0 && (
              <button
                type="button"
                onClick={() => clearMutation.mutate()}
                disabled={clearMutation.isPending}
                className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/50 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {clearMutation.isPending ? "Se golește..." : "Golește jurnalul"}
              </button>
            )}
            {entries.length === 0 && (
              <div className="rounded-xl border border-border bg-card p-4 text-center text-xs text-muted-foreground">
                Nicio eroare înregistrată încă.
              </div>
            )}
            {entries.map((e) => (
              <div
                key={e.id}
                className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-full bg-red-500/15 px-2 py-0.5 font-medium text-red-400">
                    {SOURCE_LABEL[e.source] ?? e.source}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {relativeTime(e.timestamp)}
                  </span>
                </div>
                <div className="mt-1.5 break-words font-medium text-foreground">{e.message}</div>
                {e.stack && (
                  <button
                    type="button"
                    onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
                    className="mt-1.5 text-[11px] text-muted-foreground underline"
                  >
                    {expandedId === e.id ? "Ascunde stack trace" : "Arată stack trace"}
                  </button>
                )}
                {expandedId === e.id && e.stack && (
                  <pre className="mt-1.5 overflow-auto whitespace-pre-wrap break-all text-[10px] text-muted-foreground">
                    {e.stack}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
