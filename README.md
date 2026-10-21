# FaikkitBox

**Dashboard personal de monitorizare și control pentru serverul de acasă.**

Un singur ecran pentru Plex, Immich, qBittorrent, sistemul de operare și descoperirea/adăugarea de filme și seriale — cu descărcare de pe Filelist, subtitrare română automată, urmărirea serialelor, notificări push, jurnal de activitate și captare automată a erorilor.

Construit cu [TanStack Start](https://tanstack.com/start) (React 19 + TanStack Router/Query), rulează ca server Node prin Nitro, pe Ubuntu, în spatele unui Cloudflare Tunnel.

---

## Cuprins

- [Pagini](#pagini)
- [Conturi și acces](#conturi-și-acces)
- [Adăugarea unui titlu](#adăugarea-unui-titlu)
- [Calități și versiuni multiple](#calități-și-versiuni-multiple)
- [Subtitrare română automată](#subtitrare-română-automată)
- [Urmărire automată](#urmărire-automată)
- [Viața unei descărcări](#viața-unei-descărcări)
- [Notificări și jurnal](#notificări-și-jurnal)
- [Întreținere: backup, actualizări, retenție](#întreținere-backup-actualizări-retenție)
- [Erori aplicație](#erori-aplicație)
- [Securitate](#securitate)
- [Performanță și date live](#performanță-și-date-live)
- [Stack tehnic](#stack-tehnic)
- [Structură proiect](#structură-proiect)
- [Configurare](#configurare)
- [Instalare și dezvoltare](#instalare-și-dezvoltare)
- [Deploy](#deploy)
- [Note tehnice pentru dezvoltare](#note-tehnice-pentru-dezvoltare)

---

## Pagini

| Pagină                         | Acces        |
| ------------------------------ | ------------ |
| **Acasă** (`/`)                | Public       |
| **Descoperă** (`/descopera`)   | Cont aprobat |
| **Bibliotecă** (`/biblioteca`) | Cont aprobat |
| **qBittorrent** (`/qbit`)      | Cont aprobat |
| **Immich** (`/immich`)         | Admin        |
| **Sistem** (`/sistem`)         | Admin        |
| **Tehnic** (`/tehnic`)         | Admin        |
| **Utilizatori** (`/users`)     | Admin        |

**Acasă** — singura pagină accesibilă fără cont. Status live Plex: sesiuni în curs (cu poziția de redare care avansează la secundă și modul real de redare — un video copiat cu sunetul convertit apare ca Direct Stream + „Audio TrueHD → E-AC3”, nu ca transcodare), biblioteci, top vizionate, recent adăugate. Butonul **„Adaugă film/serial”** deschide wizard-ul de adăugare (cont aprobat); adminul are și căutarea manuală pe Filelist. Vizitatorii neautentificați văd butoanele **Înregistrare**/**Autentificare**.

**Descoperă** — explorare în grilă sau feed video, cu sursele Trending / Populare / Noi și, doar pentru admin, **Top Filelist** (cele mai seedate torrente, pe 24h/48h/72h/7 zile, grupate pe titlu). Nota afișată e cea **IMDb** (notă + voturi), din datasetul oficial zilnic — nu cea TMDB, care diferă vizibil. Orice titlu deschide wizard-ul direct pe el.

**Bibliotecă** — tot ce e descărcat prin aplicație sau era deja în Plex (backfill), citit din tabela `media`, fără cereri Plex/TMDB la navigare; toată lista deodată, căutare, grupare pe serial. Deasupra, **filmele așteptate** (urmărite, încă negăsite pe Filelist). Drawer-ul unui titlu arată calitatea, starea subtitrării (raport per fișier, per episod la pachete, și dacă reîncercarea zilnică o mai caută), cine a văzut, link spre pagina torrentului pe Filelist, plus acțiunile: corectare subtitrare, ștergere completă, comutatorul de urmărire la seriale.

**qBittorrent** — viteze, torrente active/total, filtre pe stări (inclusiv stările `stopped*` din qBittorrent 5), căutare, pauză/reluare globală sau individuală, ștergere torrent + fișiere.

**Immich** — număr de fișiere, spațiu ocupat, joburile în curs (cele terminate rămân 30s), Restart/Update, plugin-ul care trece încărcările în jurnal.

**Sistem** — CPU, memorie, swap, uptime, discuri (cu viteze), rețea, senzori de temperatură, top procese și top I/O, aplicații monitorizate, Update Ubuntu (doar când sunt pachete) și repornire (doar când sistemul o cere), reglajul ritmului statisticilor live (1s…30s, per dispozitiv).

**Tehnic** — Restart/Update Plex, speedtest (doar pe serverul Ookla Digi București, cu istoric grafic și starea legăturii Ethernet, cu renegociere), plugin-urile de fundal (clicabile, cu detalii — inclusiv ce caută acum reîncercarea subtitrărilor), backup-ul bazei, abonamentele push, commit-uri, Jurnalul de activitate, **Erori aplicație**, push manual către GitHub.

**Utilizatori** — cereri de aprobare, lista conturilor; drawer-ul unui cont arată contactul, legătura Plex, descărcările inițiate, activitatea Plex, istoricul autentificărilor, și permite **resetarea parolei**.

**Restart și Update pentru servicii** — același mecanism pentru Plex, Immich, qBittorrent și Ubuntu (`src/lib/system/service-jobs.ts`): Restart oricând (la qBittorrent plus cache-ul DNS; la Ubuntu doar când sistemul cere repornire), Update doar când chiar există o versiune nouă (Plex pe canalul beta, Immich, pachete Ubuntu), niciodată la qBittorrent. Cer confirmare, rulează în fundal pe server, nu în cererea HTTP, cu ieșirea live în pagină. Immich și Plex se actualizează cu `docker compose` (v2).

---

## Conturi și acces

Două roluri, o singură tabelă `users`:

| Rol               | Cum se obține                                                      |
| ----------------- | ------------------------------------------------------------------ |
| **Admin**         | Creat de un alt admin, din Utilizatori (`addAdminUser`).           |
| **User obișnuit** | Înregistrare publică (`/register`) + aprobare manuală de un admin. |

Primul admin al unei instalări noi vine din `ADMIN_USER`/`ADMIN_PASS` din `.env`, o singură dată, la prima pornire (migrarea v7); după aceea conturile se gestionează doar din UI.

**Ce nu poate un user obișnuit** — toate verificate pe server, nu doar ascunse în UI:

- paginile Immich, Sistem, Tehnic, Utilizatori; tabul Top Filelist din Descoperă; căutarea manuală Filelist și alegerea manuală a torrentului;
- **altă calitate decât 1080p**, cu excepția titlurilor care nu există deloc la 1080p pe Filelist (wizard-ul îi arată atunci calitățile disponibile). Serverul verifică torrentul după rezultatele căutării făcute de același utilizator în wizard (`download-quality.ts`, ținute 6 h în memorie), nu după numele trimis de browser;
- **ștergerea sau anularea unui titlu în primele 24 h** de la inițierea descărcării (regula hit and run de pe Filelist), socotite pentru tot pachetul de sezon. Drawer-ul arată ora de la care se poate. Altfel, un titlu îl poate șterge cel care l-a adăugat sau adminul (`isAdminOrOwner`).

**Înregistrare** (`registerUser`, `src/lib/auth/registration.functions.ts`) — Username/Parolă/Email/Telefon (WhatsApp). Username-ul **sau** email-ul trebuie să corespundă unui cont din biblioteca Plex (`matchPlexAccount`, `src/lib/auth/plex-users.server.ts` — `plex.tv/api/users`, XML parsat manual, cache 5 min), altfel cererea e respinsă. Contul intră `pending` și nu se poate loga până la aprobare; cererea apare în jurnal (`account_request`) + push.

**Aprobare** — adminul vede cererile cu contactul și legătura Plex găsită și poate Aproba sau Respinge (respingerea șterge rândul; nu există status `rejected`). Orice cont aprobat poate fi revocat (șters).

**Login unificat** (`/login`) — aceeași pagină pentru ambele roluri; respinge conturile `pending`. Fiecare login reușit scrie în `user_logins` (dată, IP, user-agent) și actualizează `users.last_login_at`.

**Resetarea parolei** (din drawer-ul contului) incrementează `users.session_version`, deci toate sesiunile deja emise ale contului sunt delogate; adminul care își schimbă propria parolă rămâne logat pe dispozitivul curent.

**Gărzi** — de rută, în `src/lib/auth/admin-route-guard.ts`, și de server function, în `admin.server.ts`:

```ts
requireAdminBeforeLoad; // rută doar pentru admin
requireAuthBeforeLoad; // rută pentru orice cont aprobat

requireAdmin(); // server fn: aruncă 401 dacă nu e admin
requireAuth(); // server fn: aruncă 401 fără cont aprobat
```

**Important:** garda de rută protejează doar navigarea. Fiecare server function trebuie să aibă _și ea_ `requireAdmin()`/`requireAuth()` ca primă instrucțiune — altfel poate fi apelată direct, ocolind pagina. Dacă e folosită din pagini cu niveluri diferite, alege nivelul cel mai permisiv care rămâne sigur.

**Legătura cu Plex** (`plex_account_id`/`plex_username`/`plex_email`) alimentează activitatea Plex din detaliile contului (`getPlexUserHistory`) și „cine a văzut” din Bibliotecă.

---

## Adăugarea unui titlu

Wizard-ul (`AddMediaWizard.tsx`) — din Acasă sau dintr-un titlu din Descoperă (`SceneViewer.tsx`) — face totul într-un flux: căutare TMDB → verificare Plex + Filelist → alegere calitate/sezon/episod → confirmare și descărcare.

- **Verificarea e o singură cerere** (`checkTitleForWizard`, `src/lib/wizard-check.functions.ts`), care agregă pe server TMDB + Plex + Filelist + `media` + TVmaze. Înainte erau zece dus-întors de pe telefon; costul real era latența mobilă înmulțită, nu munca (~1s).
- **Căutarea TMDB** face două cereri, ro-RO și en-US, și le intercalează (`interleaveSearchResults`, `src/lib/tmdb/search-merge.ts`): „elita” pe en-US nu găsește _Élite_, pe ro-RO îl pune primul.
- **La seriale**, fiecare sezon/episod își arată starea (în Plex / se descarcă / pe Filelist / indisponibil / nelansat), iar descărcarea respectă ce oferă efectiv Filelist — pachet de sezon sau episod individual.
- **Titlu deja în Plex** — ecranul spune dacă alegerea e _upgrade_ sau _downgrade_; o a doua descărcare e un al doilea fișier, nu o înlocuire (vezi [Calități](#calități-și-versiuni-multiple)).
- **Titlu inexistent încă pe Filelist** — filmul poate fi pus pe urmărire (vezi [Urmărire automată](#urmărire-automată)).

Wizard-ul a fost refactorizat în sept. 2026 (1268 → 265 linii): starea e un `useReducer` cu pașii ca uniune discriminată, derivările sunt funcții pure testate, fiecare pas e componenta lui — vezi `src/components/principala/wizard/` în [`STRUCTURE.md`](./STRUCTURE.md).

### Filelist

O singură sursă de adevăr pentru „există pe Filelist?”: `checkFilelistForItemInternal` (`src/lib/filelist/filelist-client.ts`, singurul loc care vorbește cu `api.php`/`download.php`), folosită de wizard, de căutarea manuală și de urmărire.

- **Strict după IMDb id** — fallback-ul pe titlu a fost eliminat deliberat (confirmat de suportul Filelist: rezultate nesigure). Fără IMDb id nu se face niciun apel.
- **Categoria RO Dubbed (28)** e inclusă în căutările din wizard, nu și în urmărirea automată. După descărcare, tipul film/serial se citește din `media.media_type`, nu din categorie.
- **Cache de 10 minute, citit doar de wizard** (`useCache: true`), ca să cruțe limita orară a contului. Urmărirea întreabă mereu direct — un răspuns vechi ar raporta „nimic nou”.
- Fiecare rezultat păstrează `matchedByImdb`, vizibil la **„Info Căutare”** în dialogul de confirmare (`DownloadConfirmDialog.tsx`).

Orchestrarea descărcării (upload qBittorrent, scriere în `media`, notificări, polling) stă în `download.ts`. Cererea răspunde imediat după ce qBittorrent confirmă upload-ul; restul rulează în fundal.

### Potrivirea cu Plex — după ID, nu după titlu

Biblioteca Plex e în română („Imperiul Mafiei” pentru _MobLand_), deci potrivirea pe titlu lega în tăcere alt titlu (_You_ → _Younger_, _Dune_ 1984 în loc de 2021). Două mecanisme:

1. **ID-ul IMDb în numele fișierului** (`plex-id-hint.ts`) — la finalul descărcării, fișierele video (și subtitrările cu același nume) sunt redenumite prin qBittorrent cu ` {imdb-tt…}` înainte de extensie, ca agentul Plex să ia titlul direct după ID (fără el: „S.W.A.T. Exiles” → „S.W.A.T.” 2017). Prin API, nu pe disc, ca torrentul să rămână complet pentru seed.
2. **Căutarea în Plex după TMDB** — `findItem` (`src/lib/services/plex-library.ts`) primește un `PlexLookup { tmdbId, titles }` și alege item-ul după `tmdb://` din Guid-urile Plex (`includeGuids=1` e obligatoriu). Titlurile sunt doar termeni de căutare; fără `tmdb_id`, doar potrivire exactă.

### Detaliile se țin singure la zi

Plugin-ul `show-watcher` reîmprospătează la 12h per titlu detaliile serialelor (cu toate episoadele — nume, descriere, cadru, posterul sezonului) și ale filmelor (`refreshShowMetadata`, `syncEpisodeDetails`, `refreshMovieMetadata`). Totul se cere în română, cu engleza ca rezervă, deci o traducere apărută mai târziu pe TMDB se preia singură. Câmpurile se scriu doar cu valori nevide: ce lipsește la TMDB nu șterge ce avem. Producțiile românești își păstrează titlul original. Fiecare rulare scrie în jurnal (filtrul „Metadate”) ce s-a schimbat. TMDB se actualizează treptat (episodul înaintea sezonului), deci o corectură poate apărea cu întârziere.

---

## Calități și versiuni multiple

**Cinci trepte, exclusive:** `720p < 1080p < 1080p HDR < 4K < 4K HDR`. „1080p” înseamnă 1080p **SDR** — altfel alegând „1080p” ai primi un fișier care pe un TV fără HDR arată spălăcit. Consecință voită: o urmărire pe „1080p” nu ia lansări HDR.

Detectarea:

- **Din numele lansării** — `detectQuality` (`src/components/filelist/quality-utils.ts`) și `detectTorrentQuality` (`src/lib/media/torrent-quality.ts`). „DV”/„DoVi” contează ca HDR, cu limite de cuvânt (ca „Advent” să nu devină Dolby Vision).
- **Din Plex** — `mediaIsHdr` (`src/lib/services/plex-shared.ts`) citește `colorTrc`/`DOVIPresent` de pe item-ul complet (`/search` nu întoarce `Part.Stream`).

**Un film poate exista în Plex în mai multe calități**, ca versiuni ale aceluiași item, cu același `ratingKey`. De aici:

1. **Unicitate** — indexul unic pe `plex_rating_key` e restrâns la episoade (v27); altfel al doilea rând nu se putea lega și rămânea „se procesează” pe veci.
2. **Care versiune e a mea** — aleasă după calea fișierului (`plexMediaForPath`), din `content_path` al qBittorrent, singurul care coincide exact cu `Part.file`. Nesigur → calitatea rămâne `null`.
3. **Data** — `addedAt` e al item-ului; se scrie doar la o singură versiune, altfel sortarea cade pe `added_at`.

**În wizard**, `qualityDirection` compară cu cea mai bună calitate deținută: cu 4K HDR + 720p în bibliotecă, un 1080p e downgrade.

---

## Subtitrare română automată

La finalul fiecărei descărcări (înainte de refresh-ul Plex), `ensureRomanianSubtitle` (`src/lib/filelist/subtitles.ts`) rulează pipeline-ul din `subtitle-pipeline.ts` **per fișier** — o dată la un film, per episod la un pachet de sezon:

1. **Verificări** (`subtitle-checks.ts`) — subtitrare sau **audio** românesc încorporat (`ffprobe`), `.srt` din torrent, subtitrare deja pe disc. Ce e deja bun nu se atinge.
2. **`.srt`-urile din torrent, după limbă** (verificată după conținut — diacritice, inclusiv ş/ţ cu sedilă, apoi cuvinte uzuale — nu după nume): cel român devine `.ro.srt`, cel englez primește `.en`, altă limbă e pusă deoparte ca `.respins`. Se aplică singurului `.srt`, celui nemarcat de lângă video și unui `.ro.srt` greșit; cele marcate deja cu altă limbă rămân neatinse. Totul **prin API-ul qBittorrent** (`torrents/renameFile`), cu așteptare până mută efectiv — altfel qBittorrent pierde evidența fișierului.
3. **Căutare externă**, dacă tot lipsește — **OpenSubtitles** (după IMDb, până la 5 pagini) și **subs.ro** (până la 6 arhive, filtrate pe limbă după conținut, inclusiv arhivele „Sezoanele 1-2”). La seriale, candidații sunt filtrați pe `SxxExx` exact. Traducerile automate nemarcate sunt ignorate (uploaderul `os-auto`, traducătorul „Ai”).
4. **Alegere și verificare** (`subtitle-sources.ts`, `release-scoring.ts`, `subtitle-verify.ts`) — candidații sunt ordonați după numele release-ului (sursa și grupul contează mult, rezoluția aproape deloc; la egalitate câștigă subs.ro), apoi încercați pe rând până trece unul de verificarea de conținut: limba, durata (ultima replică nu poate fi mult după sfârșitul fișierului) și **sincronizarea** — corelația intervalelor de vorbire cu o subtitrare text deja încorporată (de obicei engleza). Episodul corect dă 0,72–1,00, altul ≤ 0,29; pragul e 0,45. Când există o referință, câștigă varianta cea mai bine sincronizată.
5. **Scriere** (`subtitle-encoding.ts`, `subtitle-apply.ts`) — conversie la UTF-8 (Plex nu detectează encoding-ul), scriere lângă video cu numele lui + `.ro.srt`. Fără o potrivire sigură, se scrie cea mai apropiată, marcată **aproximativă**.

**Reîncercare zilnică** (plugin `subtitle-retry`, `src/lib/filelist/subtitle-retry.ts`) — traducerile apar des la una-trei zile după episod. Timp de **14 zile** de la descărcare, o dată pe zi, se reverifică orice torrent fără subtitrare română și orice subtitrare aproximativă; aproximativa se înlocuiește doar cu una sigur mai bună. Ceasul e `subtitle_checked_at` din DB. Jurnal și push doar când se găsește ceva; starea e vizibilă în Bibliotecă și în Tehnic → Plugin-uri.

**Corectare manuală** — „Corectează subtitrare” din drawer-ul Bibliotecii rulează aceeași verificare (`checkSubtitleForTorrent`), pentru admin sau cel care a adăugat titlul.

**Raportul** fiecărei verificări (varianta aleasă, sincronizarea măsurată, variantele respinse cu motivul) se salvează structurat pe rândul din `media` (`subtitle_report`) și în jurnal, categoria Subtitrări.

OpenSubtitles e servit prin Cloudflare cu cache comun de până la 24 h; cererile de căutare adaugă un parametru `_` ca să-l ocolească.

---

## Urmărire automată

Două module simetrice, conduse de plugin-ul `server/plugins/show-watcher.ts`.

**Seriale** (`src/lib/media/show-watch.ts`) — un serial urmărit își descarcă singur episoadele noi. Mecanismul e **declarativ**: TMDB spune ce s-a difuzat, `media WHERE parent_id = ?` spune ce avem, diferența se descarcă. Idempotent — se repară singur după restart și nu poate descărca de două ori. Activarea pornește de la o poziție aleasă (`auto_download_from`, ex. `S03E05`), nu trage tot istoricul.

- **Fereastra „apărut” e azi + mâine** (`aired-episodes.ts`) — TMDB dă doar data, iar unele platforme publică cu o zi înainte (MobLand pe Amazon). Descărcarea cere în continuare torrentul cu IMDb-ul și S/E-ul exact. Poziția de start la activare rămâne pe regula strictă.
- **Poziția de start avansează** după episoadele aduse de urmărire (`watch-position.ts`) și se oprește la primul gol — un episod văzut și șters nu e redescărcat.
- **Calitatea de rezervă** (opțională, `auto_download_fallback_quality`, și la filme) — se ia doar dacă principala tot lipsește la o verificare de peste cel puțin 3 ore (`fallback-quality.ts`).

**Filme** (`src/lib/media/movie-watch.ts`) — un film încă inexistent pe Filelist la calitatea cerută e recăutat periodic. Urmărirea **se stinge singură** la prima descărcare reușită, iar rândul lui din `media` n-are `torrent_hash` și nici `plex_rating_key` — deci e invizibil în Bibliotecă, reconcilierea Plex și reluarea descărcărilor, apărând doar la „Filme așteptate”.

**Unde stă starea** — coloane pe rândul-părinte din `media` (`auto_download`, `auto_download_quality`, `auto_download_fallback_quality`, `auto_download_from`, `watch_last_checked_at`, `watch_fallback_seen`), nu o tabelă paralelă. Prima variantă (`pinned_items`, eliminată în v14) producea duplicate și descărcări de N ori.

**Cadența** — 3h la seriale, 12h la filme, pe `watch_last_checked_at` din DB. Bucla doar întreabă la 10 min cine a expirat (plus un poll de 30s pentru filmele tocmai adăugate). Ora exactă a următorului episod vine de la TVmaze, pe care TMDB n-o dă.

---

## Viața unei descărcări

**Continuitate după restart** — polling-ul unei descărcări trăiește în procesul serverului, iar fiecare deploy îl repornește. Plugin-ul `download-recovery.ts`:

- **Reluarea** (la +15s) reia polling-ul descărcărilor nefinalizate — altfel un torrent terminat după restart rămâne fără subtitrare, `completed_at`, notificare și legare Plex.
- **Reconcilierea** (la +45s, apoi la 10 min) reîncearcă legarea Plex pentru tot ce e complet și fără `plex_rating_key` în ultimele 72h.

**Ștergerea completă** (`deleteMediaEntry`, `log.ts`) — torrent + fișiere prin qBittorrent, apoi reziduul de pe disc pe care qBittorrent nu-l consideră al lui: subtitrările scrise de aplicație, inclusiv `.respins` și cele cu sufix dublu (`disk-cleanup.ts`, cu garda `isInsideMediaRoot` — nu șterge niciodată `Filme/`/`Seriale/` ca întreg), apoi rândurile din `media`.

---

## Notificări și jurnal

**Web push** pentru commit-uri GitHub, torrente adăugate/complete, subtitrări găsite ulterior, încărcări în Immich, actualizări disponibile și acțiunile Restart/Update, cereri noi de cont și erori noi ale aplicației. Funcționează fără browser deschis; notificările pierdute în timpul unui restart se recuperează; erorile de rețea temporare (DNS încă nepornit după reboot) se reîncearcă. Notificările aceluiași eveniment se înlocuiesc (tag: „Descărcare completă” peste „Inițiată”), iar apăsarea aduce aplicația deja deschisă la pagina potrivită. Conținutul lor stă într-un singur loc: `src/lib/notifications/notifications.ts`. Abonamentele se văd și se revocă din Tehnic.

**Jurnalul de activitate** (Tehnic) — categorii (inclusiv Subtitrări și Metadate), separatoare pe zile, căutare fără diacritice. Vizionările Plex sunt un singur rând cu intervalul și progresul („în curs” până se încheie); oprirea + pornirea unui deploy sunt un rând „Deploy · oprit N s”. Rândurile de torrent deschid titlul în Bibliotecă (`/biblioteca?titlu=ID`). Clientul cere la fiecare puls doar intrările noi (cursor pe `rowid`), iar lista întreagă din 5 în 5 minute.

---

## Întreținere: backup, actualizări, retenție

Plugin-ul `server/plugins/maintenance.ts`, cu pași independenți:

- **Închide acțiunile rămase „în curs”** de la procesul anterior, la pornire — altfel ar bloca butoanele Restart/Update.
- **Backup-ul bazei** (`src/lib/system/db-backup.ts`) — `data/faikkitbox.db` ține tot. Copia se face cu **`VACUUM INTO`**, nu cu `cp` (baza e în WAL). Verificare la +90s, apoi din oră în oră; copia se face doar dacă ultima de pe disc e mai veche de 23h, cu rotație la 14 fișiere în `data/backups/` (sau `FAIKKITBOX_BACKUP_DIR`). Ceasul e chiar fișierul, deci deploy-urile nu-l resetează. Stare și backup manual în Tehnic.
- **Verificarea actualizărilor** (`update-check.ts`) — Plex, Immich, Ubuntu și cererea de repornire, efectiv o dată pe zi; intrare în jurnal + push cât timp ceva rămâne neinstalat.
- **Rating-urile IMDb** (`src/lib/imdb/imdb-ratings.ts`) — datasetul oficial `title.ratings.tsv.gz`, importat zilnic într-o bază separată, `data/imdb-ratings.db` (~35 MB, se poate reface oricând, deci nu încarcă backup-urile). Importul scrie un fișier nou și îl mută peste cel vechi abia la final.

**Retenție** — Jurnalul de activitate și jurnalul de erori păstrează 30 de zile; cel de erori e plafonat și la 1000 de rânduri.

---

## Erori aplicație

Toate `console.warn`/`console.error` din **toată aplicația** — server functions, SSR, plugin-uri, cod client — sunt captate automat în widget-ul **„Erori aplicație”** din Tehnic.

| Componentă                               | Rol                                                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/errors/console-capture.ts`      | Suprascrie `console.error`/`console.warn` pe server, trimite spre `logError()`. Instalată idempotent din `server.ts` și din fiecare plugin. |
| `src/lib/errors/client-error-capture.ts` | Echivalentul pentru browser (plus `window.onerror`/`unhandledrejection`), spre `logClientError()`, cu rate-limit per IP.                    |
| `src/lib/errors/error-log.ts`            | Nucleul: grupare, rate-limit, retenție, notificare. Server-only.                                                                            |
| `src/lib/errors/error-log.functions.ts`  | Server functions (`getErrorLogs`, `clearErrorLogs`, `logClientError`) — fișierul subțire importat de client.                                |

- **Grupare** — erori identice (sursă + nivel + mesaj) incrementează un contor `×N`.
- **Rate limit** — max 60 scrieri/minut; peste, o intrare de avertizare și suspendare temporară.
- **Notificare** — doar la un tip **nou** de eroare: intrare `app_error` în jurnal + push (max 5 push-uri / 10 min).
- **UI** (`ErrorLogSection.tsx`) — warn/error colorat, căutare, filtru pe sursă (Server/SSR/Browser), contor de necitite.

Nu intră în captare: avertismentele proprii Node (`ExperimentalWarning`), cererile abandonate de client (`ECONNRESET` la o PWA reluată) și rezultatele obișnuite ale subtitrărilor (variante respinse, aproximative), scrise cu `console.log`. Ce e un rezultat normal se loghează cu `console.log`, nu `console.warn`.

---

## Securitate

- **Toate server function-urile cer autentificare**, cu două excepții intenționate: `getAdminStatus` (clientul trebuie să afle că _nu_ e logat) și `getVapidPublicKey`. Garda e prima instrucțiune din handler.
- **Sesiunile se validează în DB la fiecare cerere** — `liveAccount()` verifică că rândul din `users` există, e `approved` și are aceeași `session_version`, apoi citește rolul de acolo. Cookie-ul e semnat și ține 7 zile; fără verificare, revocarea sau retrogradarea n-ar avea efect până la expirare.
- **Headere de securitate** pe toate răspunsurile (`SECURITY_HEADERS` în `vite.config.ts`): `X-Frame-Options: DENY` + `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS. **CSP aplicat** din 23 sept. 2026; `'unsafe-inline'` rămâne pentru script și stiluri (SSR-ul le injectează inline). O sursă externă nouă folosită în browser trebuie adăugată în `CSP`, altfel e blocată.
- **IP-ul real al vizitatorului** (`getClientIp`, `src/lib/client-ip.server.ts`) — prin Cloudflare Tunnel toate cererile vin de la container, deci se citește `CF-Connecting-IP`, crezut doar când cererea vine din rețeaua Docker a tunelului (172.20.0.0/16). Folosit la rate limiting, istoricul login-urilor și erori.
- **Rate limiting** pe autentificare (15 încercări/IP și 8/utilizator la 15 min, resetat la login reușit) și pe înregistrare (6/IP pe oră — înregistrarea interoghează prietenii Plex, deci altfel ar fi un oracol de enumerare).
- **`/api/plex-thumb`** acceptă o singură formă de cale, pe listă albă (`/library/metadata/<id>/<tip>/<ts>`), nu o filtrare de `..` (`fetch()` normalizează `/library/../x`, deci un `startsWith` era ocolibil). Ruta citește sesiunea fără s-o rescrie — vezi [Note tehnice](#note-tehnice-pentru-dezvoltare).
- **Codul server nu ajunge în bundle-ul public** (regula `*.functions.ts`, mai jos). Verificare după orice refactor:

  ```bash
  grep -l "__vite-browser-external" .output/public/assets/*.js   # trebuie să nu întoarcă nimic
  ```

- **Secretele nu ajung în bundle** — build-ul înlocuiește `process.env` cu `{}` în codul client. Verificare: caută valorile din `.env` în `.output/public/`.

### Privilegiile procesului

Serviciul rulează sub contul de sistem **`faikkitbox`** (grup `media`), nu ca root. Drepturile de sistem vin dintr-o listă sudoers cu comenzi fixe — exact cele din `src/lib/system/service-jobs.ts` și `network-link.ts`. O comandă nouă trebuie adăugată și în `deploy/hardening/faikkitbox.sudoers`, altfel eșuează cu „not allowed”.

Scrierea în bibliotecă merge prin grupul `media`: `/media/ssd2tb` e `setgid` + scriibil de grup, iar qBittorrent pornește cu `Group=media` și `UMask=0002`.

Un drop-in systemd (`deploy/hardening/hardening.conf`) restrânge procesul: `PrivateTmp`, `ProtectClock`, `ProtectControlGroups`, `ProtectKernelLogs`, `ProtectHostname`, `LockPersonality`, `RestrictRealtime`, familii de socket-uri limitate.

**Limita cunoscută:** `NoNewPrivileges` nu poate fi activat (sudo e setuid), nici `ProtectSystem`, cât timp pagina Sistem rulează `apt-get upgrade`, care e practic echivalent cu root. Contul dedicat limitează daunele, dar nu oprește un atacator care execută cod în aplicație. Detalii: `deploy/hardening/README.md`.

---

## Performanță și date live

**Preîncărcare la deschiderea aplicației** (`src/lib/prefetch.ts`) — imediat după login se cer în fundal datele și codul (`router.preloadRoute`) tuturor paginilor la care contul are acces, păstrate în memorie (`gcTime: Infinity`), deci fiecare pagină se deschide direct. Pulsurile periodice rulează doar cât e pagina deschisă. La ieșirea din cont, memoria se golește.

**Cache partajat pe server** (`cachedAsync`, `src/lib/services/shared.ts`) — N tab-uri deschise costă cât unul; cererile concurente pe aceeași cheie primesc aceeași promisiune; eșecurile nu se cachează. Pentru date scumpe și lente (`si.processes()`, Docker), `staleWhileRevalidate` servește valoarea veche și reîmprospătează în fundal.

**Ritm reglabil** — `src/lib/refresh-rate.ts`, widget în Sistem (1s…30s, per dispozitiv). `refetchInterval` din `queries.ts` e o funcție, deci schimbarea are efect imediat.

**Ce curge, curge local** — uptime-ul (`use-live-counter.ts`) și poziția de redare Plex (`useLiveViewOffsets.ts`) sunt interpolate în client și resincronizate la fiecare răspuns: zero cereri în plus, ceas care avansează la secundă.

**Plex pe LAN** — `discoverPlexUrl` preferă `PLEX_URL` din `.env`: ~0,4 ms direct vs ~539 ms prin `plex.direct`. Fiecare candidat e validat, deci o adresă greșită cade automat pe descoperire.

**Fără I/O sincron în server functions** — un `execSync` (ex. `git fetch`) blochează event loop-ul pentru toate cererile; comenzile externe rulează asincron.

---

## Stack tehnic

- Node.js 26+ (`engines` în `package.json`), Ubuntu 26.04
- [React 19](https://react.dev/) + [TanStack Start](https://tanstack.com/start) / [Router](https://tanstack.com/router) / [Query](https://tanstack.com/query)
- [Vite](https://vitejs.dev/) + [Nitro](https://nitro.build/) (preset `node-server`)
- [Tailwind CSS v4](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/) (doar `dialog`, `drawer`, `progress`, `sonner`), plus `orb` propriu
- [systeminformation](https://www.npmjs.com/package/systeminformation) — metrici sistem
- SQLite nativ (`node:sqlite`) — fără ORM
- [Vitest](https://vitest.dev/) — teste pe logica pură (wizard, scoring, verificarea subtitrărilor, parsare) și de integrare pe o bază SQLite temporară, cu serviciile externe simulate. Testele de integrare setează `FAIKKITBOX_DB_PATH` înainte de import și verifică `db.location()`, ca să nu poată atinge baza reală
- TypeScript (strict, `noUnusedLocals`/`noUnusedParameters`), ESLint, Prettier

---

## Structură proiect

Inventar complet, fișier cu fișier, în **[`STRUCTURE.md`](./STRUCTURE.md)**. Pe scurt:

```
src/
  components/         componente UI (AppHeader, BottomNav, gauge-uri...)
    biblioteca/         pagina Bibliotecă
    principala/         wizard-ul de adăugare (shell + wizard/: reducer,
                        funcții pure, un fișier per pas)
    filelist/           căutare manuală Filelist + piese partajate cu wizard-ul
    descopera/          pagina Descoperă
    tehnic/             paginile Tehnic/Utilizatori
    sistem/             pagina Sistem
    ui/                 dialog, drawer, progress, sonner, orb
  hooks/              hook-uri React
  lib/                logica de server, pe domenii
    auth/               autentificare, conturi, legătură Plex
    media/              tabela `media`, urmărirea automată, metadate
    filelist/           căutare, descărcare, subtitrări, curățare disc
    tmdb/               client TMDB, căutare, detalii, Descoperă
    imdb/               rating-uri IMDb din datasetul zilnic
    tvmaze/             ora exactă de difuzare a unui episod
    services/           Plex, Immich, qBittorrent, Host
    system/             metrici, Restart/Update, actualizări, Ethernet,
                        speedtest, backup
    errors/             captare erori server + client
    notifications/      web push și conținutul notificărilor
    prefetch.ts         preîncărcarea paginilor la deschidere
    queries.ts          toate query-urile partajate (queryOptions)
    *.functions.ts      server functions — fișiere SUBȚIRI (vezi mai jos)
  routes/             pagini: index, descopera, biblioteca, immich, qbit,
                      sistem, tehnic, users, login, register
server/
  plugins/            fundal: show-watcher, subtitle-retry, download-recovery,
                      maintenance, plex-session-tracker,
                      immich-upload-tracker, server-lifecycle
  routes/api/         GitHub webhook, SSE auto-reload, proxy postere Plex
deploy/
  hardening/          unit systemd, sudoers și scripturi pentru contul dedicat
public/               assets statice, Service Worker
data/                 faikkitbox.db, imdb-ratings.db, backups/ (în afara git)
```

---

## Configurare

```bash
cp .env.example .env
```

| Variabilă                                           | Descriere                                                                                                      |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `ADMIN_USER` / `ADMIN_PASS`                         | Primul cont de admin, creat o singură dată pe o bază nouă; după aceea conturile se gestionează din Utilizatori |
| `SESSION_SECRET`                                    | Secretul sesiunilor (min. 32 caractere, ex: `openssl rand -hex 32`)                                            |
| `PLEX_URL` / `PLEX_TOKEN`                           | URL (de preferat pe LAN) și token server Plex                                                                  |
| `IMMICH_URL` / `IMMICH_API_KEY`                     | URL și cheie API Immich                                                                                        |
| `QBIT_URL` / `QBIT_USERNAME` / `QBIT_PASSWORD`      | URL și credențiale WebUI qBittorrent                                                                           |
| `FILELIST_USERNAME` / `FILELIST_PASSKEY`            | Credențiale API Filelist                                                                                       |
| `TMDB_API_KEY`                                      | Token Bearer (JWT) pentru API TMDB                                                                             |
| `OPENSUBTITLES_API_KEY`                             | Cheie API OpenSubtitles.com (profil → „API Consumers”)                                                         |
| `OPENSUBTITLES_USERNAME` / `OPENSUBTITLES_PASSWORD` | _(opțional)_ Login OpenSubtitles, pentru o limită de descărcări mai mare decât cea anonimă                     |
| `SUBSRO_API_KEY`                                    | Cheie API subs.ro                                                                                              |
| `MEDIA_MOVIES_PATH` / `MEDIA_SERIES_PATH`           | Unde salvează qBittorrent filmele/serialele                                                                    |
| `GITHUB_REPO`                                       | Repo GitHub (ex: `Faicu/FaikkitBox`) pentru commit-uri                                                         |
| `GITHUB_TOKEN`                                      | _(opțional)_ Token GitHub pentru o limită mai mare de cereri                                                   |
| `GITHUB_WEBHOOK_SECRET`                             | Secret pentru validarea webhook-urilor GitHub                                                                  |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`            | Chei VAPID pentru web push (`npx web-push generate-vapid-keys`)                                                |
| `VAPID_EMAIL`                                       | Contactul VAPID, în forma `mailto:adresa@domeniu`                                                              |
| `PLEX_COMPOSE_FILE` / `IMMICH_COMPOSE_FILE`         | _(opțional)_ Căi custom `docker-compose.yml` pentru Restart/Update                                             |
| `SPEEDTEST_BIN`                                     | _(opțional)_ Cale completă spre binarul Ookla `speedtest`                                                      |
| `PORT`                                              | Port server (implicit `3000`)                                                                                  |
| `NODE_ENV`                                          | `production` în producție                                                                                      |
| `NODE_OPTIONS`                                      | _(opțional)_ `--disable-warning=ExperimentalWarning` — ascunde doar avertismentul pentru `node:sqlite`         |
| `FAIKKITBOX_DB_PATH`                                | _(opțional)_ Cale custom pentru baza SQLite (implicit `/opt/faikkitbox/data/faikkitbox.db`)                    |
| `FAIKKITBOX_BACKUP_DIR`                             | _(opțional)_ Folder custom pentru backup-uri (implicit `backups/` lângă bază)                                  |

> **Nu comite niciodată `.env` în git.**

---

## Instalare și dezvoltare

```bash
npm install

npm run dev          # development
npm run build        # tsc --noEmit + vite build + marcaj de deploy
npm run preview      # preview build local

npm run test         # vitest (o rulare)
npm run test:watch   # vitest, mod watch

npm run lint         # ESLint
npm run lint -- --fix
npm run format       # Prettier
```

Pornire directă după build: `node .output/server/index.mjs`.

---

## Deploy

```bash
sudo systemctl stop faikkitbox           # 1. oprește serviciul ÎNAINTE de build
npm run build                            # 2. tsc --noEmit, apoi vite build
sudo chown -R faikkitbox:media .output   # 3. build-ul rulat ca root lasă fișiere root
git add <fișiere> && git commit          # 4.
sudo systemctl start faikkitbox          # 5. repornește cu build-ul nou
```

**Push-ul către GitHub NU e automat** — commit-urile locale rămân nepublicate până când utilizatorul apasă butonul din Tehnic (`pushToGitHub`, `src/lib/github.functions.ts`). E intenționat — vezi `CLAUDE.md`.

**De ce oprire înainte de build:** `npm run build` scrie peste `.output/server/`, din care procesul live încarcă dinamic chunk-uri SSR; o cerere în timpul build-ului putea da `ERR_MODULE_NOT_FOUND`.

**Marcajul de deploy** scris la finalul build-ului e consumat la prima pornire, ca oprirea și pornirea să apară în jurnal ca un singur rând „Deploy”, fără push.

**Shutdown rapid:** `server/plugins/server-lifecycle.ts` forțează ieșirea la 300ms după `SIGTERM`/`SIGINT`; altfel conexiunea SSE de auto-reload (`server/routes/api/deploy-sha.ts`) ar ține procesul viu până la `SIGKILL`, fără cleanup.

**Taburi vechi după deploy** — un tab deschis rulează încă bundle-ul vechi; dacă forma răspunsului unei server function s-a schimbat, poate apărea o eroare client tranzitorie, care dispare la reîncărcare.

---

## Note tehnice pentru dezvoltare

Pentru inventarul complet, vezi [`STRUCTURE.md`](./STRUCTURE.md). Aici sunt regulile care, încălcate, au produs deja bug-uri.

### Arhitectură — TanStack Start, nu Next.js

Rutele sunt în `src/routes/*.tsx`, cu `createFileRoute("/cale")({ component, head, ... })`. `src/routes/__root.tsx` e layout-ul rădăcină (providers, shell, captare erori client).

Logica de server trăiește în `src/lib/**/*.functions.ts`, ca `createServerFn`:

```ts
export const getSomething = createServerFn({ method: "GET" })
  .validator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    await requireAuth();
    /* rulează doar pe server */
  });
```

În componente se apelează direct (loader/SSR) sau prin `useServerFn(fn)` în event handler-e (identitatea e stabilă, poate sta în dependențele unui efect).

Plugin-urile (`server/plugins/*.ts`) n-au request context — folosesc variante „interne” ale funcțiilor (plain function, fără `createServerFn`), prin `await import(...)` dinamic: `checkFilelistForItemInternal`, `getTmdbSeasonEpisodesInternal`, `checkShow`/`checkMovie`. Nitro încarcă `server/plugins/` și montează `server/routes/api/` **prin convenție de folder**, deci un grep nu le arată ca „folosite”.

### Reguli

- **`*.functions.ts` — fără importuri server statice.** Corpul handler-ului e scos din bundle-ul client, deci un `await import("./x")` din el rămâne pe server; un import static la vârf trage tot graful în bundle-ul public. Logica stă în modulele pereche (`media.ts`, `activity-log.ts`, `error-log.ts`, `filelist/download.ts`, `system/*.ts`...). Încălcarea regulii a servit public schema SQLite și a produs `(0 , n.dirname) is not a function`, luni de zile neexplicată.
- **O eroare dintr-o server function se aruncă cu `throw new Error(...)`, nu cu un `Response`.** TanStack Start tratează un `Response` aruncat ca rezultat reușit (`x-tss-raw`).
- **Rutele brute din `server/routes/` doar citesc sesiunea** (`unsealSession`), nu folosesc `getSession` din h3-ul Nitro: cele două h3 (Nitro vs TanStack Start) au formate de sigiliu diferite, iar rescrierea cookie-ului deloga utilizatorul.
- **Munca de la pornire se declanșează din `server/plugins/`**, nu dintr-un `setTimeout` la nivel de modul — un efect de modul rulează doar dacă cineva importă modulul. Două bug-uri identice au venit din asta.
- **Munca de pornire care atinge rețeaua nu stă într-o migrare** (sincronă, în tranzacție, fatală la eșec). Pentru „o singură dată, cu rețea”: tabela `one_time_jobs`, declanșată din plugin.
- **DB** — SQLite nativ (`node:sqlite`, nu `better-sqlite3`), un singur fișier. Schema cu `CREATE TABLE IF NOT EXISTS`, migrările incrementale pe `PRAGMA user_version` (`runCleanups` în `db.ts`), tranzacționale și fatale la eșec. O migrare nouă trebuie să fie idempotentă și să verifice că tabela sursă există; o migrare deja aplicată nu se modifică.
- **`media` e sursa unică de adevăr pentru bibliotecă** — datele din wizard se scriu complet acolo, restul proiectului citește de acolo, nu recalculează live. Urmărirea e un set de coloane pe rândul-părinte, nu o tabelă paralelă (`pinned_*` și `downloads` au fost eliminate tocmai de-asta). Un flux nou de intenție extinde rândul existent.
- **Filelist** — `categories.ts` e singurul loc pentru film/serial pe categorie; `checkFilelistForItemInternal` e singurul care vorbește cu API-ul Filelist; `plex-refresh.ts` e singurul care declanșează rescan Plex.
- **Plex** — orice căutare a unui titlu trece prin `PlexLookup` + `findItem`, după ID-ul TMDB; nu adăuga comparații pe titlu.
- **qBittorrent** — fișierele unui torrent se redenumesc sau mută doar prin API (`torrents/renameFile`), niciodată direct pe disc, și se așteaptă până când mutarea (asincronă) s-a produs.
- **TMDB** — pentru căutări externe folosește `literalTitle` din `getTmdbDetails`, nu `originalTitle` brut. TMDB cache-uiește per URL exact, deci cererile pentru episoade au cache-bust.
- **Erori aplicație** — nu adăuga `logError()` lângă un `console.warn`/`console.error` (dublură). Un rezultat obișnuit se loghează cu `console.log`, ca să nu apară ca eroare.
- **Query-uri** — orice query refolosit e definit o singură dată ca `queryOptions(...)` în `src/lib/queries.ts`; nu duplica inline aceeași `queryKey`. După o mutație: `queryClient.invalidateQueries({ queryKey: [...] })`. Listele incrementale folosesc `useInfiniteQuery`.

### Puncte de refolosit în componente

- `src/components/filelist/quality-utils.ts` — `detectQuality`, `emptyQualitySet`, `groupTorrentsBySeasonEpisode`; orice parsare a numelui de torrent trece pe aici. O treaptă nouă de calitate se adaugă în șase locuri care trebuie să rămână în acord: `QualitySet` (`components/filelist/types.ts`), `detectQuality`, `detectTorrentQuality`, `QUALITY_RANK` și `WatchQuality` (`wizard/selection.ts`, `wizard/WizardControls.tsx`), selectorul din wizard și filtrele din `FilelistSection.tsx`.
- `DownloadConfirmDialog.tsx` + `use-download.ts` (`useDownload()`) — orice buton nou de descărcare trece prin ele.
- `AddMediaWizard.tsx` — doar shell; starea în `wizard/state.ts`, derivările pure în `wizard/derive-seasons.ts` și `wizard/selection.ts`. Un pas nou se adaugă în uniunea `Step`, nu ca `useState`.
- **Confirmările distructive se fac inline**, nu cu `AlertDialog`/`Dialog` Radix și nici cu `window.confirm()`: un dialog Radix imbricat într-un `Drawer` vaul îngheață ecranul fără nicio eroare (commit `c76ce30`). Model: overlay-ul din `BibliotecaList.tsx` sau confirmarea din `PushSubscriptionsSection.tsx`.
- Drawer-ele de detalii urmează modelul `CommitDrawer.tsx` / `UserDetailDrawer.tsx` / `TitleDetailDrawer.tsx`, cu starea `selected*` în părinte.
- Descoperă are două moduri (`DiscoverGrid.tsx`, `FeedView.tsx`) care împart `FilterTabs` — un filtru nou se propagă în ambele.
- `src/components/ui/orb.tsx` — pentru o așteptare fără capăt cunoscut; pentru confirmarea unui clic rămâne `Loader2`.
- `src/hooks/use-flash-on-change.ts` — micro-flash pe o valoare schimbată (nu la prima randare).
- Animațiile cu `stagger-in` pe un container: nu pune clase cu `animation` proprie (ex. `pulse-glow`) pe copiii direcți — suprascriu animația de intrare și elementul rămâne invizibil; animează un `::after`.

### Workflow obligatoriu

Vezi `CLAUDE.md` — orice modificare de cod e urmată de secvența din [Deploy](#deploy) (stop → build → chown → commit → start). Push-ul rămâne manual, din Tehnic.
