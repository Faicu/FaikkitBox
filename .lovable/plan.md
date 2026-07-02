## Traducere completă în română

Înlocuiesc toate textele UI (etichete, titluri, subtitluri, mesaje, tooltip-uri, toast-uri) cu versiunea în română, direct în componente și rute. Fără librărie i18n, fără comutator.

### Fișiere modificate

- `src/routes/__root.tsx` — `<html lang="ro">`, meta title/description în română.
- `src/routes/index.tsx` — pagina de start (titlu, subtitluri, carduri servicii).
- `src/routes/plex.tsx` — „Sesiuni active”, „Biblioteci”, „Adăugate recent”, „Top seriale/filme/spectatori” etc.
- `src/routes/immich.tsx` — „Fotografii”, „Videoclipuri”, „Utilizare”, „Încărcări azi / săptămâna asta”, „Top uploaderi”, „Cozi de joburi”.
- `src/routes/qbit.tsx` — „Descărcare/Încărcare”, „Rație”, „Spațiu liber”, „Categorii”, „Cel mai mare download”, „Torrente”, „Reia toate / Oprește toate”, badge-uri stare (În descărcare, Seed, Oprit, Blocat, Eroare), toast-uri.
- `src/routes/host.tsx` — „Timp funcționare”, „Procesor”, „Memorie”, „Discuri”, „Rețea”, „Senzori”, „Aplicații”, „Top procese”, „Top I/O disc”.
- `src/components/AppHeader.tsx`, `BottomNav.tsx`, `ServicePill.tsx`, `ErrorCard.tsx`, `PageShell.tsx`, `StatCard.tsx`, `Meter.tsx` — etichete de navigare („Acasă”, „Gazdă”), stări („OK”, „Se încarcă…”, „Eroare”), mesajele de eroare generice.

### Ce NU se traduce

- Denumirile serviciilor (Plex, Immich, qBittorrent), numele proprii, nume de torrente/filme/utilizatori (vin din API), unități tehnice (MB/s, GB, %, H:M:S).
- Cheile de query, variabile de mediu, nume de fișiere.

### Verificare

- `tsgo --noEmit` după modificări.
- Vizual pe fiecare rută (/, /plex, /immich, /qbit, /host) că nu a rămas text în engleză.
