import { useEffect, useRef, useState } from "react";

export function useServiceRecovery(status: "ok" | "error" | "loading" | undefined) {
  const [recovering, setRecovering] = useState(false);
  const statusRef = useRef(status);
  const sawUnavailableRef = useRef(false);
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    statusRef.current = status;
    if (!recovering) return;

    if (status === "error") sawUnavailableRef.current = true;
    if (status === "ok" && sawUnavailableRef.current) setRecovering(false);
  }, [recovering, status]);

  useEffect(() => () => {
    timersRef.current.forEach(window.clearTimeout);
  }, []);

  const startRecovery = () => {
    timersRef.current.forEach(window.clearTimeout);
    sawUnavailableRef.current = false;
    setRecovering(true);

    timersRef.current = [
      window.setTimeout(() => {
        if (statusRef.current === "ok" && !sawUnavailableRef.current) setRecovering(false);
      }, 5_000),
      window.setTimeout(() => setRecovering(false), 90_000),
    ];
  };

  return { recovering, startRecovery };
}
