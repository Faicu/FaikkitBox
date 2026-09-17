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
  - [src/lib/tvmaze/](#srclibtvmaze)
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
| `plugins/db-backup.ts` | La +90s după pornire, apoi la 24h: copie a bazei prin `VACUUM INTO` în `data/backups/`, cu rotație la 14 fișiere. Sare peste rulare dacă ultima copie e mai nouă de 20h (altfel o zi cu multe deploy-uri ar goli rotația de istoric util). |
| `plugins/fast-shutdown.ts` | Shutdown rapid și controlat la SIGTERM/SIGINT (fără el, Node așteaptă implicit să dreneze toate conexiunile, inclusiv SSE-ul de auto-reload). |
| `plugins/filelist-resume.ts` | La +15s după pornire: reia buclele de polling ale descărcărilor neterminate, omorâte de restart. Fără el, un torrent care se termină după restart nu e observat niciodată (fără subtitrare, `completed_at`, notificare sau legare Plex). |
| `plugins/show-watcher.ts` | Urmărirea serialelor și a filmelor așteptate. Bucla rulează la 10 min (și la 30s pentru filmele tocmai adăugate), dar cadența reală per titlu — 3h la seriale, 12h la filme — stă în DB, pe `media.watch_last_checked_at`, nu într-un timer în memorie care s-ar reseta la restart. Logica propriu-zisă: `src/lib/media/show-watch.ts` și `movie-watch.ts`. |
| `plugins/github-commit-tracker.ts` | La pornire: sincronizează ultimele commit-uri din GitHub în DB, trimite push pentru cele noi (acoperă webhook-ul picat în timpul unui restart). |
| `plugins/plex-link-reconciler.ts` | La +45s, apoi la 10 min: reîncearcă legarea la Plex pentru titlurile descărcate complet în ultimele 72h care încă n-au `plex_rating_key` (plasă de siguranță pentru restarturile din fereastra de legare). |
| `plugins/plex-session-tracker.ts` | Urmărește sesiunile de vizionare Plex active (polling la 30s), loghează start/stop prin `activity-log.ts`. |
| `routes/api/deploy-sha.ts` | Token de detectare restart (se schimbă la fiecare pornire a procesului) — clientul (`use-auto-reload.ts`) reîncarcă pagina când observă o valoare diferită. |
| `routes/api/github-webhook.ts` | Endpoint webhook GitHub (semnătură HMAC verificată) — push instant la commit nou, completează polling-ul din `github-commit-tracker.ts`. |
| `routes/api/plex-thumb.ts` | Proxy autentificat pentru thumbnail-urile Plex (tokenul nu ajunge la client). Acceptă o singură formă de cale, pe listă albă — vezi nota de securitate din fișier. |

**Notă:** patru dintre plugin-uri (`activity-boot`, `filelist-resume`,
`plex-link-reconciler`, `show-watcher`) există pentru că munca de la pornirea serverului
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
| `biblioteca.tsx` (`/biblioteca`) | Cont aprobat | `BibliotecaList` — tot ce e descărcat prin aplicație sau deja în Plex, plus `WantedMoviesSection` (filmele urmărite, încă negăsite). |
| `descopera.tsx` (`/descopera`) | Cont aprobat | Explorare TMDB (grid + feed video), deschide wizard-ul pentru un titlu identificat. |
| `qbit.tsx` (`/qbit`) | Cont aprobat | Control qBittorrent — torrente active, viteze, acțiuni (pauză/reia/șterge). |
| `sistem.tsx` (`/sistem`) | Admin | Metrici OS (CPU/RAM/disc/rețea), speedtest, acțiuni serviciu. |
| `tehnic.tsx` (`/tehnic`) | Admin | Jurnal activitate, commit-uri GitHub, erori aplicație, status plugin-uri, backup DB, abonamente push, speedtest, push-to-GitHub. |
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
| `activity-log.ts` | Jurnal de activitate (SQLite) — `logActivity`, tipuri de eveniment (`ActivityType`), urmărirea sesiunilor Plex, logarea ciclului de viață al serverului (`initServerLifecycleLogging`, heartbeat, detectarea opririlor necurate) și retenția de 30 de zile (`pruneActivityLog`, rulată la pornire și apoi zilnic). Server-only. | `server/plugins/activity-boot.ts`, orice cod care loghează un eveniment. |
| `activity-log.functions.ts` | Doar `getActivityLog` — fișierul subțire pe care îl importă clientul. | `queries.ts`, `tehnic/sections/ActivityLogSection.tsx`. |
| `refresh-rate.ts` | Ritmul de reîmprospătare al statisticilor live, reglabil de utilizator (localStorage, per dispozitiv) — `getRefreshMs`, presetări, notificare la schimbare. | `queries.ts`, `sistem/RefreshRateCard.tsx`. |
| `qbit-client.ts` | Client qBittorrent unic — autentificare cookie SID + fetch cu retry automat la 401/403. Folosit deopotrivă de `filelist/` și `services/`, nu are un singur "acasă" domeniu. | `filelist/download.ts`, `services/qbittorrent.ts`, `services/plex-browse.ts`. |
| `plex-refresh.ts` | SINGURUL loc care ar trebui să declanșeze un rescan de bibliotecă Plex, după orice modificare pe disk. | `filelist/download.ts`, `filelist/log.ts`, `services/qbittorrent.ts`. |
| `wizard-check.functions.ts` | `checkTitleForWizard` — verificarea completă a unui titlu într-o SINGURĂ cerere (TMDB + Plex + Filelist + `media` + TVmaze, agregate pe server). Înainte, ecranul de verificare făcea zece dus-întors de pe telefon, în trei valuri; munca în sine durează ~1s, costul erau rundele × latența mobilă. Stă la rădăcină fiindcă e transversal prin construcție. | `wizard/use-wizard-data.ts`. |
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
| `poster.ts` | Dimensiunea posterelor TMDB ca operație pe URL (`resizePosterUrl`, `STORED_POSTER_SIZE = w342`) — TMDB servește aceeași imagine la orice mărime, schimbând un segment din adresă. Aplicat ORIUNDE se scrie în `media.poster_path`, ca lista de căutare (care cere `w92` pentru miniaturi de 40px) să nu decidă ce vezi peste luni în drawer-ul din Bibliotecă. Fără dependențe — se importă și din client, și din server. | Wizard, `media.ts`, notificări. |
| `poster.test.ts` | Teste vitest pentru rescrierea de URL. | — |

### src/lib/media/

| Fișier | Ce conține | Folosit de |
|---|---|---|
| `media.ts` | Sursă unică pentru tabela `media` (filme/seriale/episoade reale — descărcate sau backfill din Plex). `upsertMediaEntry`, `upsertMediaEntryFromPlex` (întoarce `{ id, created }`), `ensureMediaPlaceholder` (rând-părinte serial), `markMediaCompleted` (gardă atomică de finalizare, pe hash), `listUnfinishedTorrents` (descărcările de reluat după restart), `cleanupOrphanSeasonPackPlaceholders` (șterge placeholder-ele de pachet de sezon rămase orfane, apelată periodic). | `filelist/download.ts`, `filelist/log.ts`, `services/plex-browse.ts`, `media/plex-link-reconciler.ts`. |
| `media.functions.ts` | Server functions peste `media.ts` (`searchLibraryTitles`, `getDownloadingMediaForTmdbId`) — fișierul subțire pe care îl importă clientul. | `AddMediaWizard.tsx`, `DownloadConfirmDialog.tsx`. |
| `plex-link-reconciler.ts` | Reîncearcă legarea la Plex pentru titluri complete fără `plex_rating_key` (ultimele 72h). Plasa de siguranță pentru restarturile din fereastra de legare. | `server/plugins/plex-link-reconciler.ts`. |
| `torrent-name-parse.ts` | Extrage sezon/episod dintr-un nume de lansare (`parseSeasonEpisodeFromName`). | `tmdb/tmdb-title-lookup.ts`, `filelist/log.ts`, `components/filelist/use-download.ts`. |
| `show-watch.ts` | Urmărirea serialelor — descărcarea automată a episoadelor noi. Declarativă, nu diferențială: TMDB spune ce s-a difuzat, `media WHERE parent_id = ?` spune ce avem, diferența e ce se descarcă. Idempotentă, deci se auto-repară după restart și nu poate descărca de două ori. Urmărirea sunt patru coloane pe rândul `tv_show` din `media` (`auto_download`, `auto_download_quality`, `auto_download_from`, `watch_last_checked_at`), nu o tabelă paralelă — vezi comentariul din fișier pentru ce a mers prost la prima încercare (`pinned_*`, eliminată în v14). Tot aici: `fillMissingEpisodeTitles`, `refreshShowMetadata` (next_episode + airstamp TVmaze). | `server/plugins/show-watcher.ts`, `media.functions.ts`. |
| `movie-watch.ts` | Urmărirea filmelor — același principiu, modul separat și mult mai mic (un film e o singură întrebare, „a apărut?"). Două diferențe intenționate: urmărirea unui film se stinge singură la prima descărcare reușită, iar un film urmărit nu e un film deținut — rândul lui din `media` n-are `torrent_hash` și n-are `plex_rating_key`, ceea ce îl face automat invizibil în Bibliotecă, în reconcilierea Plex și în reluarea descărcărilor, fără nicio modificare acolo. Cadență 12h, nu 3h. | `server/plugins/show-watcher.ts`, `media.functions.ts`. |
| `unfinished-torrents.test.ts` | Teste vitest pentru interogarea pe care se sprijină reluarea descărcărilor după restart. | — |
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
| `db-backup.ts` | Backup-ul bazei — `runDbBackup` (VACUUM INTO + rotație la 14), `getBackupStatus`, `listBackups`. Server-only. | `db-backup.functions.ts`, `server/plugins/db-backup.ts`. |
| `db-backup.functions.ts` | `getDbBackupStatus` / `runDbBackupNow` (admin). | `queries.ts`, `tehnic/sections/DbBackupCard.tsx`. |
| `network-link.functions.ts` | `getNetworkLink` / `renegotiateNetworkLink`. | `queries.ts`, `tehnic/sections/NetworkLinkCard.tsx`. |
| `speedtest.ts` | Implementarea speedtest-ului, server-only (`node:child_process`, `node:crypto`, DB). Rularea e DECUPLATĂ de cererea HTTP care o pornește — starea trăiește în modul, nu în request, ca minimizarea aplicației pe telefon să nu anuleze testul. | `speedtest.functions.ts`. |
| `speedtest.functions.ts` | Server functions subțiri peste `speedtest.ts` (pornire, stare, istoric). | `queries.ts`, `tehnic/sections/SpeedtestChart.tsx`. |
| `versions.functions.ts` | Verificare versiuni pachete/Ubuntu disponibile pentru actualizare. | `routes/sistem.tsx`. |
| `update-signal.ts` | Semnal simplu pentru "există update disponibil" (citit de UI). | `routes/sistem.tsx`. |

### src/lib/filelist/

| Fișier | Ce conține | Folosit de |
|---|---|---|
| `types.ts` | Interfețe comune (`FilelistTorrent`, `FilelistCategory` etc). | Restul modulului + componente client. |
| `categories.ts` | Maparea completă a celor 31 de categorii Filelist.io (verificată direct pe API). | `download.ts`, `components/filelist/FilelistSection.tsx`. |
| `filelist-client.ts` | SINGURUL loc care vorbește direct cu `api.php`/`download.php` de pe Filelist (căutare + descărcarea fișierului `.torrent`). Restul — upload qBittorrent, scriere în `media`, notificări, polling — rămâne în `download.ts`. | `download.ts`. |
| `download.functions.ts` | Server functions peste `download.ts` (`downloadFilelist`, `correctSubtitleForMedia`, `deleteSubtitleForMedia`) — fișierul subțire reexportat de barrel-ul `filelist.functions.ts`. | `filelist.functions.ts` → componente client. |
| `download.ts` | Orchestrarea unei descărcări — cererile brute către Filelist stau în `filelist-client.ts` (`checkFilelistForItemInternal`, căutare strict pe IMDb id, cache 10 min măturat pe timer); aici: descărcare + upload qBittorrent (`downloadFilelistCore` — răspunde imediat după upload, restul — hash, jurnal, `media`, polling — rulează în fundal prin `finishFilelistDownload`), polling până la completare. | `filelist/download.functions.ts`, `server/plugins/filelist-resume.ts`. |
| `log.ts` | `deleteMediaEntry` — șterge un titlu complet: torrent + fișiere din qBittorrent, reziduul de pe disk, rândurile din `media`. (Jurnalul separat de descărcări, tabela `downloads`, a fost eliminat în v25 — `media` e singura sursă.) | `filelist.functions.ts`, `BibliotecaList.tsx`. |
| `subtitles.ts` | Cel mai mare fișier din proiect — `ensureRomanianSubtitle`: verifică/corectează subtitrarea RO la finalul unei descărcări (embedded → tracked .srt → OpenSubtitles → subs.ro), inclusiv pachete de sezon episod cu episod. | `download.ts` (`pollUntilComplete`), backfill. |
| `subtitle-pipeline.ts` | Pipeline-ul unificat per fișier media, care leagă pașii 1→4. Apelat o dată pentru un film și în buclă, per episod, pentru un pachet de sezon. Există fiindcă înainte aceeași secvență de decizii era scrisă de două ori în `subtitles.ts`, iar asta a permis un bug real: verificarea de limbă a unui `.srt` bundle-uit exista doar pe fluxul de film. | `subtitles.ts`. |
| `subtitle-checks.ts` | Pas 1 — verificări de existență/conținut (subtitrare sau audio RO încorporate via `ffprobe`, `.srt` bundle-uit care pare românesc, sidecar deja pe disc). Doar citiri. | `subtitle-pipeline.ts`. |
| `subtitle-sources.ts` | Pas 2 — alegerea celei mai bune subtitrări dintre candidații deja obținuți de la cele două surse externe, cu scoring-ul din `release-scoring.ts`. | `subtitle-pipeline.ts`. |
| `subtitle-encoding.ts` | Pas 3 — detectare/conversie la UTF-8 (Plex citește `.srt`-urile externe ca UTF-8, fără detecție), citire/scriere cu reîncercări, verificare suprapunere de piese torrent. | `subtitle-pipeline.ts`, `subtitle-apply.ts`. |
| `subtitle-apply.ts` | Pas 4 — aplicarea deciziei: redenumire prin API-ul qBittorrent (nu pe disc direct, altfel qBittorrent pierde evidența fișierului), scrierea subtitrării descărcate. Singurul pas care modifică ceva. | `subtitle-pipeline.ts`. |
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
| `recent-watch-cache.ts` | Scrierea în `recent_watch_cache`, sursa unică a widgetului „Vizionări recente". Are doi scriitori posibili pentru același rând — `plex-browse.ts` (vizionare completă din istoricul Plex) și `activity-log.ts` (progres parțial, la oprirea sesiunii) — iar logica de conflict stă aici, o singură dată: o vizionare completă câștigă mereu, indiferent de ordinea scrierilor. | `plex-browse.ts`, `activity-log.ts`. |
| `recent-watch-merge.ts` | Unirea episoadelor consecutive din „Vizionări recente", ca funcție pură. Separată de `plex-browse.ts` ca să fie testabilă fără DB/Plex. | `plex-browse.ts`. |
| `recent-watch-types.ts` | Doar tipul `RecentWatch` — fișier curat, ca funcția pură și testele ei să nu tragă după ele `plex-browse.ts`. | `recent-watch-merge.ts`, `plex-browse.ts`. |
| `recent-watch-merge.test.ts` | Teste vitest pentru unire. | — |

### src/lib/tvmaze/

| Fișier | Ce conține | Folosit de |
|---|---|---|
| `tvmaze.functions.ts` | Supliment la TMDB pentru ORA exactă de difuzare a unui episod — TMDB dă doar data. API public, fără cheie; dacă TVmaze nu cunoaște serialul sau e indisponibil, întoarce listă goală și UI-ul cade elegant pe data-only. | `wizard-check.functions.ts`, `media/show-watch.ts`. |

---

## src/components/ — UI

### src/components/biblioteca/

| Fișier | Ce conține |
|---|---|
| `BibliotecaList.tsx` | Lista principală — căutare, grupare episoade consecutive pe serial, încărcare incrementală, confirmare de ștergere. |
| `TitleDetailDrawer.tsx` | Drawer de detalii per titlu — status, subtitrare, cine a văzut, corectare/ștergere subtitrare, ștergere completă. |
| `StatusBadge.tsx` | Badge mic "Se descarcă" (status calculat din rândul `media`). |
| `WantedMoviesSection.tsx` | Filmele așteptate — urmărire pornită, dar încă negăsite pe Filelist la calitatea cerută. Secțiune separată, deasupra listei, nu rânduri amestecate printre titluri: un film așteptat nu e ceva ce ai. |
| `WantedMovieDrawer.tsx` | Drawer per film așteptat — calitatea cerută, ultima verificare, oprirea urmăririi. |
| `utils.ts` | Helpere pure — grupare episoade, formatare dată, `matchesQuery` (căutare fără diacritice). |

### src/components/principala/

Wizard-ul de adăugare titlu — deschis din Acasă, sau prefill dintr-un titlu
deja identificat (prop `initialItem`, ex. din `SceneViewer.tsx`).

Refactorizat complet în sept. 2026: `AddMediaWizard.tsx` a scăzut de la 1268
la 265 de linii și a rămas doar shell — starea e într-un reducer, derivările
sunt funcții pure testate, iar fiecare pas e componenta lui. Cele 22 de
`useState` dinainte impuneau un `reset()` care enumera manual 19 setteri și un
`goBack()` cu alt subset: o stare uitată într-una din liste era un bug tăcut
(vezi 1e1b3fe și 3249390).

| Fișier | Ce conține |
|---|---|
| `AddMediaWizard.tsx` | Shell-ul — montează reducer-ul, hook-urile de date/descărcare și randează pasul curent. Fără logică proprie de derivare. |
| `wizard/types.ts` | Tipurile comune ale wizard-ului (`Quality`, `Step`, `CheckResult`) — folosite deopotrivă de componentă, de funcțiile pure și de pași. |
| `wizard/state.ts` | Starea într-un `useReducer`, cu pașii ca uniune discriminată: stări care logic nu pot coexista (o țintă de confirmare simplă și una în lot deodată) nu mai pot coexista nici în tip. |
| `wizard/state.test.ts` | Teste vitest pe tranzițiile reducer-ului. |
| `wizard/selection.ts` | Funcții pure de selecție/clasificare (`pickFromSet`, `qualityRank`, `qualityDirection` — upgrade/downgrade față de ce e deja în Plex). Fără React, fără rețea. |
| `wizard/selection.test.ts` | Teste vitest pentru ele. |
| `wizard/derive-seasons.ts` | Transformarea datelor brute (TMDB + Plex + Filelist + TVmaze) în rândurile acordeonului de sezoane, plus planul de descărcare în lot. Pure — înainte stăteau în corpul componentei, unde nu puteau fi verificate decât randând tot wizard-ul, deși aici se decide exact ce ți se oferă per episod. |
| `wizard/derive-seasons.test.ts` | Teste vitest pentru derivare. |
| `wizard/use-wizard-data.ts` | Încărcarea datelor: căutarea TMDB (cu debounce) + `checkTitleForWizard`, o singură cerere. Nu ține stare proprie — scrie în reducer. |
| `wizard/use-wizard-download.ts` | Acțiunile de descărcare: un torrent, un lot, și pornirea urmăririi unui film încă inexistent la calitatea cerută. |
| `wizard/SearchStep.tsx` | Pasul de căutare (input + listă rezultate TMDB). |
| `wizard/ResultStep.tsx` | Ecranul de rezultat — cel mai mare pas, și singurul cu derivări proprii (ținute aici, fiindcă niciun alt pas nu le folosește). |
| `wizard/SeasonAccordion.tsx` | Listă sezoane/episoade cu status (`EpisodeAvailability`) — în Plex / se descarcă / disponibil / indisponibil / nelansat. |
| `wizard/PickStep.tsx` | Alegerea manuală a torrentului — doar pentru admin, doar când există mai mulți candidați la aceeași calitate. |
| `wizard/ConfirmStep.tsx` | Confirmarea descărcării unui singur torrent. |
| `wizard/ConfirmBulkStep.tsx` | Confirmarea descărcării în lot. Pas propriu, nu card inline, ca să folosească același model mental ca cea pentru un singur torrent. |
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
| `SubtitleFixDrawer.tsx` | Drawer rezultat corectare subtitrare. |
| `plugins.tsx` | Catalogul plugin-urilor de fundal — sursă unică pentru lista din Tehnic și pentru drawer-ul de detalii. Un rând per FIȘIER din `server/plugins/`, nu per funcționalitate: o intrare separată pentru un pas dintr-un tic (completarea numelor de episoade, de ex.) ar putea arăta „activ" deși plugin-ul e mort. |
| `PluginDetailDrawer.tsx` | Drawer per plugin — cadență, ultima rulare, de ce există (aproape toate au apărut ca reacție la un bug concret). |
| `UserDetailDrawer.tsx` | Drawer detalii cont — contact, Plex, descărcări, istoric autentificări. |
| `Metric.tsx`, `StatCell.tsx` | Piese mici de afișare valoare+etichetă. |
| `utils.ts` | Formatare dată/oră completă RO, `relativeTime`. |
| `sections/ActivityLogSection.tsx` | Timeline activitate + commit-uri, cu filtre pe categorie. |
| `sections/CommitStatsSection.tsx` | Statistici commit-uri, listă commit-uri locale nepublicate, buton push manual. |
| `sections/ErrorLogSection.tsx` | Listă erori capturate automat. |
| `sections/PlexServiceCard.tsx` | Control serviciu Plex (restart/actualizare). |
| `sections/PluginStatusSection.tsx` | Status plugin-uri de fundal active (ultima rulare), clicabile → `PluginDetailDrawer`. |
| `sections/PushSubscriptionsSection.tsx` | Abonamentele push înregistrate — dispozitiv identificat, dată, ștergere. |
| `sections/SpeedtestChart.tsx` | Grafic istoric speedtest. |
| `sections/DbBackupCard.tsx` | Starea backup-urilor bazei (vechimea ultimei copii, număr, spațiu) + buton de backup manual. Verde/chihlimbariu după 36h de la ultima copie. |
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
| `orb.tsx` | `thinking-orbs` | Wrapper care decide mărimea într-un singur loc (pornim mereu de la presetul 20 și ajustăm doar cutia CSS — presetul 64 micșorat arată ca o pată). **Convenție:** orb-ul marchează o așteptare fără capăt cunoscut (urmărire activă, procesare în Plex, descărcare fără procent); pentru confirmarea unui clic rămâne `Loader2`. |

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
| `use-flash-on-change.ts` | Micro-flash pe o valoare tocmai schimbată (`true` scurt după fiecare schimbare a cheii, pentru clasa `tick-flash`). Nu se declanșează la prima randare — altfel totul ar clipi la deschiderea ecranului, iar clipitul ar înceta să însemne „asta tocmai s-a schimbat". |
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

Regenerată programatic pe 2026-09-17 (script peste tot `src/` + `server/`:
linii, funcții numite, fan-in rezolvat prin importurile `@/` și relative,
inclusiv `import()` dinamic). Tabelul e integral generat — nu are rânduri
actualizate manual, deci nu poate fi parțial vechi.

**Total: 181 fișiere, ~29 496 linii, ~660 funcții**

(numărătoare aproximativă — funcții numite, `const x = (...) =>` și
`createServerFn`, fără metode de clasă sau funcții anonime inline)

### Pe zonă

| Zonă | Fișiere | Linii |
|---|---:|---:|
| `src/routes/` (pagini) | 11 | 2 899 |
| `src/lib/` (rădăcină, transversale) | 13 | 2 880 |
| `src/lib/auth/` | 8 | 780 |
| `src/lib/tmdb/` | 6 | 1 071 |
| `src/lib/media/` | 8 | 2 561 |
| `src/lib/notifications/` | 3 | 418 |
| `src/lib/errors/` | 6 | 473 |
| `src/lib/system/` | 9 | 1 075 |
| `src/lib/filelist/` | 16 | 3 273 |
| `src/lib/services/` | 12 | 3 523 |
| `src/lib/tvmaze/` | 1 | 56 |
| `src/components/` (toate) | 69 | 9 238 |
| `src/hooks/` | 4 | 289 |
| `server/plugins/` | 8 | 408 |
| `server/routes/api/` | 3 | 181 |
| altele | 4 | 371 |

### Fișiere-hub (fan-in mare)

| Fișier | Importat de |
|---|---:|
| `lib/auth/admin.server.ts` | 27 |
| `lib/db.ts` | 21 |
| `lib/queries.ts` | 20 |
| `lib/filelist.functions.ts` | 19 |
| `lib/tmdb/tmdb.functions.ts` | 14 |
| `lib/activity-log.ts` | 13 |
| `components/tehnic/utils.ts` | 12 |
| `lib/services/shared.ts` | 10 |
| `components/ui/drawer.tsx` | 10 |
| `components/PageShell.tsx` | 10 |
| `lib/media/media.functions.ts` | 9 |
| `lib/format.ts` | 9 |

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
lib/{auth,tmdb,media,notifications,errors,system,filelist,services,tvmaze}/*
     (logică de domeniu + acces SQLite/API-uri externe)
```

Săgeata a treia e regula care ține codul server în afara bundle-ului public:
un fișier `*.functions.ts` nu are voie să importe STATIC module server-only.
Vezi secțiunea despre convenția `*.functions.ts` de mai sus.

`server/plugins/*` și `server/routes/api/*` au fan-in 0 din restul grafului
— nu sunt moarte, sunt încărcate de Nitro prin convenție de folder, nu prin
import explicit (vezi secțiunea `server/`).

### Tabel complet, toate cele 181 de fișiere

| Fișier | Linii | Funcții | Fan-in |
|---|---:|---:|---:|
| `src/lib/services/plex-browse.ts` | 915 | 11 | 5 |
| `src/components/biblioteca/TitleDetailDrawer.tsx` | 850 | 8 | 1 |
| `src/lib/db.ts` | 818 | 4 | 21 |
| `src/lib/media/media.ts` | 776 | 15 | 7 |
| `src/lib/filelist/download.ts` | 756 | 11 | 4 |
| `src/lib/media/show-watch.ts` | 695 | 13 | 2 |
| `src/lib/activity-log.ts` | 674 | 18 | 13 |
| `src/lib/services/plex.ts` | 633 | 17 | 4 |
| `src/routes/index.tsx` | 555 | 9 | 1 |
| `src/lib/media/movie-watch.ts` | 530 | 11 | 3 |
| `src/routes/qbit.tsx` | 497 | 3 | 1 |
| `src/lib/filelist/subtitles.ts` | 495 | 8 | 2 |
| `src/lib/github.functions.ts` | 485 | 13 | 4 |
| `src/lib/tmdb/tmdb.functions.ts` | 480 | 13 | 14 |
| `src/components/principala/wizard/ResultStep.tsx` | 414 | 4 | 1 |
| `src/lib/services/plex-library.ts` | 378 | 15 | 3 |
| `src/routes/sistem.tsx` | 364 | 3 | 1 |
| `src/routes/users.tsx` | 351 | 7 | 1 |
| `src/lib/services/plex-shared.ts` | 341 | 9 | 2 |
| `src/lib/system/speedtest.ts` | 328 | 9 | 1 |
| `src/components/biblioteca/BibliotecaList.tsx` | 302 | 3 | 1 |
| `src/components/principala/wizard/SeasonAccordion.tsx` | 301 | 7 | 2 |
| `src/lib/tmdb/tmdb-title-lookup.ts` | 301 | 7 | 4 |
| `src/lib/services/qbittorrent.ts` | 296 | 4 | 1 |
| `src/lib/media/media.functions.ts` | 292 | 12 | 9 |
| `src/components/filelist/FilelistSection.tsx` | 288 | 1 | 1 |
| `src/lib/services/host.ts` | 282 | 4 | 1 |
| `src/components/tehnic/PluginDetailDrawer.tsx` | 272 | 3 | 1 |
| `src/lib/filelist/filelist-client.ts` | 272 | 10 | 5 |
| `src/components/tehnic/UserDetailDrawer.tsx` | 270 | 2 | 1 |
| `src/routes/tehnic.tsx` | 268 | 1 | 1 |
| `src/components/principala/AddMediaWizard.tsx` | 266 | 4 | 3 |
| `src/routes/__root.tsx` | 266 | 9 | 1 |
| `src/lib/queries.ts` | 265 | 1 | 20 |
| `src/routeTree.gen.ts` | 263 | 0 | 1 |
| `src/lib/auth/users.functions.ts` | 257 | 5 | 2 |
| `src/components/filelist/DownloadConfirmDialog.tsx` | 249 | 3 | 2 |
| `src/components/principala/wizard/state.ts` | 245 | 1 | 6 |
| `src/components/principala/wizard/derive-seasons.test.ts` | 241 | 5 | 0 |
| `src/components/principala/wizard/WizardControls.tsx` | 236 | 5 | 2 |
| `src/components/tehnic/sections/ActivityLogSection.tsx` | 234 | 1 | 1 |
| `src/lib/services/immich.ts` | 231 | 4 | 1 |
| `src/lib/notifications/notifications.ts` | 226 | 10 | 5 |
| `src/components/tehnic/sections/ErrorLogSection.tsx` | 225 | 2 | 1 |
| `src/lib/errors/error-log.ts` | 225 | 9 | 4 |
| `src/components/principala/wizard/use-wizard-download.ts` | 222 | 6 | 1 |
| `src/routes/immich.tsx` | 219 | 1 | 1 |
| `src/components/biblioteca/WantedMovieDrawer.tsx` | 214 | 5 | 1 |
| `src/lib/filelist/subsro-client.ts` | 212 | 10 | 1 |
| `src/components/tehnic/sections/PushSubscriptionsSection.tsx` | 210 | 3 | 1 |
| `src/components/descopera/FeedView.tsx` | 195 | 3 | 1 |
| `src/lib/system/agent.functions.ts` | 195 | 4 | 5 |
| `src/lib/filelist/release-scoring.ts` | 194 | 4 | 2 |
| `src/lib/filelist/opensubtitles-client.ts` | 192 | 6 | 3 |
| `src/lib/filelist/subtitle-apply.ts` | 188 | 4 | 1 |
| `src/lib/tmdb/tmdb.discover.functions.ts` | 188 | 7 | 5 |
| `src/components/principala/wizard/state.test.ts` | 182 | 2 | 0 |
| `src/routes/register.tsx` | 181 | 1 | 1 |
| `src/hooks/use-push-notifications.ts` | 174 | 5 | 1 |
| `src/components/principala/wizard/derive-seasons.ts` | 171 | 2 | 2 |
| `src/lib/filelist/subtitle-pipeline.ts` | 171 | 1 | 1 |
| `src/lib/system/network-link.ts` | 165 | 6 | 1 |
| `src/lib/filelist/log.ts` | 162 | 2 | 1 |
| `src/lib/media/unfinished-torrents.test.ts` | 161 | 1 | 0 |
| `src/components/descopera/DiscoverGrid.tsx` | 160 | 4 | 1 |
| `src/lib/plex-refresh.ts` | 156 | 10 | 3 |
| `src/components/AppHeader.tsx` | 149 | 3 | 1 |
| `src/lib/qbit-client.ts` | 147 | 9 | 8 |
| `src/lib/auth/admin.functions.ts` | 146 | 6 | 5 |
| `src/components/tehnic/CommitDrawer.tsx` | 145 | 4 | 2 |
| `src/lib/wizard-check.functions.ts` | 143 | 2 | 1 |
| `src/components/descopera/SceneViewer.tsx` | 142 | 1 | 1 |
| `src/lib/services/recent-watch-merge.test.ts` | 142 | 3 | 0 |
| `src/components/tehnic/SubtitleFixDrawer.tsx` | 140 | 2 | 1 |
| `src/lib/filelist/subtitle-checks.ts` | 140 | 10 | 2 |
| `src/components/principala/wizard/selection.test.ts` | 139 | 1 | 0 |
| `src/components/tehnic/sections/NetworkLinkCard.tsx` | 139 | 2 | 1 |
| `src/components/tehnic/sections/CommitStatsSection.tsx` | 131 | 1 | 1 |
| `src/lib/services/shared.ts` | 127 | 6 | 10 |
| `src/lib/system/db-backup.ts` | 127 | 8 | 2 |
| `src/components/ServiceHeaderActions.tsx` | 125 | 2 | 4 |
| `src/components/tehnic/plugins.tsx` | 119 | 0 | 2 |
| `src/lib/system/versions.functions.ts` | 119 | 7 | 2 |
| `src/lib/filelist/subtitle-encoding.ts` | 118 | 6 | 2 |
| `src/components/biblioteca/utils.ts` | 117 | 11 | 3 |
| `src/routes/login.tsx` | 116 | 1 | 1 |
| `src/lib/notifications/push.functions.ts` | 115 | 7 | 2 |
| `src/components/principala/wizard/selection.ts` | 114 | 7 | 4 |
| `src/components/ui/alert-dialog.tsx` | 111 | 2 | 0 |
| `src/components/filelist/use-download.ts` | 107 | 3 | 2 |
| `src/components/principala/wizard/use-wizard-data.ts` | 104 | 3 | 1 |
| `src/components/tehnic/sections/PluginStatusSection.tsx` | 102 | 6 | 1 |
| `src/components/principala/wizard/ConfirmBulkStep.tsx` | 100 | 1 | 1 |
| `src/components/biblioteca/WantedMoviesSection.tsx` | 94 | 2 | 1 |
| `src/components/tehnic/sections/DbBackupCard.tsx` | 91 | 1 | 1 |
| `src/lib/filelist/subtitle-sources.ts` | 89 | 1 | 2 |
| `server/plugins/show-watcher.ts` | 88 | 2 | 0 |
| `src/lib/filelist/categories.ts` | 84 | 2 | 5 |
| `src/lib/errors/console-capture.ts` | 83 | 5 | 4 |
| `src/lib/services/recent-watch-merge.ts` | 83 | 3 | 2 |
| `src/components/ui/drawer.tsx` | 82 | 2 | 10 |
| `src/lib/auth/plex-users.server.ts` | 82 | 5 | 1 |
| `src/lib/refresh-rate.ts` | 81 | 5 | 2 |
| `server/plugins/github-commit-tracker.ts` | 80 | 1 | 0 |
| `src/components/tehnic/sections/SpeedtestChart.tsx` | 80 | 3 | 1 |
| `src/lib/auth/registration.functions.ts` | 80 | 2 | 1 |
| `src/components/BottomNav.tsx` | 77 | 1 | 1 |
| `src/lib/auth/rate-limit.ts` | 77 | 4 | 2 |
| `src/lib/notifications/push.ts` | 77 | 2 | 2 |
| `src/components/principala/wizard/SearchStep.tsx` | 76 | 1 | 1 |
| `src/lib/services/recent-watch-cache.ts` | 76 | 2 | 2 |
| `src/lib/filelist/subtitle-outcomes.ts` | 74 | 0 | 5 |
| `src/lib/media/plex-link-reconciler.ts` | 74 | 1 | 1 |
| `src/components/ui/dialog.tsx` | 70 | 1 | 1 |
| `src/lib/filelist/download.functions.ts` | 70 | 4 | 1 |
| `server/routes/api/github-webhook.ts` | 69 | 0 | 0 |
| `server/routes/api/plex-thumb.ts` | 69 | 0 | 0 |
| `server/plugins/plex-session-tracker.ts` | 68 | 1 | 0 |
| `src/lib/auth/admin.server.ts` | 68 | 5 | 27 |
| `src/server.ts` | 65 | 2 | 0 |
| `src/components/descopera/FilterTabs.tsx` | 64 | 2 | 1 |
| `src/components/filelist/quality-utils.ts` | 63 | 3 | 4 |
| `src/lib/errors/client-error-capture.ts` | 63 | 3 | 1 |
| `src/routes/descopera.tsx` | 62 | 1 | 1 |
| `src/components/principala/useLiveViewOffsets.ts` | 60 | 1 | 1 |
| `src/lib/system/speedtest.functions.ts` | 57 | 5 | 3 |
| `src/components/principala/wizard/PickStep.tsx` | 56 | 1 | 1 |
| `src/components/sistem/RefreshRateCard.tsx` | 56 | 1 | 1 |
| `src/lib/filelist/types.ts` | 56 | 0 | 4 |
| `src/lib/format.ts` | 56 | 6 | 9 |
| `src/lib/tvmaze/tvmaze.functions.ts` | 56 | 3 | 4 |
| `src/components/tehnic/sections/PlexServiceCard.tsx` | 55 | 1 | 1 |
| `src/components/Meter.tsx` | 54 | 1 | 2 |
| `src/hooks/use-auto-reload.ts` | 53 | 2 | 1 |
| `src/lib/tmdb/poster.test.ts` | 50 | 0 | 0 |
| `server/plugins/db-backup.ts` | 47 | 1 | 0 |
| `src/components/principala/wizard/types.ts` | 47 | 0 | 9 |
| `src/lib/auth/admin-route-guard.ts` | 46 | 3 | 7 |
| `server/routes/api/deploy-sha.ts` | 43 | 2 | 0 |
| `src/lib/errors/error-log.functions.ts` | 43 | 4 | 4 |
| `src/lib/system/network-link.functions.ts` | 43 | 3 | 2 |
| `src/components/useServiceRecovery.ts` | 39 | 2 | 3 |
| `server/plugins/plex-link-reconciler.ts` | 37 | 1 | 0 |
| `src/components/ServicePill.tsx` | 37 | 1 | 3 |
| `src/components/PageShell.tsx` | 36 | 1 | 10 |
| `src/components/StatCard.tsx` | 35 | 1 | 3 |
| `src/components/principala/wizard/ConfirmStep.tsx` | 34 | 1 | 1 |
| `src/components/principala/wizard/DoneStep.tsx` | 34 | 1 | 1 |
| `src/lib/tmdb/poster.ts` | 34 | 2 | 5 |
| `src/components/biblioteca/StatusBadge.tsx` | 33 | 1 | 2 |
| `src/components/tehnic/TehnicSubNav.tsx` | 33 | 1 | 5 |
| `src/hooks/use-live-counter.ts` | 33 | 1 | 1 |
| `src/components/ui/button.tsx` | 31 | 0 | 1 |
| `src/lib/errors/error-page.ts` | 31 | 1 | 2 |
| `server/plugins/activity-boot.ts` | 30 | 0 | 0 |
| `server/plugins/fast-shutdown.ts` | 29 | 1 | 0 |
| `server/plugins/filelist-resume.ts` | 29 | 0 | 0 |
| `src/hooks/use-flash-on-change.ts` | 29 | 1 | 2 |
| `src/components/tehnic/utils.ts` | 28 | 2 | 12 |
| `src/lib/errors/error-capture.ts` | 28 | 2 | 1 |
| `src/lib/system/db-backup.functions.ts` | 27 | 3 | 2 |
| `src/components/ui/progress.tsx` | 26 | 0 | 2 |
| `src/lib/activity-log.functions.ts` | 26 | 2 | 3 |
| `src/start.ts` | 26 | 0 | 1 |
| `src/components/ui/orb.tsx` | 25 | 1 | 9 |
| `src/components/ui/sonner.tsx` | 25 | 1 | 1 |
| `src/lib/auth/password.ts` | 24 | 2 | 3 |
| `src/routes/biblioteca.tsx` | 20 | 1 | 1 |
| `src/lib/services/recent-watch-types.ts` | 19 | 0 | 3 |
| `src/components/tehnic/Metric.tsx` | 18 | 1 | 1 |
| `src/components/tehnic/StatCell.tsx` | 18 | 1 | 1 |
| `src/lib/tmdb/tmdb-client.ts` | 18 | 2 | 3 |
| `src/lib/media/torrent-name-parse.ts` | 17 | 1 | 4 |
| `src/router.tsx` | 17 | 1 | 1 |
| `src/components/filelist/types.ts` | 16 | 0 | 3 |
| `src/lib/media/torrent-quality.ts` | 16 | 1 | 3 |
| `src/components/ErrorCard.tsx` | 14 | 1 | 3 |
| `src/lib/system/update-signal.ts` | 14 | 2 | 3 |
| `src/lib/filelist.functions.ts` | 13 | 0 | 19 |
| `src/lib/services.functions.ts` | 9 | 0 | 4 |
| `src/lib/utils.ts` | 7 | 1 | 4 |

---

## Note pentru actualizare

- Când muți/redenumești un fișier: actualizează rândul lui aici în același commit.
- Când ștergi un fișier confirmat mort (vezi sesiunile de curățenie cu `knip`/`tsc --noUnusedLocals`): șterge și rândul din tabel.
- Nu e nevoie de acoperire 100% perfectă de la început — completează pe măsură ce lucrezi într-o zonă a codului.
- Fișierele `*.test.ts` (vitest, `npm run test`) stau lângă modulul testat, nu
  într-un folder separat — sunt acolo unde se uită cineva care schimbă logica.
