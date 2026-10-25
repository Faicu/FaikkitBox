import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { HdrQuestion } from "@/components/principala/wizard/WizardControls";
import { sdrVariantOf } from "@/components/principala/wizard/selection";
import type { Quality } from "@/components/principala/wizard/types";
import { WATCH_QUALITIES } from "./utils";

// Butonul de calitate din cardul de urmărire (serial și film așteptat):
// principala, plus rezerva dacă e bifată. Deschide/închide lista de mai jos.
export function QualityButton({
  primary,
  fallback,
  open,
  disabled,
  onToggle,
}: {
  primary: string;
  fallback: string | null;
  open: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className="flex shrink-0 items-center gap-1 rounded-lg border border-border bg-muted/40 px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-muted/60 disabled:opacity-40"
    >
      {primary}
      {fallback && <span className="text-muted-foreground">+ {fallback}</span>}
      <ChevronDown
        className={`h-3 w-3 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
      />
    </button>
  );
}

// Calitatea urmăririi, ca listă de bifat: cel mult două. Cea mai bună dintre
// cele bifate e principala, cealaltă e rezerva — aceeași regulă ca înainte
// (fallback-quality.ts): rezerva se ia doar dacă principala lipsește la două
// verificări, la minimum 3 ore distanță.
//
// Bifarea unei calități HDR trece întâi prin aceeași întrebare ca în wizard
// („Vei putea viziona în HDR?") — altfel urmărirea ar fi drumul pe care un
// fișier HDR ajunge în bibliotecă fără ca cineva să fi fost întrebat. „Nu"
// bifează varianta fără HDR a aceleiași rezoluții. Întrebarea e inline, nu
// overlay: lista stă într-un Drawer vaul (vezi commit c76ce30).
export function QualityChecklist({
  primary,
  fallback,
  disabled,
  onChange,
}: {
  primary: string;
  fallback: string | null;
  disabled: boolean;
  onChange: (primary: string, fallback: string | null) => void;
}) {
  const checked = [primary, fallback].filter((q): q is string => !!q);
  const full = checked.length >= 2;
  // Calitatea HDR bifată, în așteptarea răspunsului la întrebare.
  const [askHdr, setAskHdr] = useState<Quality | null>(null);

  function apply(next: string[]) {
    const unique = [...new Set(next)];
    unique.sort((a, b) => WATCH_QUALITIES.indexOf(a) - WATCH_QUALITIES.indexOf(b));
    onChange(unique[0], unique[1] ?? null);
  }

  function toggle(q: string) {
    if (checked.includes(q)) {
      // Măcar una rămâne bifată — fără calitate, urmărirea n-ar avea ce căuta.
      if (checked.length === 1) return;
      apply(checked.filter((c) => c !== q));
      return;
    }
    if (full) return;
    if (sdrVariantOf(q as Quality)) {
      setAskHdr(q as Quality);
      return;
    }
    apply([...checked, q]);
  }

  const askSdr = askHdr && sdrVariantOf(askHdr);
  if (askHdr && askSdr) {
    return (
      <HdrQuestion
        quality={askHdr}
        sdrQuality={askSdr}
        yesLabel={`Da, bifează ${askHdr}`}
        busy={disabled}
        onYes={() => {
          setAskHdr(null);
          apply([...checked, askHdr]);
        }}
        onNo={() => {
          setAskHdr(null);
          // Varianta fără HDR poate fi deja bifată — atunci nu se schimbă nimic.
          if (!checked.includes(askSdr)) apply([...checked, askSdr]);
        }}
      />
    );
  }

  return (
    <div className="rounded-lg bg-muted/40 p-1.5">
      <div className="grid grid-cols-3 gap-1">
        {WATCH_QUALITIES.map((q) => {
          const on = checked.includes(q);
          const role = on && full ? (q === primary ? "principală" : "rezervă") : null;
          return (
            <button
              key={q}
              type="button"
              onClick={() => toggle(q)}
              disabled={disabled || (!on && full)}
              className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] transition-colors disabled:opacity-40 ${
                on ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-muted/60"
              }`}
            >
              <span
                className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                  on ? "border-primary bg-primary text-primary-foreground" : "border-border"
                }`}
              >
                {on && <Check className="h-2.5 w-2.5" />}
              </span>
              <span className="min-w-0">
                <span className="block font-medium">{q}</span>
                {role && <span className="block text-[9px] text-muted-foreground">{role}</span>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 px-0.5 text-[10px] text-muted-foreground">
        Cel mult două. A doua bifată e rezervă: se ia doar dacă prima lipsește la două verificări,
        la minimum 3 ore distanță.
      </div>
    </div>
  );
}
