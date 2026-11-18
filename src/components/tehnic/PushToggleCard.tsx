import { Bell, BellOff } from "lucide-react";

import type { usePushNotifications } from "@/hooks/use-push-notifications";

// Activarea notificărilor pe dispozitivul curent, deasupra listei abonamentelor.
export function PushToggleCard({ push }: { push: ReturnType<typeof usePushNotifications> }) {
  if (push.state === "unsupported") return null;

  const isSubscribed = push.state === "subscribed";
  const isDenied = push.state === "denied";
  const isLoading = push.state === "loading";

  return (
    <div>
      <div className="rounded-2xl glass-card p-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {isSubscribed
              ? "Notificări activate"
              : isDenied
                ? "Notificări blocate"
                : "Notificări dezactivate"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isSubscribed
              ? "Vei primi notificări pentru toate evenimentele din jurnal"
              : isDenied
                ? "Permite notificările din setările browserului, apoi reîncarcă pagina"
                : "Activează pentru a primi notificări despre Plex, Immich, server etc."}
          </p>
        </div>
        {!isDenied && (
          <button
            onClick={isSubscribed ? push.unsubscribe : push.subscribe}
            disabled={isLoading}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all active:scale-95 disabled:opacity-50 ${
              isSubscribed ? "bg-red-500/15 text-red-400" : "bg-emerald-500/15 text-emerald-400"
            }`}
          >
            {isSubscribed ? <BellOff className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
            {isLoading ? "Se procesează…" : isSubscribed ? "Dezactivează" : "Activează"}
          </button>
        )}
      </div>
      {push.error && <p className="mt-2 px-1 text-xs text-red-400">Eroare: {push.error}</p>}
    </div>
  );
}
