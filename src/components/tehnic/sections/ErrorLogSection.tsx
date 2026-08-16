import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { errorLogQuery } from "@/lib/queries";
import { clearErrorLogs } from "@/lib/errors/error-log";
import { relativeTime } from "../utils";

const SOURCE_LABEL: Record<string, string> = {
  "server-fn": "Server",
  ssr: "SSR",
  client: "Browser",
};

const SOURCE_FILTERS = [
  { key: "all", label: "Toate" },
  { key: "server-fn", label: "Server" },
  { key: "ssr", label: "SSR" },
  { key: "client", label: "Browser" },
];

const LAST_VIEWED_KEY = "errorLogLastViewedAt";

export function ErrorLogSection() {
  const errorLog = useQuery(errorLogQuery);
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [lastViewedAt, setLastViewedAt] = useState<string | null>(null);

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

  useEffect(() => {
    try {
      setLastViewedAt(localStorage.getItem(LAST_VIEWED_KEY));
    } catch {
      // localStorage indisponibil (private browsing etc.) — necitite dezactivate
    }
  }, []);

  const allEntries = errorLog.data ?? [];
  const unreadCount = lastViewedAt
    ? allEntries.filter((e) => e.lastSeen > lastViewedAt).length
    : allEntries.length;

  const entries = allEntries.filter((e) => {
    if (sourceFilter !== "all" && e.source !== sourceFilter) return false;
    if (search.trim() && !e.message.toLowerCase().includes(search.trim().toLowerCase())) {
      return false;
    }
    return true;
  });

  function handleOpen() {
    setOpen(true);
    const now = new Date().toISOString();
    try {
      localStorage.setItem(LAST_VIEWED_KEY, now);
    } catch {
      // ignoră — doar contorul de necitite nu se va actualiza
    }
    setLastViewedAt(now);
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="block w-full rounded-2xl border border-border bg-card p-4 text-left active:scale-[0.99] transition-transform"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="relative text-red-400">
              <AlertTriangle className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </span>
            <span className="font-semibold">Erori aplicație</span>
          </div>
          <span className="text-xs text-muted-foreground">›</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {errorLog.isLoading
            ? "Se încarcă..."
            : allEntries.length === 0
              ? "Nicio eroare înregistrată."
              : `${allEntries.length} ${allEntries.length === 1 ? "tip de eroare înregistrat" : "tipuri de erori înregistrate"}`}
        </p>
      </button>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="text-left">
            <DrawerTitle>Erori aplicație</DrawerTitle>
            <DrawerDescription>
              {allEntries.length} tip(uri) de erori distincte (server, SSR, browser) — grupate, cu
              contor de apariții.
            </DrawerDescription>
          </DrawerHeader>
          <div className="space-y-2 overflow-y-auto px-4 pb-16">
            <div className="sticky top-0 z-10 -mx-4 space-y-2 bg-background px-4 pb-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Caută în mesaje..."
                  className="w-full rounded-xl border border-border bg-muted/30 py-2 pl-8 pr-3 text-xs outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="flex gap-1.5 overflow-x-auto">
                {SOURCE_FILTERS.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setSourceFilter(f.key)}
                    className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      sourceFilter === f.key
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted/40 text-muted-foreground hover:bg-muted/60"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              {allEntries.length > 0 && (
                <button
                  type="button"
                  onClick={() => clearMutation.mutate()}
                  disabled={clearMutation.isPending}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/50 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {clearMutation.isPending ? "Se golește..." : "Golește jurnalul"}
                </button>
              )}
            </div>

            {entries.length === 0 && (
              <div className="rounded-xl border border-border bg-card p-4 text-center text-xs text-muted-foreground">
                {allEntries.length === 0
                  ? "Nicio eroare înregistrată încă."
                  : "Niciun rezultat pentru filtrele curente."}
              </div>
            )}
            {entries.map((e) => (
              <div
                key={e.id}
                className={`rounded-xl border p-3 text-xs ${
                  e.level === "warn"
                    ? "border-amber-500/20 bg-amber-500/5"
                    : "border-red-500/20 bg-red-500/5"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`rounded-full px-2 py-0.5 font-medium ${
                        e.level === "warn"
                          ? "bg-amber-500/15 text-amber-400"
                          : "bg-red-500/15 text-red-400"
                      }`}
                    >
                      {SOURCE_LABEL[e.source] ?? e.source}
                    </span>
                    {e.count > 1 && (
                      <span className="rounded-full bg-muted px-1.5 py-0.5 font-medium text-muted-foreground">
                        ×{e.count}
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 text-muted-foreground">{relativeTime(e.lastSeen)}</span>
                </div>
                <div className="mt-1.5 break-words font-medium text-foreground">{e.message}</div>
                {e.count > 1 && (
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    Prima apariție: {relativeTime(e.timestamp)}
                  </div>
                )}
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
