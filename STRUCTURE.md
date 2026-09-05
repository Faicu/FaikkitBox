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
  - [src/lib/auth/](#srclibauth)
  - [src/lib/tmdb/](#srclibtmdb)
  - [src/lib/media/](#srclibmedia)
  - [src/lib/notifications/](#srclibnotifications)
  - [src/lib/errors/](#srcliberrors)
  - [src/lib/system/](#srclibsystem)
  - [src/lib/filelist/](#srclibfilelist)
  - [src/lib/services/](#srclibservices)
- [src/components/ — UI](#src-components--ui)
  - [src/components/biblioteca/](#srccomponentsbiblioteca)
  - [src/components/principala/](#srccomponentsprincipala)
  - [src/components/filelist/](#srccomponentsfilelist)
  - [src/components/tehnic/](#srccomponentstehnic)
  - [src/components/sistem/](#srccomponentssistem)
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
| `plugins/activity-boot.ts` | Pornește logarea ciclului de viață al serverului (pornire/oprire/cauză) la boot-ul Nitro. Există fiindcă blocul respectiv rula ca side-effect de modul și se executa abia la prima cerere HTTP — vezi `src/lib/activity-log.ts`. |
| `plugins/fast-shutdown.ts` | Shutdown rapid și controlat la SIGTERM/SIGINT (fără el, Node așteaptă implicit să dreneze toate conexiunile, inclusiv SSE-ul de auto-reload). |
| `plugins/filelist-resume.ts` | La +15s după pornire: reia buclele de polling ale descărcărilor neterminate, omorâte de restart. Fără el, un torrent care se termină după restart nu e observat niciodată (fără subtitrare, `completed_at`, notificare sau legare Plex). |
| `plugins/github-commit-tracker.ts` | La pornire: sincronizează ultimele commit-uri din GitHub în DB, trimite push pentru cele noi (acoperă webhook-ul picat în timpul unui restart). |
| `plugins/plex-link-reconciler.ts` | La +45s, apoi la 10 min: reîncearcă legarea la Plex pentru titlurile descărcate complet în ultimele 72h care încă n-au `plex_rating_key` (plasă de siguranță pentru restarturile din fereastra de legare). |
| `plugins/plex-session-tracker.ts` | Urmărește sesiunile de vizionare Plex active (polling la 30s), loghează start/stop prin `activity-log.ts`. |
| `routes/api/deploy-sha.ts` | Token de detectare restart (se schimbă la fiecare pornire a procesului) — clientul (`use-auto-reload.ts`) reîncarcă pagina când observă o valoare diferită. |
| `routes/api/github-webhook.ts` | Endpoint webhook GitHub (semnătură HMAC verificată) — push instant la commit nou, completează polling-ul din `github-commit-tracker.ts`. |
| `routes/api/plex-thumb.ts` | Proxy autentificat pentru thumbnail-urile Plex (tokenul nu ajunge la client). Acceptă o singură formă de cale, pe listă albă — vezi nota de securitate din fișier. |

**Notă:** trei dintre plugin-uri (`activity-boot`, `filelist-resume`,
`plex-link-reconciler`) există pentru că munca de la pornirea serverului
trebuie declanșată explicit, nu dintr-un `setTimeout` la nivel de modul. Un
efect de modul rulează doar dacă cineva importă modulul, iar asta depinde de
grafuri de import care se schimbă la refactorizări — două bug-uri identice au
fost cauzate exact de asta.

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
(`createServerFn`) — granița client/server a aplicației. De la
2026-08-17, `lib/` e grupat pe domeniu în subfoldere (`auth/`, `tmdb/`,
`media/`, `notifications/`, `errors/`, `system/`, plus `filelist/` și
`services/`, deja existente) — la rădăcină rămân doar fișierele cu adevărat
transversale, fără un singur domeniu clar.

> **Regulă: `*.functions.ts` nu importă STATIC module server-only.**
>
> Corpul unui handler `createServerFn` e eliminat din bundle-ul de client,
> deci un `await import("./x")` din interiorul lui rămâne pe server. Un import
> static la vârful fișierului, în schimb, trage tot graful în bundle-ul public.
>
> Nerespectarea regulii a făcut ca `/assets/db-*.js` să fie servit cu 200
> oricărui browser, cu schema SQLite completă și hashing-ul de parole la
> vedere (fără secrete din `.env` — build-ul le înlocuiește), și a produs
> eroarea `(0 , n.dirname) is not a function` din "Erori aplicație", rămasă
> luni de zile neexplicată: `node:path` era stub-uit în chunk-ul de client.
>
> De aceea există perechi ca `media.ts` / `media.functions.ts`,
> `activity-log.ts` / `activity-log.functions.ts`, `error-log.ts` /
> `error-log.functions.ts`, `filelist/download.ts` /
> `filelist/download.functions.ts`, `system/network-link.ts` /
> `system/network-link.functions.ts`: logica stă în primul, definițiile de
> server functions în al doilea. Verificare rapidă după un refactor:
> `grep -l "__vite-browser-external" .output/public/assets/*.js` trebuie să nu
> întoarcă nimic.

**La rădăcina `lib/`:**

| Fișier | Ce conține | Folosit de |
|---|---|---|
| `db.ts` | Schema SQLite completă (`CREATE TABLE IF NOT EXISTS`) + migrări incrementale versionate cu `PRAGMA user_version` (`runCleanups`). Singurul loc unde se definește schema. | Orice fișier care face `getDb()`. |
| `queries.ts` | TOATE `queryOptions(...)` reutilizate în mai multe componente — sursă unică pentru `queryKey`/`queryFn`/`staleTime`. Intervalele live sunt funcții, nu constante, ca ritmul reglabil din Sistem să aibă efect imediat. | Peste tot unde se face `useQuery(xQuery)` — printre cele mai importate fișiere (17). |
| `activity-log.ts` | Jurnal de activitate (SQLite) — `logActivity`, tipuri de eveniment (`ActivityType`), urmărirea sesiunilor Plex și logarea ciclului de viață al serverului (`initServerLifecycleLogging`, heartbeat, detectarea opririlor necurate). Server-only. | `server/plugins/activity-boot.ts`, orice cod care loghează un eveniment. |
| `activity-log.functions.ts` | Doar `getActivityLog` — fișierul subțire pe care îl importă clientul. | `queries.ts`, `tehnic/sections/ActivityLogSection.tsx`. |
| `refresh-rate.ts` | Ritmul de reîmprospătare al statisticilor live, reglabil de utilizator (localStorage, per dispozitiv) — `getRefreshMs`, presetări, notificare la schimbare. | `queries.ts`, `sistem/RefreshRateCard.tsx`. |
| `qbit-client.ts` | Client qBittorrent unic — autentificare cookie SID + fetch cu retry automat la 401/403. Folosit deopotrivă de `filelist/` și `services/`, nu are un singur "acasă" domeniu. | `filelist/download.ts`, `services/qbittorrent.ts`, `services/plex-browse.ts`. |
| `plex-refresh.ts` | SINGURUL loc care ar trebui să declanșeze un rescan de bibliotecă Plex, după orice modificare pe disk. | `filelist/download.ts`, `filelist/log.ts`, `services/qbittorrent.ts`. |
| `github.functions.ts` | Server functions GitHub — listă commit-uri, push manual din Tehnic (`pushToGitHub`), commit-uri locale nepublicate. | `tehnic/sections/CommitStatsSection.tsx`. |
| `format.ts` | Formatări reutilizate — bytes, viteză, durată, ETA. | Aproape toate rutele/componentele cu date numerice. |
| `utils.ts` | `cn()` — helper Tailwind pentru merge de clase (clsx + tailwind-merge). | Toate componentele `ui/*` + majoritatea componentelor cu `className` condiționat. |
| `filelist.functions.ts` | Barrel — reexportă din `filelist/*` (vezi mai jos). | Componente client (nu pot importa direct din `filelist/download.ts`, care are cod server-only). |
| `services.functions.ts` | Barrel — reexportă din `services/*`. | Componente client. |

### src/lib/auth/

| Fișier | Ce conține | Folosit de |
|---|---|---|
| `admin.server.ts` | `requireAuth`/`requireAdmin`/`isAdminOrOwner` — verificări de sesiune, server-only. | Aproape orice server function care are nevoie de autentificare. |
| `admin.functions.ts` | Server functions pentru gestionarea conturilor (aprobare, roluri). | `routes/users.tsx`. |
| `admin-route-guard.ts` | Guard TanStack Router — orice cont autentificat (nu doar admin), pentru rute ca Descoperă/Bibliotecă. | `beforeLoad` în rutele protejate. |
| `registration.functions.ts` | Server function pentru auto-înregistrare cont (status "pending"). | `routes/register.tsx`. |
| `users.functions.ts` | Server functions pagina Utilizatori — listă, detalii per cont (`getUserDetail`: logări, activitate Plex, descărcări reale). | `routes/users.tsx`, `UserDetailDrawer.tsx`. |
| `plex-users.server.ts` | Listă conturi Plex (prieteni/shared users) — pentru legarea unui cont nou la înregistrare. | `registration.functions.ts`. |
| `password.ts` | Hashing parole — scrypt nativ din `node:crypto`, format `"salt:hash"`. | `admin.functions.ts`, `registration.functions.ts`, `db.ts` (seed admin). |
| `rate-limit.ts` | Limitator cu fereastră fixă, în memorie, cu curățare periodică a hărții. Folosit de login (15/IP, 8/utilizator la 15 min) și înregistrare (6/IP pe oră). | `admin.functions.ts`, `registration.functions.ts`. |

### src/lib/tmdb/

| Fișier | Ce conține | Folosit de |
|---|---|---|
| `tmdb.functions.ts` | Căutare/detalii TMDB (`searchTmdb`, `getTmdbDetails`, `getTmdbAllSeasons` — schema completă sezoane+episoade într-un request batched). | `AddMediaWizard.tsx`, `tmdb-title-lookup.ts`. |
| `tmdb-client.ts` | Fetch helper de bază pentru TMDB API (auth, base URL). | `tmdb.functions.ts`, `tmdb.discover.functions.ts`. |
| `tmdb-title-lookup.ts` | Rezolvă titlul real al unui film/serial pornind de la IMDb id — pentru notificări/jurnal, nu numele tehnic al lansării. | `notifications/notifications.ts`, `filelist/subtitles.ts`. |
| `tmdb.discover.functions.ts` | Server functions pentru pagina Descoperă (grid/feed TMDB). | `descopera/*`. |

### src/lib/media/

| Fișier | Ce conține | Folosit de |
|---|---|---|
| `media.ts` | Sursă unică pentru tabela `media` (filme/seriale/episoade reale — descărcate sau backfill din Plex). `upsertMediaEntry`, `upsertMediaEntryFromPlex` (întoarce `{ id, created }`), `ensureMediaPlaceholder` (rând-părinte serial), `cleanupOrphanSeasonPackPlaceholders` (șterge placeholder-ele de pachet de sezon rămase orfane, apelată periodic). | `filelist/download.ts`, `filelist/log.ts`, `services/plex-browse.ts`, `media/plex-link-reconciler.ts`. |
| `media.functions.ts` | Server functions peste `media.ts` (`searchLibraryTitles`, `getDownloadingMediaForTmdbId`) — fișierul subțire pe care îl importă clientul. | `AddMediaWizard.tsx`, `DownloadConfirmDialog.tsx`. |
| `plex-link-reconciler.ts` | Reîncearcă legarea la Plex pentru titluri complete fără `plex_rating_key` (ultimele 72h). Plasa de siguranță pentru restarturile din fereastra de legare. | `server/plugins/plex-link-reconciler.ts`. |
| `torrent-name-parse.ts` | Extrage sezon/episod dintr-un nume de lansare (`parseSeasonEpisodeFromName`). | `tmdb/tmdb-title-lookup.ts`, `filelist/log.ts`, `components/filelist/use-download.ts`. |
| `torrent-quality.ts` | Detectare calitate (720p/1080p/4K/4K HDR) dintr-un nume de lansare, pentru notificări. | `notifications/notifications.ts`, `filelist/download.ts`. |

### src/lib/notifications/

| Fișier | Ce conține | Folosit de |
|---|---|---|
| `notifications.ts` | Sursă unică pentru CONȚINUTUL notificărilor push (titlu/text/imagine/link) — trimiterea efectivă e în `push.ts`. | `filelist/download.ts`, `github-commit-tracker.ts`, `activity-log.ts`. |
| `push.ts` | `sendPushToAll` — singura funcție care vorbește efectiv cu `web-push`. | `notifications.ts` și apelanți direcți (erori, commit-uri). |
| `push.functions.ts` | Server functions pentru abonare/dezabonare push (VAPID). | `hooks/use-push-notifications.ts`. |

### src/lib/errors/

| Fișier | Ce conține | Folosit de |
|---|---|---|
| `error-log.ts` | Persistență SQLite pentru erori capturate (widget "Erori aplicație"). | `console-capture.ts`, `client-error-capture.ts`, `tehnic/sections/ErrorLogSection.tsx`. |
| `error-log.functions.ts` | Server functions peste `error-log.ts` (`getErrorLogs`, `clearErrorLogs`, `logClientError`) — importat de `__root.tsx`, deci de fiecare pagină. | `queries.ts`, `__root.tsx`, `ErrorLogSection.tsx`. |
| `error-capture.ts` | Captează Error-ul original înainte ca h3 să-l înghită într-un 500 generic. | `src/server.ts`. |
| `error-page.ts` | Pagina de eroare HTML servită la crash necontrolat. | `src/server.ts`. |
| `console-capture.ts` | Instalează captarea automată `console.warn/error` server-side → `error-log.ts`. | `src/server.ts`, plugin-uri de fundal. |
| `client-error-capture.ts` | Echivalentul client-side al `console-capture.ts`. | `__root.tsx` (instalare la boot client). |

### src/lib/system/

| Fișier | Ce conține | Folosit de |
|---|---|---|
| `agent.functions.ts` | Comenzi de sistem declanșate din UI (restart serviciu, actualizare) — server-only, cu whitelist strict de comenzi. | `ServiceHeaderActions.tsx`, `routes/sistem.tsx`. |
| `network-link.ts` | Starea legăturii Ethernet (interfața rutei implicite, viteză negociată, maximul posibil pe ambele capete) + renegociere prin `ethtool -r`, rulat detașat fiindcă legătura cade câteva secunde. Server-only. | `network-link.functions.ts`. |
| `network-link.functions.ts` | `getNetworkLink` / `renegotiateNetworkLink`. | `queries.ts`, `tehnic/sections/NetworkLinkCard.tsx`. |
| `speedtest.functions.ts` | Rulează speedtest CLI, salvează istoric în DB. | `tehnic/sections/SpeedtestChart.tsx`. |
| `versions.functions.ts` | Verificare versiuni pachete/Ubuntu disponibile pentru actualizare. | `routes/sistem.tsx`. |
| `update-signal.ts` | Semnal simplu pentru "există update disponibil" (citit de UI). | `routes/sistem.tsx`. |

### src/lib/filelist/

| Fișier | Ce conține | Folosit de |
|---|---|---|
| `types.ts` | Interfețe comune (`FilelistTorrent`, `FilelistCategory` etc). | Restul modulului + componente client. |
| `categories.ts` | Maparea completă a celor 31 de categorii Filelist.io (verificată direct pe API). | `download.ts`, `components/filelist/FilelistSection.tsx`. |
| `download.functions.ts` | Server functions peste `download.ts` (`downloadFilelist`, `correctSubtitleForMedia`, `deleteSubtitleForMedia`) — fișierul subțire reexportat de barrel-ul `filelist.functions.ts`. | `filelist.functions.ts` → componente client. |
| `download.ts` | Cel mai mare fișier din `filelist/` — căutare Filelist strict pe IMDb id (`checkFilelistForItemInternal`, `searchFilelistRaw`, cache 10 min măturat pe timer), orchestrare descărcare + upload qBittorrent (`downloadFilelistCore` — răspunde imediat după upload, restul — hash, jurnal, `media`, polling — rulează în fundal prin `finishFilelistDownload`), polling până la completare. | `filelist/download.functions.ts`, `server/plugins/filelist-resume.ts`. |
| `log.ts` | Jurnal persistent al descărcărilor (SQLite `downloads`) + `deleteMediaEntry` (șterge titlu complet: qBittorrent + disk + `media` + `downloads`). | `filelist.functions.ts`, `BibliotecaList.tsx`. |
| `subtitles.ts` | Cel mai mare fișier din proiect — `ensureRomanianSubtitle`: verifică/corectează subtitrarea RO la finalul unei descărcări (embedded → tracked .srt → OpenSubtitles → subs.ro), inclusiv pachete de sezon episod cu episod. | `download.ts` (`pollUntilComplete`), backfill. |
| `subtitle-outcomes.ts` | Doar tipuri + constante pentru rezultatele `ensureRomanianSubtitle` — fișier "curat" (fără `node:fs`/`iconv-lite`) ca să poată fi importat și din componente client. | `SubtitleFixDrawer.tsx`, `subtitles.ts`. |
| `opensubtitles-client.ts` | Client OpenSubtitles REST v1 — sursă de rezervă pentru subtitrări RO. Mutat aici (era la rădăcina `lib/`) fiindcă e folosit exclusiv de `subtitles.ts`. | `subtitles.ts`. |
| `subsro-client.ts` | Client subs.ro — a doua sursă de rezervă pentru subtitrări RO. Mutat aici pentru același motiv. | `subtitles.ts`. |
| `release-scoring.ts` | `pickBestByRelease`/`extractTags`/`findTag` — potrivire nume de release (rezoluție/mod obținere/platformă/codec/grup) între candidați de subtitrare și fișierul media țintă. Extras din `subtitles.ts` (funcții pure, fără I/O). | `subtitles.ts`. |

### src/lib/services/

| Fișier | Ce conține | Folosit de |
|---|---|---|
| `shared.ts` | Helpere HTTP comune (fetch cu timeout, tipuri de status partajate). | Restul `services/*`. |
| `plex-shared.ts` | Tipuri + helpere partajate între modulele Plex (discover URL, calitate media, subtitrare încorporată RO). Extras din fostul `plex.ts` monolitic. | `plex.ts`, `plex-library.ts`, `plex-browse.ts`. |
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
| `useLiveViewOffsets.ts` | Interpolează local poziția de redare a sesiunilor Plex, ca ceasul h:m:s să curgă la secundă. Plex raportează progresul în trepte de ~10s, oricât de des am întreba. |

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
| `sections/NetworkLinkCard.tsx` | În drawer-ul Speedtest: viteza negociată a legăturii Ethernet (badge verde/chihlimbariu) + buton de renegociere. Rezolvă cazul recurent în care atingerea fizică a cablului lasă legătura pe 100 Mb/s. |

### src/components/sistem/

| Fișier | Ce conține |
|---|---|
| `RefreshRateCard.tsx` | Reglaj pentru ritmul statisticilor live (1s…30s), salvat per dispozitiv în localStorage. Vezi `lib/refresh-rate.ts`. |

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
| `use-live-counter.ts` | Face un contor care crește cu timpul (uptime) să avanseze la secundă în UI, între răspunsurile serverului — interpolare locală, zero cereri. | `routes/sistem.tsx`. |

---

## Rădăcină src/

| Fișier | Ce conține |
|---|---|
| `router.tsx` | Configurare TanStack Router (query client, error boundary). |
| `server.ts` | Entry point server — instalează captarea erorilor, pornește Nitro. |
| `start.ts` | Entry point TanStack Start (client hydration). |
| `routeTree.gen.ts` | **Generat automat** — nu edita manual. |


## Analiză cantitativă

Regenerată programatic pe 2026-09-05 (script peste tot
`src/` + `server/`: linii  funcții numite  fan-in rezolvat prin importurile
`@/` și relative  inclusiv `import()` dinamic). Spre deosebire de versiunile
anterioare  tabelul de mai jos e integral generat — nu mai are rânduri
actualizate manual, deci nu mai poate fi parțial vechi.

**Total: 146 fișiere, ~22 694 linii, ~550 funcții** (numărătoare
aproximativă — funcții numite  `const x = (...) =>` și `createServerFn`  fără
metode de clasă sau funcții anonime inline).

### Pe zonă

| Zonă | Fișiere | Linii |
|---|---:|---:|
| `src/routes/` (pagini) | 11 | 2 682 |
| `src/lib/` (rădăcină, transversale) | 12 | 2 355 |
| `src/lib/auth/` | 8 | 772 |
| `src/lib/tmdb/` | 4 | 967 |
| `src/lib/media/` | 5 | 751 |
| `src/lib/notifications/` | 3 | 286 |
| `src/lib/errors/` | 6 | 467 |
| `src/lib/system/` | 6 | 790 |
| `src/lib/filelist/` | 16 | 3 332 |
| `src/lib/services/` | 9 | 2 874 |
| `src/lib/tvmaze/` | 1 | 53 |
| `src/components/` (toate) | 49 | 6 412 |
| `src/hooks/` | 3 | 165 |
| `server/plugins/` | 6 | 245 |
| `server/routes/api/` | 3 | 176 |
| altele | 4 | 367 |

### Fișiere-hub (fan-in mare)

| Fișier | Importat de |
|---|---:|
| `lib/auth/admin.server.ts` | 25 |
| `lib/db.ts` | 17 |
| `lib/queries.ts` | 17 |
| `lib/activity-log.ts` | 13 |
| `lib/filelist.functions.ts` | 10 |
| `lib/services/shared.ts` | 10 |
| `components/PageShell.tsx` | 10 |
| `components/ui/drawer.tsx` | 8 |
| `lib/format.ts` | 8 |
| `lib/qbit-client.ts` | 8 |
| `components/tehnic/utils.ts` | 7 |
| `lib/auth/admin-route-guard.ts` | 7 |

### Straturi (fluxul de import, fără cicluri detectate)

```
routes/*.tsx  (11 pagini)
     │  importă
     ▼
components/{biblioteca,principala,filelist,tehnic,descopera,sistem}/*
     │  importă
     ▼
lib/*.functions.ts + lib/queries.ts   (server functions + query cache)
     │  importă DOAR dinamic, din corpul handlerelor
     ▼
lib/{auth,tmdb,media,notifications,errors,system,filelist,services}/*
     (logică de domeniu + acces SQLite/API-uri externe)
```

Săgeata a treia e regula care ține codul server în afara bundle-ului public:
un fișier `*.functions.ts` nu are voie să importe STATIC module server-only.
Vezi secțiunea despre convenția `*.functions.ts` de mai sus.

`server/plugins/*` și `server/routes/api/*` au fan-in 0 din restul grafului
— nu sunt moarte, sunt încărcate de Nitro prin convenție de folder, nu prin
import explicit (vezi secțiunea `server/`).

### Tabel complet, toate cele 146 de fișiere

| Fișier | Linii | Funcții | Fan-in |
|---|---:|---:|---:|
| `src/components/principala/AddMediaWizard.tsx` | 971 | 18 | 3 |
| `src/lib/filelist/download.ts` | 736 | 11 | 2 |
| `src/lib/services/plex-browse.ts` | 691 | 10 | 4 |
| `src/lib/activity-log.ts` | 633 | 17 | 13 |
| `src/lib/media/media.ts` | 605 | 13 | 5 |
| `src/lib/services/plex.ts` | 582 | 16 | 3 |
| `src/lib/db.ts` | 581 | 4 | 17 |
| `src/lib/filelist/subtitles.ts` | 494 | 9 | 2 |
| `src/components/biblioteca/TitleDetailDrawer.tsx` | 478 | 4 | 1 |
| `src/routes/qbit.tsx` | 466 | 3 | 1 |
| `src/lib/tmdb/tmdb.functions.ts` | 463 | 12 | 6 |
| `src/routes/index.tsx` | 447 | 5 | 1 |
| `src/lib/github.functions.ts` | 438 | 11 | 4 |
| `src/routes/sistem.tsx` | 363 | 3 | 1 |
| `src/components/biblioteca/BibliotecaList.tsx` | 360 | 5 | 1 |
| `src/routes/users.tsx` | 350 | 7 | 1 |
| `src/lib/services/plex-library.ts` | 344 | 15 | 2 |
| `src/lib/tmdb/tmdb-title-lookup.ts` | 300 | 7 | 4 |
| `src/components/principala/wizard/SeasonAccordion.tsx` | 299 | 7 | 1 |
| `src/lib/services/qbittorrent.ts` | 299 | 5 | 1 |
| `src/components/filelist/FilelistSection.tsx` | 287 | 1 | 1 |
| `src/lib/services/host.ts` | 281 | 6 | 1 |
| `src/lib/system/speedtest.functions.ts` | 271 | 8 | 3 |
| `src/components/tehnic/UserDetailDrawer.tsx` | 269 | 2 | 1 |
| `src/lib/filelist/filelist-client.ts` | 262 | 9 | 2 |
| `src/routeTree.gen.ts` | 262 | 0 | 1 |
| `src/routes/__root.tsx` | 262 | 9 | 1 |
| `src/lib/services/plex-shared.ts` | 261 | 6 | 2 |
| `src/lib/auth/users.functions.ts` | 256 | 4 | 2 |
| `src/components/filelist/DownloadConfirmDialog.tsx` | 238 | 3 | 2 |
| `src/components/principala/wizard/WizardControls.tsx` | 235 | 5 | 1 |
| `src/lib/filelist/log.ts` | 232 | 7 | 2 |
| `src/lib/services/immich.ts` | 230 | 3 | 1 |
| `src/components/tehnic/sections/ActivityLogSection.tsx` | 227 | 1 | 1 |
| `src/components/tehnic/sections/ErrorLogSection.tsx` | 224 | 2 | 1 |
| `src/lib/errors/error-log.ts` | 224 | 10 | 4 |
| `src/routes/tehnic.tsx` | 224 | 1 | 1 |
| `src/lib/queries.ts` | 216 | 1 | 17 |
| `src/lib/filelist/subsro-client.ts` | 211 | 13 | 1 |
| `src/routes/immich.tsx` | 195 | 1 | 1 |
| `src/components/descopera/FeedView.tsx` | 194 | 3 | 1 |
| `src/lib/system/agent.functions.ts` | 194 | 3 | 5 |
| `src/lib/filelist/release-scoring.ts` | 193 | 4 | 2 |
| `src/lib/filelist/opensubtitles-client.ts` | 191 | 8 | 3 |
| `src/lib/notifications/notifications.ts` | 191 | 10 | 5 |
| `src/lib/filelist/subtitle-apply.ts` | 187 | 4 | 1 |
| `src/lib/tmdb/tmdb.discover.functions.ts` | 187 | 6 | 5 |
| `src/routes/register.tsx` | 180 | 1 | 1 |
| `src/lib/filelist/subtitle-pipeline.ts` | 170 | 1 | 1 |
| `src/components/descopera/DiscoverGrid.tsx` | 159 | 6 | 1 |
| `src/lib/plex-refresh.ts` | 155 | 12 | 3 |
| `src/lib/system/network-link.ts` | 152 | 6 | 1 |
| `src/components/AppHeader.tsx` | 148 | 3 | 1 |
| `src/lib/qbit-client.ts` | 146 | 9 | 8 |
| `src/lib/auth/admin.functions.ts` | 145 | 5 | 5 |
| `src/components/tehnic/CommitDrawer.tsx` | 144 | 5 | 2 |
| `src/components/tehnic/SubtitleFixDrawer.tsx` | 139 | 3 | 1 |
| `src/lib/filelist/subtitle-checks.ts` | 139 | 11 | 2 |
| `src/components/descopera/SceneViewer.tsx` | 138 | 1 | 1 |
| `src/components/tehnic/sections/NetworkLinkCard.tsx` | 138 | 2 | 1 |
| `src/components/tehnic/sections/CommitStatsSection.tsx` | 130 | 1 | 1 |
| `src/lib/services/shared.ts` | 126 | 8 | 10 |
| `src/components/ServiceHeaderActions.tsx` | 124 | 3 | 4 |
| `src/lib/system/versions.functions.ts` | 118 | 10 | 2 |
| `src/lib/filelist/subtitle-encoding.ts` | 117 | 6 | 2 |
| `src/routes/login.tsx` | 115 | 1 | 1 |
| `src/components/ui/alert-dialog.tsx` | 110 | 2 | 0 |
| `src/components/biblioteca/utils.ts` | 107 | 9 | 2 |
| `src/components/filelist/use-download.ts` | 104 | 3 | 2 |
| `src/hooks/use-push-notifications.ts` | 91 | 5 | 1 |
| `src/lib/filelist/subtitle-sources.ts` | 88 | 1 | 2 |
| `src/lib/filelist/types.ts` | 87 | 0 | 5 |
| `src/lib/filelist/categories.ts` | 83 | 2 | 5 |
| `src/lib/errors/console-capture.ts` | 82 | 5 | 4 |
| `src/components/ui/drawer.tsx` | 81 | 2 | 8 |
| `src/lib/auth/plex-users.server.ts` | 81 | 6 | 1 |
| `src/lib/refresh-rate.ts` | 80 | 5 | 2 |
| `src/components/tehnic/sections/SpeedtestChart.tsx` | 79 | 3 | 1 |
| `src/lib/auth/registration.functions.ts` | 79 | 1 | 1 |
| `src/components/BottomNav.tsx` | 76 | 1 | 1 |
| `src/lib/auth/rate-limit.ts` | 76 | 4 | 2 |
| `src/components/principala/wizard/SearchStep.tsx` | 75 | 1 | 1 |
| `server/plugins/github-commit-tracker.ts` | 73 | 1 | 0 |
| `src/lib/filelist/subtitle-outcomes.ts` | 73 | 0 | 5 |
| `src/components/tehnic/sections/PluginStatusSection.tsx` | 71 | 3 | 1 |
| `src/lib/media/plex-link-reconciler.ts` | 70 | 1 | 1 |
| `src/components/ui/dialog.tsx` | 69 | 1 | 1 |
| `src/lib/filelist/download.functions.ts` | 69 | 3 | 1 |
| `server/routes/api/plex-thumb.ts` | 68 | 1 | 0 |
| `src/lib/auth/admin.server.ts` | 67 | 5 | 25 |
| `server/routes/api/github-webhook.ts` | 66 | 1 | 0 |
| `src/lib/notifications/push.ts` | 65 | 3 | 2 |
| `src/server.ts` | 64 | 2 | 0 |
| `src/components/descopera/FilterTabs.tsx` | 63 | 2 | 1 |
| `src/components/filelist/quality-utils.ts` | 62 | 3 | 2 |
| `src/lib/errors/client-error-capture.ts` | 62 | 3 | 1 |
| `server/plugins/plex-session-tracker.ts` | 61 | 2 | 0 |
| `src/routes/descopera.tsx` | 61 | 1 | 1 |
| `src/lib/services/recent-watch-cache.ts` | 60 | 1 | 2 |
| `src/components/principala/useLiveViewOffsets.ts` | 59 | 1 | 1 |
| `src/components/sistem/RefreshRateCard.tsx` | 55 | 1 | 1 |
| `src/lib/format.ts` | 55 | 6 | 8 |
| `src/components/tehnic/sections/PlexServiceCard.tsx` | 54 | 1 | 1 |
| `src/lib/tvmaze/tvmaze.functions.ts` | 53 | 2 | 1 |
| `src/components/Meter.tsx` | 45 | 1 | 2 |
| `src/lib/auth/admin-route-guard.ts` | 45 | 3 | 7 |
| `src/lib/media/media.functions.ts` | 45 | 2 | 2 |
| `server/routes/api/deploy-sha.ts` | 42 | 2 | 0 |
| `src/hooks/use-auto-reload.ts` | 42 | 2 | 1 |
| `src/lib/errors/error-log.functions.ts` | 42 | 3 | 4 |
| `src/lib/system/network-link.functions.ts` | 42 | 2 | 2 |
| `src/components/StatCard.tsx` | 41 | 1 | 3 |
| `src/components/useServiceRecovery.ts` | 38 | 2 | 3 |
| `src/components/ServicePill.tsx` | 36 | 1 | 3 |
| `src/components/principala/wizard/DoneStep.tsx` | 33 | 1 | 1 |
| `src/components/tehnic/TehnicSubNav.tsx` | 32 | 1 | 5 |
| `src/hooks/use-live-counter.ts` | 32 | 1 | 1 |
| `src/components/biblioteca/StatusBadge.tsx` | 31 | 1 | 2 |
| `src/components/ui/button.tsx` | 30 | 0 | 1 |
| `src/lib/errors/error-page.ts` | 30 | 1 | 2 |
| `src/lib/notifications/push.functions.ts` | 30 | 3 | 1 |
| `server/plugins/activity-boot.ts` | 29 | 0 | 0 |
| `server/plugins/fast-shutdown.ts` | 28 | 1 | 0 |
| `server/plugins/filelist-resume.ts` | 28 | 0 | 0 |
| `src/components/tehnic/utils.ts` | 27 | 2 | 7 |
| `src/lib/errors/error-capture.ts` | 27 | 2 | 1 |
| `server/plugins/plex-link-reconciler.ts` | 26 | 1 | 0 |
| `src/components/ui/progress.tsx` | 25 | 0 | 1 |
| `src/lib/activity-log.functions.ts` | 25 | 1 | 3 |
| `src/start.ts` | 25 | 0 | 1 |
| `src/components/ui/sonner.tsx` | 24 | 1 | 1 |
| `src/lib/auth/password.ts` | 23 | 2 | 3 |
| `src/components/PageShell.tsx` | 21 | 1 | 10 |
| `src/routes/biblioteca.tsx` | 19 | 1 | 1 |
| `src/components/tehnic/Metric.tsx` | 17 | 1 | 1 |
| `src/components/tehnic/StatCell.tsx` | 17 | 1 | 1 |
| `src/lib/tmdb/tmdb-client.ts` | 17 | 2 | 3 |
| `src/lib/media/torrent-name-parse.ts` | 16 | 1 | 3 |
| `src/router.tsx` | 16 | 1 | 1 |
| `src/components/filelist/types.ts` | 15 | 0 | 2 |
| `src/lib/media/torrent-quality.ts` | 15 | 1 | 1 |
| `src/components/ErrorCard.tsx` | 13 | 1 | 3 |
| `src/lib/system/update-signal.ts` | 13 | 2 | 3 |
| `src/lib/filelist.functions.ts` | 12 | 0 | 10 |
| `src/lib/services.functions.ts` | 8 | 0 | 5 |
| `src/lib/utils.ts` | 6 | 1 | 4 |

---

## Note pentru actualizare

- Când muți/redenumești un fișier: actualizează rândul lui aici în același commit.
- Când ștergi un fișier confirmat mort (vezi sesiunile de curățenie cu `knip`/`tsc --noUnusedLocals`): șterge și rândul din tabel.
- Nu e nevoie de acoperire 100% perfectă de la început — completează pe măsură ce lucrezi într-o zonă a codului.
