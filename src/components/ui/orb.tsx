import { ThinkingOrb, type OrbState } from "thinking-orbs";

// Wrapper peste ThinkingOrb, ca mărimea să fie decisă într-un singur loc.
//
// Pachetul are exact două preseturi de mărime, 20 și 64, iar ele nu sunt
// scalări ale aceluiași desen: fiecare vine cu propria densitate de puncte și
// propriul ritm. La noi orb-urile apar toate inline, lângă text, deci
// pornim mereu de la presetul 20 și ajustăm doar cutia CSS — altfel un 64
// micșorat ar arăta ca o pată, cu prea multe puncte pentru câțiva pixeli.
//
// Convenția de folosire: orb-ul marchează o așteptare fără capăt cunoscut
// (urmărire activă, procesare în Plex, descărcare fără procent). Pentru
// confirmarea unui clic, care ține o clipă, rămâne Loader2 — un orb acolo ar
// promite o muncă de fundal care nu există.
export function Orb({ state, px = 16, label }: { state: OrbState; px?: number; label?: string }) {
  return (
    <ThinkingOrb
      state={state}
      size={20}
      style={{ width: px, height: px, flexShrink: 0 }}
      aria-label={label}
    />
  );
}
