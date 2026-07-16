import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getDeployedSha } from "@/lib/github.functions";

export function useAutoReload() {
  const deployedShaRef = useRef<string | null>(null);
  const getsha = useServerFn(getDeployedSha);

  useEffect(() => {
    let active = true;

    async function check() {
      try {
        const { sha } = await getsha();
        if (!sha || !active) return;

        if (deployedShaRef.current === null) {
          deployedShaRef.current = sha;
          return;
        }

        if (deployedShaRef.current !== sha) {
          toast.info("Versiune nouă disponibilă — reîncărcare...", { duration: 3000 });
          setTimeout(() => window.location.reload(), 3000);
          active = false;
        }
      } catch {
        // rețea indisponibilă temporar
      }
    }

    check();
    const id = setInterval(() => { if (active) check(); }, 30_000);
    return () => { active = false; clearInterval(id); };
  }, []);
}
