import { Heart, ExternalLink, Landmark, Copy } from "lucide-react";
import { toast } from "sonner";

// Datele de plată sunt fixe și publice — nu au ce căuta în DB sau în env.
const REVOLUT_URL = "https://revolut.me/faicu";
const REVOLUT_LABEL = "revolut.me/faicu";
const IBAN = "RO47RZBR0000060020633193";
const IBAN_HOLDER = "ANDREI PRODAN";
const IBAN_BANK = "Raiffeisen Bank";

// IBAN-ul se citește greu într-un șir continuu; îl grupăm câte 4 doar la
// afișare — în clipboard ajunge forma fără spații, cea acceptată de bănci.
const ibanGrouped = IBAN.replace(/(.{4})/g, "$1 ").trim();

// `navigator.clipboard` există doar în context securizat. Prin proxy (HTTPS) e
// acolo, dar cine deschide aplicația direct pe IP-ul din rețea, pe portul 3000,
// primește HTTP — și atunci API-ul lipsește cu totul. Fallback-ul vechi cu
// `execCommand` nu mai e recomandat, dar aici e singura variantă care
// funcționează, iar alternativa e un buton care nu face nimic.
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // cădem pe varianta de mai jos
  }
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

export function SupportWidget() {
  const copyIban = async () => {
    if (await copyToClipboard(IBAN)) toast.success("IBAN copiat");
    else toast.error("Nu am putut copia IBAN-ul");
  };

  return (
    <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-center gap-2">
        <Heart className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">Susține proiectul</h2>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Dacă te uiți des la filme și seriale pe Plex și vrei ca FaikkitBox să meargă mai departe,
        poți contribui cât consideri. Serverul, curentul și abonamentele se plătesc lunar.
        Contribuția e opțională.
      </p>

      <div className="mt-3 space-y-2">
        <a
          href={REVOLUT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2.5 rounded-xl glass-card glass-card-hover press-tile px-3 py-2.5"
        >
          <ExternalLink className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-foreground">Revolut</div>
            <div className="truncate text-[11px] text-muted-foreground">{REVOLUT_LABEL}</div>
          </div>
        </a>

        <button
          type="button"
          onClick={copyIban}
          className="flex w-full items-center gap-2.5 rounded-xl glass-card glass-card-hover press-tile px-3 py-2.5 text-left"
        >
          <Landmark className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-foreground">Transfer bancar (IBAN)</div>
            <div className="truncate font-mono text-[11px] text-foreground/80">{ibanGrouped}</div>
            <div className="truncate text-[11px] text-muted-foreground">
              {IBAN_HOLDER} · {IBAN_BANK}
            </div>
          </div>
          <Copy className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}
