## Scop

Pe pagina `/plex`, în lista "Top spectatori", fiecare rând devine apăsabil și deschide un drawer cu istoricul de vizionare al utilizatorului selectat (ultimele vizionări: titlu, tip, când, player dacă e disponibil).

## Design UX

- Rândurile din "Top spectatori" primesc `role="button"`, hover state și un indicator (chevron dreapta).
- La tap se deschide un `Drawer` (shadcn/vaul) mobile-first, cu:
  - Header: numele utilizatorului + total vizionări.
  - Listă scrollabilă cu ultimele ~50 intrări: titlu (episod: `Serial — SxxEyy · Titlu episod`; film: titlul), badge `episode`/`movie`, data+ora, player dacă există.
  - Stare goală: "Nu există istoric".
- Se afișează doar pentru intrările cu user identificabil (deja garantat de fix-ul anterior).

## Date

Extind server function-ul Plex să returneze și istoricul brut pe utilizator, ca să nu mai fac fetch la tap (istoricul e deja adus în `fetchPlexHistory`).

- În `fetchPlexHistory` construiesc `userHistory: Map<user, Array<{title, show?, season?, episode?, type, viewedAt, player?}>>` (max 50/user, sortat desc după `viewedAt`).
- Adaug câmp `userHistory: Record<string, Array<HistoryEntry>>` la `PlexData` și la cache.
- Numele cheii = același `user` folosit pentru `topWatchers` (nume real din `/accounts`).

## Fișiere modificate

- `src/lib/services.functions.ts`
  - Nou tip `PlexHistoryEntry`.
  - `PlexData` primește `userHistory?: Record<string, PlexHistoryEntry[]>`.
  - `fetchPlexHistory` populează și returnează `userHistory`; cache-ul de 60s îl include.
  - `getPlex` propagă `userHistory` în răspuns.
- `src/routes/plex.tsx`
  - `RankedList` pentru "Top spectatori" primește un `onSelect(user)`.
  - Nou component local `WatcherHistoryDrawer` (folosind `@/components/ui/drawer`) care primește `user` + `entries` și randează lista.
  - State local `selectedUser: string | null` pe pagină.

Fără modificări de schemă, fără API-uri noi, fără business logic în afara Plex.
