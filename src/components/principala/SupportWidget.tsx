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

export function SupportWidget() {
  const copyIban = async () => {
    try {
      await navigator.clipboard.writeText(IBAN);
      toast.success("IBAN copiat");
    } catch {
      toast.error("Nu am putut copia IBAN-ul");
    }
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
