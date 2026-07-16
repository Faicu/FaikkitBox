import { useEffect, useRef } from "react";
import { toast } from "sonner";

export function useAutoReload() {
  const deployedShaRef = useRef<string | null>(null);
  const reloadingRef = useRef(false);

  useEffect(() => {
    let es: EventSource | null = null;

    function connect() {
      if (reloadingRef.current) return;
      es = new EventSource("/api/deploy-sha");

      es.onmessage = (ev) => {
        const sha = ev.data.trim();
        if (!sha) return;

        if (deployedShaRef.current === null) {
          deployedShaRef.current = sha;
          return;
        }

        if (deployedShaRef.current !== sha && !reloadingRef.current) {
          reloadingRef.current = true;
          toast.info("Versiune nouă — reîncărcare...", { duration: 2000 });
          setTimeout(() => window.location.reload(), 2000);
        }
      };

      es.onerror = () => {
        es?.close();
        // Reconectare după 2s — dacă serverul a restartat, SHA-ul va fi nou
        setTimeout(connect, 2000);
      };
    }

    connect();
    return () => { es?.close(); };
  }, []);
}
