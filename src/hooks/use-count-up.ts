import { useEffect, useRef, useState } from "react";

// Cifră care „urcă” până la valoare: de la 0 la prima afișare, apoi de la
// valoarea curentă la cea nouă. Pornește de la 0 și pe server, ca hidratarea
// să vadă același text; animația începe abia în efect, pe client.
//
// La mișcare redusă (setarea sistemului) sare direct la valoare.
export function useCountUp(target: number, durationMs = 900): number {
  const [value, setValue] = useState(0);
  const current = useRef(0);

  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const from = current.current;
    if (reduced || from === target) {
      current.current = target;
      setValue(target);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs);
      // ease-out cubic: pornește repede, se așază lin pe valoare
      const next = Math.round(from + (target - from) * (1 - (1 - p) ** 3));
      current.current = next;
      setValue(next);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  return value;
}
