// Dată+oră completă, format RO — folosit în orice drawer de detalii
// (descărcare, subtitrare, cont) care are nevoie de o dată exactă, nu
// relativă. `null` apare pentru câmpuri opționale (ex. "ultima autentificare"
// pentru un cont care nu s-a logat încă).
export function formatDateTime(iso: string | null): string {
  if (!iso) return "Niciodată";
  return new Date(iso).toLocaleString("ro-RO", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Bucharest",
  });
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "acum";
  const m = Math.floor(s / 60);
  if (m < 60) return `acum ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `acum ${h}h`;
  const d = Math.floor(h / 24);
  return `acum ${d}z`;
}
