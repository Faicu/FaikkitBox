// ---------------------------------------------------------------------------
// Face un contor care crește cu timpul (uptime) să avanseze la secundă în UI,
// între două răspunsuri de la server.
//
// Aceeași idee ca la ceasul sesiunilor Plex (useLiveViewOffsets): o valoare
// care doar curge nu trebuie cerută de la server ca să fie corectă. Reținem
// ultima valoare primită plus momentul primirii, apoi adăugăm timpul scurs
// local; la fiecare valoare nouă ne resincronizăm, deci nu putem devia.
//
// Fără asta, "Timp funcționare" sărea cu 2-3 secunde odată — cel mai vizibil
// semn de "aplicație lentă" din pagina Sistem, deși nu avea nicio legătură cu
// viteza serverului.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";

export function useLiveCounter(serverValueSec: number | undefined): number {
  const anchor = useRef<{ value: number; at: number } | null>(null);
  const [, tick] = useState(0);

  if (serverValueSec !== undefined && anchor.current?.value !== serverValueSec) {
    anchor.current = { value: serverValueSec, at: Date.now() };
  }

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!anchor.current) return serverValueSec ?? 0;
  return anchor.current.value + Math.floor((Date.now() - anchor.current.at) / 1000);
}
