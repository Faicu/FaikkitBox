import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

type Status = "idle" | "running" | "done" | "error";

export function DeployProgressPanel() {
  const [status, setStatus] = useState<Status>("idle");
  const [step, setStep] = useState("");
  const [lines, setLines] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource("/api/deploy-stream");

    es.addEventListener("detected", (ev) => {
      setStatus("running");
      setLines([JSON.parse(ev.data)]);
      setStep("Se conectează...");
    });

    es.addEventListener("step", (ev) => {
      const s = JSON.parse(ev.data) as string;
      setStep(s);
      setLines((prev) => [...prev, `\n${s}`]);
    });

    es.addEventListener("log", (ev) => {
      setLines((prev) => [...prev, JSON.parse(ev.data) as string]);
    });

    es.addEventListener("done", (ev) => {
      setStatus("done");
      setStep(JSON.parse(ev.data));
      setLines((prev) => [...prev, "\n✓ " + JSON.parse(ev.data)]);
    });

    es.addEventListener("error", (ev) => {
      setStatus("error");
      setLines((prev) => [...prev, "\n❌ " + JSON.parse(ev.data)]);
    });

    return () => es.close();
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lines]);

  if (status === "idle") return null;

  return (
    <div className="fixed bottom-20 left-2 right-2 z-50 mx-auto max-w-2xl rounded-2xl border border-amber-500/40 bg-background/97 shadow-2xl backdrop-blur">
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        {status === "running" && <Loader2 className="h-4 w-4 animate-spin text-amber-400" />}
        {status === "done" && <span className="text-emerald-400">✓</span>}
        {status === "error" && <span className="text-red-400">✗</span>}
        <span className={`text-sm font-semibold ${
          status === "error" ? "text-red-400" : status === "done" ? "text-emerald-400" : "text-amber-400"
        }`}>
          {status === "running" ? step || "Deploy automat în curs..." : step}
        </span>
      </div>
      <div ref={scrollRef} className="max-h-52 overflow-y-auto p-3">
        {lines.map((line, i) => (
          <div
            key={i}
            className={`font-mono text-[11px] leading-relaxed ${
              line.startsWith("\n") ? "mt-2 text-sky-400 font-semibold" : "text-muted-foreground"
            }`}
          >
            {line.trim()}
          </div>
        ))}
      </div>
    </div>
  );
}
