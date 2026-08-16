# Structura proiectului FaikkitBox

Document viu — se completează treptat. Scopul: pentru orice fișier din
`src/`/`server/`, să știi rapid ce conține și unde e folosit, fără să
trebuiască să-l deschizi sau să dai grep. Actualizează secțiunea
corespunzătoare când adaugi, muți sau ștergi un fișier.

Convenție per fișier: **Ce conține** (1-2 propoziții) — **Folosit de**
(cine îl importă; pentru rute, calea e evidentă și nu se repetă).

---

## Cuprins

- [server/ — plugin-uri și rute Nitro](#server--plugin-uri-și-rute-nitro)
- [src/routes/ — paginile aplicației](#src routes--paginile-aplicației)
- [src/lib/ — logică server + client, fără UI](#src-lib--logică-server--client-fără-ui)
  - [src/lib/filelist/](#srclibfilelist)
  - [src/lib/services/](#srclibservices)
- [src/components/ — UI](#src-components--ui)
  - [src/components/biblioteca/](#srccomponentsbiblioteca)
  - [src/components/principala/](#srccomponentsprincipala)
  - [src/components/filelist/](#srccomponentsfilelist)
  - [src/components/tehnic/](#srccomponentstehnic)
  - [src/components/descopera/](#srccomponentsdescopera)
  - [src/components/ui/](#srccomponentsui)
- [src/hooks/](#srchooks)
- [Rădăcină src/](#rădăcină-src)
- [Analiză cantitativă](#analiză-cantitativă)

---

## server/ — plugin-uri și rute Nitro

Plugin-urile din `server/plugins/*.ts` sunt încărcate automat de Nitro prin
convenție de folder (nu prin import explicit) — de-asta un grep normal nu le
arată ca "folosite". La fel, `server/routes/api/*.ts` sunt rute HTTP montate
automat pe calea din numele fișierului.

| Fișier | Ce conține |
|---|---|
| `plugins/fast-shutdown.ts` | Shutdown rapid și controlat la SIGTERM/SIGINT (fără el, Node așteaptă implicit să dreneze toate conexiunile). |
| `plugins/github-commit-tracker.ts` | La pornirea serverului: sincronizează ultimele commit-uri din GitHub în DB, trimite push pentru cele noi (acoperă cazul webhook picat în timpul unui restart). |
| `plugins/media-torrent-sync.ts` | Sincronizare periodică `media` ↔ qBittorrent ↔ subtitrări pentru toată biblioteca (backfill + `linkUnmatchedTorrents` + verificare subtitrări), fără acțiune din UI. |
| `plugins/plex-session-tracker.ts` | Urmărește sesiunile de vizionare Plex active (polling), loghează start/stop în `activity-log.ts`. |
| `routes/api/deploy-sha.ts` | Token de detectare restart (se schimbă la fiecare pornire a procesului) — clientul (`use-auto-reload.ts`) reîncarcă pagina când observă o valoare diferită. |
| `routes/api/github-webhook.ts` | Endpoint webhook GitHub — push instant la commit nou (completează polling-ul din `github-commit-tracker.ts`). |
| `routes/api/plex-thumb.ts` | Proxy pentru thumbnail-uri Plex (evită expunerea directă a tokenului Plex către client). |

---

## src/routes/ — paginile aplicației

Rutare pe fișiere (TanStack Router) — fiecare fișier = o pagină, la calea
din nume (`index.tsx` = `/`). `__root.tsx` e layout-ul comun.
`routeTree.gen.ts` e generat automat, nu se editează manual.

| Rută | Acces | Ce arată |
|---|---|---|
| `index.tsx` (`/`) | Public (parțial) | Status live Plex, wizard "Adaugă film/serial" (`AddMediaWizard`), căutare manuală Filelist (`FilelistSection`, admin). |
| `biblioteca.tsx` (`/biblioteca`) | Cont aprobat | `BibliotecaList` — tot ce e descărcat prin aplicație sau deja în Plex. |
| `descopera.tsx` (`/descopera`) | Cont aprobat | Explorare TMDB (grid + feed video), deschide wizard-ul pentru un titlu identificat. |
| `qbit.tsx` (`/qbit`) | Cont aprobat | Control qBittorrent — torrente active, viteze, acțiuni (pauză/reia/șterge). |
| `sistem.tsx` (`/sistem`) | Admin | Metrici OS (CPU/RAM/disc/rețea), speedtest, acțiuni serviciu. |
| `tehnic.tsx` (`/tehnic`) | Admin | Jurnal activitate, commit-uri GitHub, erori aplicație, status plugin-uri, push-to-GitHub. |
| `users.tsx` (`/users`) | Admin | Listă conturi, aprobare/respingere, `UserDetailDrawer` (detalii per cont). |
| `immich.tsx` (`/immich`) | Admin | Control serviciu Immich (foto). |
| `login.tsx` / `register.tsx` | Public | Autentificare / auto-înregistrare (aprobare manuală ulterioară). |
| `__root.tsx` | — | Layout comun: `AppHeader`, `BottomNav`, `PageShell`, providers (query client, auto-reload). |

---

## src/lib/ — logică server + client, fără UI

Majoritatea fișierelor `*.functions.ts` sunt server functions TanStack
(`createServerFn`) — granița client/server a aplicației.

| Fișier | Ce conține | Folosit de |
|---|---|---|
| `admin.server.ts` | `requireAuth`/`requireAdmin`/`isAdminOrOwner` — verificări de sesiune, server-only. | Aproape orice server function care are nevoie de autentificare. |
| `admin.functions.ts` | Server functions pentru gestionarea conturilor (aprobare, roluri). | `routes/users.tsx`. |
| `admin-route-guard.ts` | Guard TanStack Router — orice cont autentificat (nu doar admin), pentru rute ca Descoperă/Bibliotecă. | `beforeLoad` în rutele protejate. |
| `db.ts` | Schema SQLite completă (`CREATE TABLE IF NOT EXISTS`) + migrări incrementale versionate cu `PRAGMA user_version` (`runCleanups`). Singurul loc unde se definește schema. | Orice fișier care face `getDb()`. |
| `media.ts` | Sursă unică pentru tabela `media` (filme/seriale/episoade reale — descărcate sau backfill din Plex). `upsertMediaEntry`, `upsertMediaEntryFromPlex`, `ensureMediaPlaceholder` (rând-părinte serial). | `filelist/download.ts`, `media-backfill.ts`, `services/plex-browse.ts`. |
| `media-backfill.ts` | Completează `media` pentru tot ce era deja în Plex înainte de acest sistem — scanează toată biblioteca Plex, rezolvă TMDB best-effort, leagă torrente existente din qBittorrent. | `media-torrent-sync.ts` (plugin), `BibliotecaList.tsx` (buton admin). |
| `filelist.functions.ts` | Barrel — reexportă din `filelist/*` (vezi mai jos). | Componente client (nu pot importa direct din `filelist/download.ts`, care are cod server-only). |
| `tmdb.functions.ts` | Căutare/detalii TMDB (`searchTmdb`, `getTmdbDetails`, `getTmdbAllSeasons` — schema completă sezoane+episoade într-un request batched). | `AddMediaWizard.tsx`, `media-backfill.ts`, `tmdb-title-lookup.ts`. |
| `tmdb-client.ts` | Fetch helper de bază pentru TMDB API (auth, base URL). | `tmdb.functions.ts`, `tmdb.discover.functions.ts`. |
| `tmdb-title-lookup.ts` | Rezolvă titlul real al unui film/serial pornind de la IMDb id — pentru notificări/jurnal, nu numele tehnic al lansării. | `notifications.ts`, `filelist/download.ts`. |
| `tmdb.discover.functions.ts` | Server functions pentru pagina Descoperă (grid/feed TMDB). | `descopera/*`. |
| `torrent-name-parse.ts` | Extrage sezon/episod dintr-un nume de lansare (`parseSeasonEpisodeFromName`). | `tmdb-title-lookup.ts`, `filelist/log.ts`, `components/filelist/use-download.ts`. |
| `torrent-quality.ts` | Detectare calitate (720p/1080p/4K/4K HDR) dintr-un nume de lansare, pentru notificări. | `notifications.ts`, `filelist/download.ts`. |
| `notifications.ts` | Sursă unică pentru CONȚINUTUL notificărilor push (titlu/text/imagine/link) — trimiterea efectivă e în `push.ts`. | `filelist/download.ts`, `github-commit-tracker.ts`, `activity-log.ts`. |
| `push.ts` | `sendPushToAll` — singura funcție care vorbește efectiv cu `web-push`. | `notifications.ts` și apelanți direcți (erori, commit-uri). |
| `push.functions.ts` | Server functions pentru abonare/dezabonare push (VAPID). | `hooks/use-push-notifications.ts`. |
| `activity-log.ts` | Jurnal de activitate (SQLite) — `logActivity`, tipuri de eveniment (`ActivityType`), citire paginată. | `tehnic/sections/ActivityLogSection.tsx`, orice cod care loghează un eveniment. |
| `queries.ts` | TOATE `queryOptions(...)` reutilizate în mai multe componente — sursă unică pentru `queryKey`/`queryFn`/`staleTime`. | Peste tot unde se face `useQuery(xQuery)`. |
| `services.functions.ts` | Barrel — reexportă din `services/*`. | Componente client. |
| `filelist/categories.ts`, `filelist/download.ts`, `filelist/log.ts`, `filelist/subtitle-outcomes.ts`, `filelist/subtitles.ts`, `filelist/types.ts` | Vezi [src/lib/filelist/](#srclibfilelist) mai jos. | |
| `services/host.ts`, `services/immich.ts`, `services/plex*.ts`, `services/qbittorrent.ts`, `services/shared.ts` | Vezi [src/lib/services/](#srclibservices) mai jos. | |
| `qbit-client.ts` | Client qBittorrent unic — autentificare cookie SID + fetch cu retry automat la 401/403. | `filelist/download.ts`, `services/qbittorrent.ts`, `media-backfill.ts`. |
| `plex-refresh.ts` | SINGURUL loc care ar trebui să declanșeze un rescan de bibliotecă Plex, după orice modificare pe disk. | `filelist/download.ts`, `filelist/log.ts`, `services/qbittorrent.ts`. |
| `plex-users.server.ts` | Listă conturi Plex (prieteni/shared users) — pentru legarea unui cont nou la înregistrare. | `registration.functions.ts`. |
| `registration.functions.ts` | Server function pentru auto-înregistrare cont (status "pending"). | `routes/register.tsx`. |
| `users.functions.ts` | Server functions pagina Utilizatori — listă, detalii per cont (`getUserDetail`: logări, activitate Plex, descărcări reale). | `routes/users.tsx`, `UserDetailDrawer.tsx`. |
| `github.functions.ts` | Server functions GitHub — listă commit-uri, push manual din Tehnic (`pushToGitHub`), commit-uri locale nepublicate. | `tehnic/sections/CommitStatsSection.tsx`. |
| `speedtest.functions.ts` | Rulează speedtest CLI, salvează istoric în DB. | `tehnic/sections/SpeedtestChart.tsx`. |
| `versions.functions.ts` | Verificare versiuni pachete/Ubuntu disponibile pentru actualizare. | `routes/sistem.tsx`. |
| `agent.functions.ts` | Comenzi de sistem declanșate din UI (restart serviciu, actualizare) — server-only, cu whitelist strict de comenzi. | `ServiceHeaderActions.tsx`, `routes/sistem.tsx`. |
| `opensubtitles-client.ts` | Client OpenSubtitles REST v1 — sursă de rezervă pentru subtitrări RO. | `filelist/subtitles.ts`. |
| `subsro-client.ts` | Client subs.ro — a doua sursă de rezervă pentru subtitrări RO. | `filelist/subtitles.ts`. |
| `password.ts` | Hashing parole — scrypt nativ din `node:crypto`, format `"salt:hash"`. | `admin.functions.ts`, `registration.functions.ts`, `db.ts` (seed admin). |
| `format.ts` | Formatări reutilizate — bytes, viteză, durată, ETA. | Aproape toate rutele/componentele cu date numerice. |
| `utils.ts` | `cn()` — helper Tailwind pentru merge de clase (clsx + tailwind-merge). | Toate componentele `ui/*` + majoritatea componentelor cu `className` condiționat. |
| `error-log.ts` | Persistență SQLite pentru erori capturate (widget "Erori aplicație"). | `console-capture.ts`, `client-error-capture.ts`, `tehnic/sections/ErrorLogSection.tsx`. |
| `error-capture.ts` | Captează Error-ul original înainte ca h3 să-l înghită într-un 500 generic. | `src/server.ts`. |
| `error-page.ts` | Pagina de eroare HTML servită la crash necontrolat. | `src/server.ts`. |
| `console-capture.ts` | Instalează captarea automată `console.warn/error` server-side → `error-log.ts`. | `src/server.ts`, plugin-uri de fundal. |
| `client-error-capture.ts` | Echivalentul client-side al `console-capture.ts`. | `src/router.tsx` sau `__root.tsx` (instalare la boot client). |
| `update-signal.ts` | Semnal simplu pentru "există update disponibil" (citit de UI). | `routes/sistem.tsx`. |

### src/lib/filelist/

| Fișier | Ce conține | Folosit de |
|---|---|---|
| `types.ts` | Interfețe comune (`FilelistTorrent`, `FilelistCategory` etc). | Restul modulului + componente client. |
| `categories.ts` | Maparea completă a celor 31 de categorii Filelist.io (verificată direct pe API). | `download.ts`, `components/filelist/FilelistSection.tsx`. |
| `download.ts` | Cel mai mare fișier din `filelist/` — căutare Filelist (`checkFilelistForItemInternal`, `searchFilelistRaw`), orchestrare descărcare + upload qBittorrent (`downloadFilelistCore`), polling până la completare, backfill subtitrări (`runSubtitleBackfillIfIdle`). | `filelist.functions.ts` (barrel), `media-torrent-sync.ts`. |
| `log.ts` | Jurnal persistent al descărcărilor (SQLite `downloads`) + `deleteMediaEntry` (șterge titlu complet: qBittorrent + disk + `media` + `downloads`). | `filelist.functions.ts`, `BibliotecaList.tsx`. |
| `subtitles.ts` | Cel mai mare fișier din proiect — `ensureRomanianSubtitle`: verifică/corectează subtitrarea RO la finalul unei descărcări (embedded → tracked .srt → OpenSubtitles → subs.ro), inclusiv pachete de sezon episod cu episod. | `download.ts` (`pollUntilComplete`), backfill. |
| `subtitle-outcomes.ts` | Doar tipuri + constante pentru rezultatele `ensureRomanianSubtitle` — fișier "curat" (fără `node:fs`/`iconv-lite`) ca să poată fi importat și din componente client. | `SubtitleFixDrawer.tsx`, `subtitles.ts`. |

### src/lib/services/

| Fișier | Ce conține | Folosit de |
|---|---|---|
| `shared.ts` | Helpere HTTP comune (fetch cu timeout, tipuri de status partajate). | Restul `services/*`. |
| `plex-shared.ts` | Tipuri + helpere partajate între modulele Plex (discover URL, calitate media, subtitrare încorporată RO). Extras din fostul `plex.ts` monolitic. | `plex.ts`, `plex-library.ts`, `plex-browse.ts`, `media-backfill.ts`. |
| `plex.ts` | Status Plex principal — sesiuni active, biblioteci, istoric vizionări per user. | `routes/index.tsx`, `plex-session-tracker.ts`. |
| `plex-library.ts` | Căutare titluri/episoade în biblioteca Plex (`checkPlexHasTitle`, `getPlexEpisodesInSeason`, `checkPlexHasEpisode`). | `AddMediaWizard.tsx` (wizard). |
| `plex-browse.ts` | Date pentru pagina Bibliotecă — listă + detalii per titlu, citite exclusiv din `media` (zero cereri Plex/TMDB live la navigare). | `routes/biblioteca.tsx`, `BibliotecaList.tsx`, `TitleDetailDrawer.tsx`. |
| `qbittorrent.ts` | Status/acțiuni qBittorrent pentru pagina `/qbit` (listă torrente, pauză/reia/șterge). | `routes/qbit.tsx`. |
| `immich.ts` | Status/control serviciu Immich. | `routes/immich.tsx`. |
| `host.ts` | Metrici sistem (CPU/RAM/disc/rețea, via `systeminformation`). | `routes/sistem.tsx`. |

---

## src/components/ — UI

### src/components/biblioteca/

| Fișier | Ce conține |
|---|---|
| `BibliotecaList.tsx` | Lista principală — căutare, grupare episoade consecutive pe serial, butoane admin (backfill media/subtitrări). |
| `TitleDetailDrawer.tsx` | Drawer de detalii per titlu — status, subtitrare, cine a văzut, corectare/ștergere subtitrare, ștergere completă. |
| `StatusBadge.tsx` | Badge mic "Se descarcă" (status calculat din rândul `media`). |
| `utils.ts` | Helpere pure — grupare episoade, formatare dată, `matchesQuery` (căutare fără diacritice). |

### src/components/principala/

Wizard-ul de adăugare titlu — deschis din Acasă, sau prefill dintr-un titlu
deja identificat (prop `initialItem`, ex. din `SceneViewer.tsx`).

| Fișier | Ce conține |
|---|---|
| `AddMediaWizard.tsx` | Fișierul principal — pașii search → checking → result → done, calcul `seasonRows`/`bulkPlan` pentru TV, confirmare descărcare. |
| `wizard/SearchStep.tsx` | Pasul de căutare (input + listă rezultate TMDB). |
| `wizard/SeasonAccordion.tsx` | Listă sezoane/episoade cu status (`EpisodeAvailability`) — în Plex / se descarcă / disponibil / indisponibil / nelansat. |
| `wizard/WizardControls.tsx` | Piese mici fără stare proprie — `ActionButton`, `TorrentPicker`, `QualitySelector`, `PosterHero`. |
| `wizard/DoneStep.tsx` | Ecranul final de confirmare. |

### src/components/filelist/

Căutare manuală Filelist (admin) + piese partajate cu wizard-ul — **nu**
are legătură cu fostul sistem de fixare/urmărire (eliminat complet).

| Fișier | Ce conține |
|---|---|
| `FilelistSection.tsx` | Secțiunea de căutare manuală de pe Acasă (admin) — search + filtre + descărcare directă. |
| `DownloadConfirmDialog.tsx` | Dialog de confirmare descărcare, cu explicație a criteriului de potrivire (IMDb id). |
| `use-download.ts` | Hook `useDownload` — descărcare torrent + construire payload `media`. |
| `quality-utils.ts` | `detectQuality`, `groupTorrentsBySeasonEpisode` — parsare calitate/sezon din numele torrentelor. |
| `types.ts` | `QualitySet`, `SeasonGroup`. |

### src/components/tehnic/

| Fișier | Ce conține |
|---|---|
| `TehnicSubNav.tsx` | Navigare între sub-secțiunile paginii Tehnic. |
| `CommitDrawer.tsx` | Drawer detalii commit (local sau GitHub). |
| `SubtitleFixDrawer.tsx` | Drawer rezultat corectare subtitrare (per torrent sau backfill). |
| `UserDetailDrawer.tsx` | Drawer detalii cont — contact, Plex, descărcări, istoric autentificări. |
| `Metric.tsx`, `StatCell.tsx` | Piese mici de afișare valoare+etichetă. |
| `utils.ts` | Formatare dată/oră completă RO, `relativeTime`. |
| `sections/ActivityLogSection.tsx` | Timeline activitate + commit-uri, cu filtre pe categorie. |
| `sections/CommitStatsSection.tsx` | Statistici commit-uri, listă commit-uri locale nepublicate, buton push manual. |
| `sections/ErrorLogSection.tsx` | Listă erori capturate automat. |
| `sections/PlexServiceCard.tsx` | Control serviciu Plex (restart/actualizare). |
| `sections/PluginStatusSection.tsx` | Status plugin-uri de fundal active (ultima rulare). |
| `sections/SpeedtestChart.tsx` | Grafic istoric speedtest. |

### src/components/descopera/

| Fișier | Ce conține |
|---|---|
| `DiscoverGrid.tsx` | Vizualizare grid TMDB (populare/trending). |
| `FeedView.tsx` | Vizualizare feed video vertical (stil TikTok) peste rezultate TMDB. |
| `FilterTabs.tsx` | Tab-uri de filtrare (filme/seriale/populare/trending). |
| `SceneViewer.tsx` | Viewer scene/trailer pentru un titlu, cu buton "Adaugă" → deschide `AddMediaWizard`. |

### src/components/ui/

Primitive shadcn/ui, câte una per componentă radix. **Doar cele efectiv
folosite** — restul (33 de fișiere: accordion, select, table, tabs etc.) au
fost eliminate 2026-08-16, nefolosite niciodată.

| Fișier | Radix/lib din spate | Folosit de |
|---|---|---|
| `dialog.tsx` | `@radix-ui/react-dialog` | `AddMediaWizard.tsx` (pas desktop). |
| `drawer.tsx` | `vaul` | Toate drawer-urile de detalii (Bibliotecă, Tehnic, Utilizatori). |
| `alert-dialog.tsx` | `@radix-ui/react-alert-dialog` | Confirmări distructive (ștergere titlu). |
| `progress.tsx` | `@radix-ui/react-progress` | Bare de progres (backfill, verificare subtitrări). |
| `button.tsx` | `class-variance-authority` (doar `buttonVariants`, fără componenta `Button` — nefolosită, eliminată) | `alert-dialog.tsx` (stilizare acțiuni). |
| `sonner.tsx` | `sonner` | Toast-uri, montat în `__root.tsx`. |

### Rădăcină src/components/

| Fișier | Ce conține |
|---|---|
| `AppHeader.tsx` | Header-ul global (logo, nav desktop). |
| `BottomNav.tsx` | Navigare mobil, jos. |
| `PageShell.tsx` | Wrapper de layout comun per pagină. |
| `ServiceHeaderActions.tsx` | Butoane acțiune (restart/update) + `ServicePill`/`CommandOutput` pentru carduri de serviciu. |
| `ServicePill.tsx` | Badge status serviciu (activ/oprit/eroare). |
| `StatCard.tsx` | Card metrică cu micro-flash la schimbare valoare. |
| `Meter.tsx` | Bară/gauge simplă pentru procente (CPU/RAM/disc). |
| `ErrorCard.tsx` | Card afișare eroare capturată. |
| `useServiceRecovery.ts` | Hook — detectează revenirea unui serviciu după restart, declanșează refetch. |

---

## src/hooks/

| Fișier | Ce conține |
|---|---|
| `use-auto-reload.ts` | Compară `deploy-sha` curent cu cel de la încărcarea paginii — reîncarcă automat după un deploy. |
| `use-push-notifications.ts` | Abonare/dezabonare push notifications din browser (Service Worker + VAPID). |

---

## Rădăcină src/

| Fișier | Ce conține |
|---|---|
| `router.tsx` | Configurare TanStack Router (query client, error boundary). |
| `server.ts` | Entry point server — instalează captarea erorilor, pornește Nitro. |
| `start.ts` | Entry point TanStack Start (client hydration). |
| `routeTree.gen.ts` | **Generat automat** — nu edita manual. |


## Analiză cantitativă

Generată programatic (grep/python pe tot `src/`+`server/`) — 2026-08-16.
Regenerează cu același script dacă vrei o poză actualizată; nu ține pasul
automat cu schimbările de cod.

**Total: 122 fișiere, ~19 765 linii, ~418 funcții** (numărătoare aproximativă —
funcții numite + `const x = (...) =>`, nu include metode de clasă sau
funcții anonime inline).

### Pe zonă

| Zonă | Fișiere | Linii |
|---|---:|---:|
| `src/routes/` (11 pagini) | 11 | 2 554 |
| `src/lib/` (rădăcină) | 39 | 5 909 |
| `src/lib/filelist/` | 6 | 2 785 |
| `src/lib/services/` | 8 | 2 088 |
| `src/components/` (toate subdirectoarele) | ~40 | ~4 100 |
| `src/hooks/` | 2 | 129 |
| `server/plugins/` | 4 | 227 |
| `server/routes/api/` | 3 | 124 |

### Fișiere-hub (fan-in mare — importate de multe alte fișiere)

Cele mai "riscante" de modificat: orice schimbare de semnătură se propagă
în multe locuri.

| Fișier | Importat de |
|---|---:|
| `lib/queries.ts` | 15 |
| `lib/filelist.functions.ts` | 14 |
| `components/PageShell.tsx` | 10 |
| `lib/services/shared.ts` | 10 |
| `components/ui/drawer.tsx` | 9 |
| `lib/format.ts` | 8 |
| `lib/tmdb.discover.functions.ts` | 8 |
| `lib/admin-route-guard.ts` | 7 |
| `lib/error-log.ts` | 7 |

### Straturi (fluxul de import, fără cicluri detectate)

```
routes/*.tsx  (11 pagini)
     │  importă
     ▼
components/{biblioteca,principala,filelist,tehnic,descopera}/*
     │  importă
     ▼
lib/*.functions.ts + lib/queries.ts   (server functions + query cache)
     │  importă
     ▼
lib/{media,db,filelist/*,services/*}  (logică de domeniu + acces SQLite/API-uri externe)
```

`server/plugins/*` și `server/routes/api/*` au fan-in 0 din restul grafului
— nu sunt moarte, sunt încărcate de Nitro prin convenție de folder, nu prin
import explicit (vezi secțiunea `server/` de mai sus).

### Tabel complet, toate cele 122 de fișiere (sortat descrescător după linii)

| Fișier | Linii | Funcții | Fan-in |
|---|---:|---:|---:|
| `src/lib/filelist/subtitles.ts` | 1208 | 33 | 1 |
| `src/lib/filelist/download.ts` | 1160 | 14 | 1 |
| `src/components/principala/AddMediaWizard.tsx` | 905 | 18 | 3 |
| `src/lib/media.ts` | 509 | 11 | 3 |
| `src/lib/tmdb.functions.ts` | 493 | 10 | 6 |
| `src/lib/db.ts` | 490 | 3 | 2 |
| `src/lib/media-backfill.ts` | 468 | 10 | 1 |
| `src/lib/activity-log.ts` | 454 | 12 | 4 |
| `src/routes/qbit.tsx` | 452 | 3 | 0 |
| `src/lib/github.functions.ts` | 437 | 2 | 5 |
| `src/lib/services/plex.ts` | 406 | 5 | 1 |
| `src/components/biblioteca/BibliotecaList.tsx` | 402 | 6 | 1 |
| `src/routes/index.tsx` | 384 | 5 | 0 |
| `src/routes/sistem.tsx` | 348 | 3 | 0 |
| `src/routes/users.tsx` | 348 | 7 | 0 |
| `src/lib/services/plex-library.ts` | 312 | 12 | 2 |
| `src/components/biblioteca/TitleDetailDrawer.tsx` | 306 | 4 | 1 |
| `src/lib/services/qbittorrent.ts` | 292 | 2 | 1 |
| `src/components/filelist/FilelistSection.tsx` | 288 | 1 | 1 |
| `src/lib/services/plex-browse.ts` | 286 | 2 | 4 |
| `src/components/principala/wizard/SeasonAccordion.tsx` | 279 | 5 | 2 |
| `src/lib/services/plex-shared.ts` | 279 | 11 | 3 |
| `src/lib/speedtest.functions.ts` | 272 | 5 | 3 |
| `src/components/tehnic/UserDetailDrawer.tsx` | 270 | 2 | 1 |
| `src/lib/tmdb-title-lookup.ts` | 257 | 6 | 2 |
| `src/lib/services/host.ts` | 241 | 4 | 1 |
| `src/routes/__root.tsx` | 240 | 9 | 0 |
| `src/components/principala/wizard/WizardControls.tsx` | 236 | 5 | 1 |
| `src/lib/users.functions.ts` | 228 | 0 | 2 |
| `src/lib/error-log.ts` | 226 | 7 | 7 |
| `src/components/tehnic/sections/ErrorLogSection.tsx` | 225 | 2 | 1 |
| `src/components/tehnic/sections/ActivityLogSection.tsx` | 224 | 1 | 1 |
| `src/lib/services/immich.ts` | 222 | 1 | 1 |
| `src/routes/tehnic.tsx` | 218 | 1 | 0 |
| `src/routes/immich.tsx` | 196 | 1 | 0 |
| `src/components/descopera/FeedView.tsx` | 195 | 3 | 1 |
| `src/lib/opensubtitles-client.ts` | 192 | 8 | 1 |
| `src/lib/agent.functions.ts` | 186 | 2 | 6 |
| `src/routes/register.tsx` | 181 | 1 | 0 |
| `src/lib/filelist/log.ts` | 177 | 6 | 2 |
| `src/lib/tmdb.discover.functions.ts` | 177 | 3 | 8 |
| `src/components/descopera/DiscoverGrid.tsx` | 156 | 5 | 1 |
| `src/lib/queries.ts` | 156 | 0 | 15 |
| `src/lib/qbit-client.ts` | 147 | 9 | 5 |
| `src/components/AppHeader.tsx` | 144 | 3 | 1 |
| `src/components/tehnic/CommitDrawer.tsx` | 143 | 5 | 2 |
| `src/lib/notifications.ts` | 140 | 7 | 2 |
| `src/components/filelist/DownloadConfirmDialog.tsx` | 133 | 2 | 2 |
| `src/components/tehnic/sections/CommitStatsSection.tsx` | 131 | 1 | 1 |
| `src/components/descopera/SceneViewer.tsx` | 125 | 1 | 1 |
| `src/components/tehnic/SubtitleFixDrawer.tsx` | 125 | 3 | 1 |
| `src/components/ServiceHeaderActions.tsx` | 124 | 3 | 4 |
| `src/lib/versions.functions.ts` | 119 | 9 | 2 |
| `src/routes/login.tsx` | 116 | 1 | 0 |
| `src/lib/admin.functions.ts` | 115 | 0 | 5 |
| `src/components/ui/alert-dialog.tsx` | 111 | 2 | 2 |
| `src/lib/subsro-client.ts` | 109 | 7 | 1 |
| `src/components/filelist/use-download.ts` | 104 | 3 | 1 |
| `src/hooks/use-push-notifications.ts` | 88 | 5 | 1 |
| `src/lib/filelist/types.ts` | 88 | 0 | 3 |
| `src/lib/filelist/categories.ts` | 84 | 2 | 4 |
| `src/lib/console-capture.ts` | 83 | 4 | 2 |
| `src/lib/plex-users.server.ts` | 82 | 6 | 0 |
| `src/components/ui/drawer.tsx` | 79 | 2 | 9 |
| `src/components/tehnic/sections/SpeedtestChart.tsx` | 77 | 3 | 1 |
| `src/components/principala/wizard/SearchStep.tsx` | 76 | 1 | 1 |
| `server/plugins/github-commit-tracker.ts` | 74 | 1 | 0 |
| `src/components/BottomNav.tsx` | 74 | 1 | 1 |
| `src/lib/filelist/subtitle-outcomes.ts` | 74 | 0 | 3 |
| `src/lib/plex-refresh.ts` | 74 | 6 | 2 |
| `src/components/tehnic/sections/PluginStatusSection.tsx` | 72 | 3 | 1 |
| `src/components/ui/dialog.tsx` | 70 | 1 | 1 |
| `src/components/biblioteca/utils.ts` | 69 | 6 | 2 |
| `server/plugins/media-torrent-sync.ts` | 68 | 1 | 0 |
| `server/routes/api/github-webhook.ts` | 67 | 1 | 0 |
| `src/lib/push.ts` | 66 | 3 | 1 |
| `src/server.ts` | 65 | 2 | 0 |
| `src/components/descopera/FilterTabs.tsx` | 64 | 2 | 1 |
| `src/lib/admin.server.ts` | 64 | 5 | 0 |
| `src/components/filelist/quality-utils.ts` | 63 | 3 | 2 |
| `src/lib/client-error-capture.ts` | 63 | 2 | 1 |
| `src/routes/descopera.tsx` | 62 | 1 | 0 |
| `server/plugins/plex-session-tracker.ts` | 60 | 2 | 0 |
| `src/lib/registration.functions.ts` | 60 | 0 | 1 |
| `src/lib/services/shared.ts` | 58 | 6 | 10 |
| `src/lib/format.ts` | 56 | 6 | 8 |
| `src/components/tehnic/sections/PlexServiceCard.tsx` | 55 | 1 | 1 |
| `src/components/Meter.tsx` | 46 | 1 | 2 |
| `src/hooks/use-auto-reload.ts` | 43 | 2 | 1 |
| `src/components/StatCard.tsx` | 42 | 1 | 3 |
| `src/components/useServiceRecovery.ts` | 39 | 2 | 3 |
| `src/components/ServicePill.tsx` | 37 | 1 | 3 |
| `server/routes/api/plex-thumb.ts` | 35 | 1 | 0 |
| `src/components/principala/wizard/DoneStep.tsx` | 34 | 1 | 1 |
| `src/components/tehnic/TehnicSubNav.tsx` | 33 | 1 | 5 |
| `src/components/ui/button.tsx` | 31 | 0 | 1 |
| `src/lib/error-page.ts` | 31 | 1 | 2 |
| `src/lib/push.functions.ts` | 31 | 0 | 1 |
| `server/plugins/fast-shutdown.ts` | 29 | 1 | 0 |
| `src/components/tehnic/utils.ts` | 28 | 2 | 6 |
| `src/lib/error-capture.ts` | 28 | 2 | 1 |
| `src/components/ui/progress.tsx` | 26 | 0 | 1 |
| `src/start.ts` | 26 | 0 | 0 |
| `server/routes/api/deploy-sha.ts` | 25 | 1 | 0 |
| `src/components/ui/sonner.tsx` | 24 | 1 | 1 |
| `src/lib/password.ts` | 24 | 2 | 1 |
| `src/components/PageShell.tsx` | 22 | 1 | 10 |
| `src/lib/admin-route-guard.ts` | 20 | 2 | 7 |
| `src/routes/biblioteca.tsx` | 20 | 1 | 0 |
| `src/components/tehnic/Metric.tsx` | 18 | 1 | 1 |
| `src/components/tehnic/StatCell.tsx` | 18 | 1 | 1 |
| `src/lib/tmdb-client.ts` | 18 | 1 | 3 |
| `src/lib/torrent-name-parse.ts` | 17 | 1 | 2 |
| `src/router.tsx` | 17 | 1 | 0 |
| `src/components/filelist/types.ts` | 16 | 0 | 2 |
| `src/lib/torrent-quality.ts` | 16 | 1 | 1 |
| `src/components/biblioteca/StatusBadge.tsx` | 15 | 1 | 2 |
| `src/components/ErrorCard.tsx` | 14 | 1 | 3 |
| `src/lib/update-signal.ts` | 14 | 2 | 3 |
| `src/lib/filelist.functions.ts` | 10 | 0 | 14 |
| `src/lib/services.functions.ts` | 9 | 0 | 6 |
| `src/lib/utils.ts` | 7 | 1 | 4 |

**Total: 122 fișiere, 19765 linii, 418 funcții (named + arrow-la-const).**

---

## Note pentru actualizare

- Când muți/redenumești un fișier: actualizează rândul lui aici în același commit.
- Când ștergi un fișier confirmat mort (vezi sesiunile de curățenie cu `knip`/`tsc --noUnusedLocals`): șterge și rândul din tabel.
- Nu e nevoie de acoperire 100% perfectă de la început — completează pe măsură ce lucrezi într-o zonă a codului.
