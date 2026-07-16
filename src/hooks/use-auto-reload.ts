import { useEffect, useRef } from "react";
import { emitUpdateDetected } from "@/lib/update-signal";

export function useAutoReload() {
  const deployedShaRef = useRef<string | null>(null);
  const firedRef = useRef(false);

  useEffect(() => {
    let es: EventSource | null = null;

    function connect() {
      if (firedRef.current) return;
      es = new EventSource("/api/deploy-sha");

      es.onmessage = (ev) => {
        const sha = ev.data.trim();
        if (!sha || firedRef.current) return;

        if (deployedShaRef.current === null) {
          deployedShaRef.current = sha;
          return;
        }

        if (deployedShaRef.current !== sha) {
          firedRef.current = true;
          es?.close();
          emitUpdateDetected();
        }
      };

      es.onerror = () => {
        es?.close();
        setTimeout(connect, 2000);
      };
    }

    connect();
    return () => {
      es?.close();
    };
  }, []);
}
