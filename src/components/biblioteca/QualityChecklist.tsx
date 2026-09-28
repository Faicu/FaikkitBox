import { Check, ChevronDown } from "lucide-react";

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

  function toggle(q: string) {
    let next: string[];
    if (checked.includes(q)) {
      // Măcar una rămâne bifată — fără calitate, urmărirea n-ar avea ce căuta.
      if (checked.length === 1) return;
      next = checked.filter((c) => c !== q);
    } else {
      if (full) return;
      next = [...checked, q];
    }
    next.sort((a, b) => WATCH_QUALITIES.indexOf(a) - WATCH_QUALITIES.indexOf(b));
    onChange(next[0], next[1] ?? null);
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
