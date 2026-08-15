import { Link } from "@tanstack/react-router";
import { CheckCircle2, ListChecks } from "lucide-react";

export function DoneStep({
  doneMessage,
  onClose,
}: {
  doneMessage: string | null;
  onClose: () => void;
}) {
  return (
    <div className="animate-in fade-in zoom-in-95 duration-300 flex flex-col items-center gap-4 py-8 text-center">
      <CheckCircle2 className="h-10 w-10 text-emerald-400" />
      <p className="text-sm text-muted-foreground">{doneMessage}</p>
      <div className="flex w-full flex-col gap-2">
        <Link
          to="/biblioteca"
          onClick={onClose}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground"
        >
          <ListChecks className="h-4 w-4" /> Vezi în Bibliotecă
        </Link>
        <button
          type="button"
          onClick={onClose}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-muted/40 py-2.5 text-sm font-semibold text-foreground hover:bg-muted/60"
        >
          Închide
        </button>
      </div>
    </div>
  );
}
