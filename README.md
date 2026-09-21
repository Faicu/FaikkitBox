# FaikkitBox

**Dashboard personal de monitorizare și control pentru serverul de acasă.**

Un singur ecran pentru Plex, Immich, qBittorrent, sistemul de operare și descoperirea/adăugarea de filme și seriale — cu notificări push, jurnal de activitate și captare automată a erorilor.

Construit cu [TanStack Start](https://tanstack.com/start) (React 19 + TanStack Router/Query), rulează ca server Node prin Nitro, în spatele unui reverse proxy (nginx) pe Ubuntu.

---

## Cuprins

- [Funcționalități](#funcționalități)
- [Autentificare și conturi](#autentificare-și-conturi)
- [Adăugare și urmărire titluri](#adăugare-și-urmărire-titluri)
- [Calități și versiuni multiple](#calități-și-versiuni-multiple)
- [Urmărire automată](#urmărire-automată)
- [Backup și retenție](#backup-și-retenție)
- [Sistemul de erori și observabilitate](#sistemul-de-erori-și-observabilitate)
- [Securitate](#securitate)
  - [Privilegiile procesului](#privilegiile-procesului)
- [Performanță și date live](#performanță-și-date-live)
- [Stack tehnic](#stack-tehnic)
- [Structură proiect](#structură-proiect)
- [Configurare](#configurare)
- [Instalare și dezvoltare](#instalare-și-dezvoltare)
- [Deploy](#deploy)
- [Note tehnice pentru dezvoltare](#note-tehnice-pentru-dezvoltare)

---

## Funcționalități

| Pagină | Acces | Ce arată |
|---|---|---|
| **Acasă** (`/`) | Public | Singura pagină accesibilă fără cont. Status live Plex (sesiuni, biblioteci, top vizionate, recent adăugate). Buton **„Adaugă film/serial"** (necesită cont aprobat) — wizard ghidat: căutare TMDB → verificare automată Plex + Filelist → alegere calitate/sezon/episod → confirmare și descărcare. Căutare manuală Filelist (admin). Vizitatorilor neautentificați li se arată un CTA cu butoane **Înregistrare**/**Autentificare**. |
| **Descoperă** (`/descopera`) | Cont aprobat | Explorare TMDB (grid + feed video) cu status Plex și Filelist per titlu — deschide wizard-ul de adăugare direct pe titlul selectat. |
| **Bibliotecă** (`/biblioteca`) | Cont aprobat | Tot ce e descărcat prin aplicație sau deja existent în Plex (backfill) — căutare, grupare pe serial, detalii per titlu (calitate, subtitrare RO, cine a văzut), corectare/ștergere subtitrare, ștergere completă (admin/cel care a adăugat). Deasupra listei, **filmele așteptate** (urmărire pornită, încă negăsite pe Filelist). Pentru seriale, comutator de **urmărire episoade noi**. |
| **qBittorrent** (`/qbit`) | Cont aprobat | Viteze download/upload, torrente active/total, filtre pe stări, căutare în listă, pauză/reluare (global sau individual), ștergere torrent + fișiere. |
| **Immich** | Admin | Număr fișiere, spațiu ocupat, coadă de joburi active. |
| **Sistem** | Admin | CPU, memorie, swap, uptime, discuri (viteze read/write), rețea, senzori temperatură, top procese și top I/O disc, aplicații monitorizate, mentenanță (update Ubuntu, restart servicii), reglaj pentru ritmul statisticilor live (1s…30s, per dispozitiv). |
| **Tehnic** | Admin | Control serviciu Plex (restart/actualizare), speedtest (test nou + istoric grafic, plus starea legăturii Ethernet cu buton de renegociere), status plugin-uri server (clicabile, cu drawer de detalii), backup-ul bazei de date, abonamentele push înregistrate, statistici commit-uri, jurnal de activitate, **widget Erori aplicație** (vezi mai jos), push manual către GitHub. |
| **Utilizatori** (`/users`) | Admin | Cereri de aprobare cont, listă conturi (admin + obișnuite), click pe orice cont deschide detalii complete (contact, legătură Plex, descărcări inițiate, activitate Plex, istoric autentificări). |

Alte capabilități transversale:

- **Urmărire automată** — un serial urmărit își descarcă singur episoadele noi pe măsură ce se difuzează; un film urmărit e căutat periodic pe Filelist până apare la calitatea cerută. Vezi [Urmărire automată](#urmărire-automată).
- **Notificări push** — web push pentru commit-uri GitHub, torrente adăugate/complete, cereri noi de aprobare cont, și erori noi ale aplicației. Funcționează fără browser deschis; recuperează automat notificările pierdute în timpul unui restart. Abonamentele sunt vizibile și revocabile din Tehnic, cu dispozitivul identificat.
- **Backup zilnic al bazei** — `VACUUM INTO` în `data/backups/`, cu rotație la 14 fișiere și card de stare în Tehnic. Vezi [Backup și retenție](#backup-și-retenție).
- **Verificare versiuni** — indicator Plex/Immich (actualizat / necesită update) în header-ul fiecărei pagini de serviciu, cu acțiune de restart pentru containerul Docker.
- **Autentificare multi-rol** — vezi secțiunea următoare.

---

## Autentificare și conturi

Sistem cu două roluri, o singură tabelă `users` (nu conturi separate pentru admin/user):

| Rol | Cum se obține | Acces |
|---|---|---|
| **Admin** | Creat manual de un alt admin, din pagina Utilizatori (`addAdminUser`). Aprobat automat (`status='approved'`). | Toate paginile. |
| **User obișnuit** | Auto-înregistrare publică (`/register`) + aprobare manuală de admin. | Acasă (public oricum), Descoperă, Bibliotecă, qBittorrent (fără căutarea manuală Filelist și alegerea manuală a torrentului, admin-only) — vezi tabelul de mai sus. |

**Înregistrare** (`registerUser`, `src/lib/auth/registration.functions.ts`) — formular Username/Parolă/Email/Telefon (WhatsApp). Username-ul **sau** email-ul introdus trebuie să corespundă unui cont din biblioteca Plex (`matchPlexAccount`, `src/lib/auth/plex-users.server.ts` — interoghează `plex.tv/api/users`, parsat manual din XML, cache 5 min; API-ul ignoră `Accept: application/json`), altfel cererea e respinsă direct, cu mesaj clar. Contul creat intră cu `status='pending'` — nu poate face login până nu e aprobat. Fiecare cerere nouă generează automat o intrare `account_request` în Jurnalul de activitate + notificare push.

**Aprobare** (`/users`, pagina Utilizatori) — admin vede cererile pending cu detalii (contact + legătura Plex găsită) și poate Aproba sau Respinge (respingerea șterge direct rândul — nu există status `rejected`). Orice cont existent poate fi „revocat" (șters) din secțiunea Utilizatori aprobați.

**Login unificat** (`/login`) — aceeași pagină și logică pentru admin și utilizatori obișnuiți; `adminLogin` verifică username+parolă în `users` fără filtrare pe rol, respinge conturile `pending`. Fiecare login reușit scrie un rând în `user_logins` (dată, IP, user-agent) + actualizează `users.last_login_at` — istoric vizibil în pagina de detalii a contului.

**Doi guarzi de rută**, exportați din `src/lib/auth/admin-route-guard.ts`:

```ts
requireAdminBeforeLoad   // doar admin — qBit (parțial), Immich, Sistem, Tehnic, Utilizatori
requireAuthBeforeLoad    // orice cont aprobat — Descoperă, Bibliotecă
```

...și echivalentul lor la nivel de server function, în `admin.server.ts`:

```ts
requireAdmin()   // aruncă 401 dacă session.data.admin nu e true
requireAuth()    // aruncă 401 dacă session.data.userId lipsește (orice rol aprobat trece)
```

**Important:** guard-ul de rută protejează doar navigarea. Fiecare server function apelată de o pagină trebuie să aibă *și ea* `requireAdmin()`/`requireAuth()` — altfel poate fi apelată direct, ocolind complet pagina. Când adaugi o funcție nouă, verifică ce pagină o folosește și alege guard-ul potrivit; dacă e folosită din mai multe pagini cu niveluri de acces diferite, ia nivelul cel mai permisiv dintre ele care rămâne totuși sigur.

**Legătura cu Plex** (`plex_account_id`/`plex_username`/`plex_email` pe fiecare cont) alimentează pagina de detalii din Utilizatori: activitate Plex recentă (`getPlexUserHistory`, auto-populează cache-ul dacă e rece, nu depinde pasiv de polling-ul de pe Acasă) și „cine a văzut" per titlu în Bibliotecă.

---

## Adăugare și urmărire titluri

Wizard-ul de adăugare (`AddMediaWizard.tsx`) — accesibil din butonul „Adaugă film/serial" de pe Acasă, sau direct dintr-un titlu deja deschis în Descoperă (`SceneViewer.tsx`) — face totul într-un flux: căutare TMDB → verificare Plex + Filelist → alegere calitate (1080p implicit, restul ascunse sub un toggle, admin-only) → confirmare și descărcare. Verificarea e **o singură cerere** către server (`checkTitleForWizard`, `src/lib/wizard-check.functions.ts`), care agregă acolo TMDB + Plex + Filelist + `media` + TVmaze; înainte erau zece dus-întors făcute de pe telefon, în trei valuri — munca în sine durează ~1s pe server, costul real erau rundele înmulțite cu latența mobilă. Pentru seriale, fiecare sezon/episod arată statusul lui (în Plex / se descarcă / disponibil pe Filelist / indisponibil / nelansat încă), iar descărcarea respectă ce oferă efectiv Filelist — pachet de sezon întreg sau episod individual, nu presupune una din ele. Dacă titlul e deja în Plex, ecranul spune explicit dacă alegerea ta e un *upgrade* sau un *downgrade* — o a doua descărcare e un al doilea fișier, nu o înlocuire. Vezi [Calități și versiuni multiple](#calități-și-versiuni-multiple).

Wizard-ul a fost refactorizat complet în sept. 2026: componenta a scăzut de la 1268 la 265 de linii, starea stă într-un `useReducer` cu pașii ca uniune discriminată (stări care logic nu pot coexista nu mai pot coexista nici în tip), derivările sunt funcții pure cu teste, iar fiecare pas e componenta lui — vezi `src/components/principala/wizard/` în [`STRUCTURE.md`](./STRUCTURE.md).

**Bibliotecă** (`/biblioteca`) arată tot ce există efectiv — descărcat prin aplicație sau deja în Plex dinainte de acest sistem (backfill) — citit direct din tabela `media`, fără cereri Plex/TMDB live la navigare. Fiecare titlu are un drawer de detalii cu subtitrare RO, cine a văzut, și acțiuni (corectare/ștergere subtitrare, ștergere completă) pentru cel care l-a adăugat sau pentru admin.

### Descărcare de pe Filelist

Căutarea „există pe Filelist?" e **unificată** într-o singură sursă de adevăr (`checkFilelistForItemInternal`, `src/lib/filelist/filelist-client.ts` — singurul loc care vorbește direct cu `api.php`/`download.php`), folosită atât de wizard cât și de căutarea manuală (`FilelistSection`, admin, de pe Acasă). Orchestrarea unei descărcări (upload qBittorrent, scriere în `media`, notificări, polling) rămâne în `download.ts`, care consumă doar clientul.

Caută **strict după IMDb id** — fallback-ul pe titlu a fost eliminat deliberat (confirmat de suportul Filelist: căutarea pe titlu dă rezultate nesigure). Fără IMDb id găsit pentru un titlu, nu se face niciun apel către Filelist.

Fiecare rezultat păstrează `matchedByImdb` — vizibil prin butonul **„Info Căutare"** din dialogul de confirmare descărcare (`DownloadConfirmDialog.tsx`).

### Subtitrare română automată (`src/lib/filelist/subtitles.ts`)

La finalul fiecărei descărcări (înainte de refresh-ul Plex), `ensureRomanianSubtitle` verifică automat:

1. **Fișierul media are deja subtitrare română încorporată?** — detectat cu `ffprobe` (dacă e instalat pe server; dacă lipsește, se sare peste acest pas, nu blochează). Dacă da, nu mai face nimic.
2. **Există un `.srt` în torrent, dar cu denumire greșită pentru Plex?** — Plex identifică limba unei subtitrări externe după numele fișierului (`<nume-media>.ro.srt`), nu după conținut. Dacă torrentul conține exact un `.srt`, conținutul e verificat întâi (diacritice ă/â/î/ș/ț ca semnal principal, cuvinte uzuale RO ca rezervă) — **nu se presupune** că e automat română doar pentru că e singurul fișier `.srt` din torrent (unele lansări vin cu subtitrare engleză bundle-uită). Dacă pare română, e **redenumit prin API-ul qBittorrent** (`torrents/renameFile`) — obligatoriu prin API, nu direct pe disk, altfel qBittorrent pierde evidența fișierului. Dacă nu pare română, e redenumit `.en.srt` (nu rămâne ambiguă pentru Plex) și se continuă la pasul 3, ca și cum n-ar fi existat niciun `.srt`.
3. **Nicio subtitrare deloc?** — se caută pe **OpenSubtitles** (`OPENSUBTITLES_API_KEY` în `.env`) după IMDb id, limba română. Din rezultate se alege cel al cărui `release` se potrivește cel mai bine cu sursa/rezoluția torrentului (ex. WEB-DL/AMZN 1080p vs BluRay 2160p) — o subtitrare pentru altă sursă desincronizează timpii de afișare. Dacă OpenSubtitles nu are o potrivire clară (sursă+rezoluție), se caută și pe **subs.ro** (`SUBSRO_API_KEY` în `.env`) — arhivele de acolo conțin adesea mai multe variante (una per sursă/rezoluție), extrase și scorate la fel; câștigă oricare din cele două surse cu potrivirea mai bună. Dacă nici așa nu există o potrivire clară, se salvează totuși cel mai apropiat rezultat, dar cu un avertisment în log ("verifică sincronizarea").

**Corectare ulterioară**: din drawer-ul unui titlu din Bibliotecă, aceeași verificare (`ensureRomanianSubtitle`) poate fi rulată din nou pe hash-ul torrentului — util când subtitrarea aleasă automat s-a dovedit desincronizată. Permis adminului sau contului care a adăugat titlul (`isAdminOrOwner`).

Descărcarea de pe Filelist răspunde imediat după ce upload-ul la qBittorrent e confirmat — găsirea hash-ului torrentului (poate dura până la 10s), jurnalizarea, scrierea în `media` și pornirea polling-ului rulează în fundal, nu mai blochează cererea HTTP a clientului.

### Continuitate după restart (`server/plugins/`)

O descărcare pornită din aplicație e urmărită de o buclă de polling care trăiește în procesul serverului. Un restart o omoară — iar workflow-ul de deploy repornește serviciul la fiecare modificare de cod. Două plugin-uri acoperă golul:

- **`filelist-resume.ts`** (la +15s de la pornire) reia polling-ul pentru descărcările nefinalizate. Fără el, un torrent care se termină după restart nu e observat niciodată: fără subtitrare RO, fără `completed_at`, fără notificare, fără legare Plex.
- **`plex-link-reconciler.ts`** (la +45s, apoi la 10 min) acoperă cazul complementar — descărcare terminată, dar legarea la Plex întreruptă de un restart în fereastra ei de 30 de minute. Reîncearcă pentru tot ce e complet și fără `plex_rating_key` în ultimele 72h.

Ambele sunt plugin-uri explicite, nu efecte secundare la nivel de modul: un `setTimeout` scris în corpul unui modul rulează doar dacă cineva importă modulul, iar asta depinde de grafuri de import care se schimbă la refactorizări.

Conținutul (titlu + text) notificărilor de torrent adăugat/complet trăiește în `src/lib/notifications/notifications.ts` — sursă unică, nu recalculat inline la fiecare loc care trimite o notificare.

---

## Calități și versiuni multiple

**Cinci trepte, exclusive între ele:** `720p < 1080p < 1080p HDR < 4K < 4K HDR`. Rezoluția primează, HDR departajează în interiorul ei. Exclusive înseamnă că „1080p" e 1080p **SDR**: o lansare HDR nu apare în ambele categorii, altfel alegând „1080p" ai primi un fișier care pe un TV fără HDR arată spălăcit. Consecință voită: o urmărire automată setată pe „1080p" nu mai ia lansări HDR.

Detectarea trăiește în două locuri, după sursă:

- **Din numele lansării** — `detectQuality` (`src/components/filelist/quality-utils.ts`, pentru grupare/filtrare) și `detectTorrentQuality` (`src/lib/media/torrent-quality.ts`, pentru notificări). Ambele tratează „DV"/„DoVi" ca HDR — Dolby Vision e HDR chiar când numele nu scrie „HDR" — cu limite de cuvânt, ca „Advent" să nu devină Dolby Vision.
- **Din Plex** — `mediaIsHdr` (`src/lib/services/plex-shared.ts`) citește `colorTrc`/`DOVIPresent` de pe item-ul complet, nu ghicește din numele fișierului. De-asta legarea cere item-ul întreg: `/search` nu întoarce `Part.Stream`.

**Un film poate exista în Plex în mai multe calități deodată** (4K HDR pentru seara de film, 1080p pentru un TV care nu duce 4K). Plex le vede ca două **versiuni ale aceluiași item**, deci întoarce același `ratingKey` pentru amândouă — iar asta atinge trei lucruri:

1. **Unicitatea în DB.** Indexul unic pe `plex_rating_key` a fost restrâns la episoade (migrarea v27). Înainte, al doilea rând `media` nu se putea lega niciodată: `UPDATE`-ul arunca, eroarea era înghițită, iar rândul rămânea pe veci „se procesează" în Bibliotecă. La episoade unicitatea rămâne — acolo un `ratingKey` chiar înseamnă un singur rând, iar `resolveSeasonPackPlexLinks` se bazează pe index.
2. **Care versiune e a mea.** Legarea alege versiunea după **calea fișierului** (`plexMediaForPath`), iar calea vine din `qbitContentPath` — `content_path` de la qBittorrent, singurul care coincide caracter cu caracter cu `Part.file` din Plex. Numele de pe Filelist nu descrie discul. Când versiunea nu poate fi identificată sigur, calitatea rămâne `null` — mai bine lipsă decât preluată de la altă versiune.
3. **Data.** `addedAt` e al item-ului, adică momentul primei versiuni. Se scrie doar când item-ul are o singură versiune; altfel rămâne gol și sortarea cade pe `added_at` (când am adăugat noi titlul), ca un film abia descărcat să nu sară instant sub intrarea veche.

**În wizard**, verificarea întoarce toate calitățile din Plex, nu doar `Media[0]`, iar `qualityDirection` primește lista completă: nu propune nimic pentru o calitate pe care deja o deții, și compară cu cea mai bună deținută — cu 4K HDR + 720p în bibliotecă, un 1080p e downgrade, nu upgrade față de 720p.

**Rândurile deja existente** își recalculează eticheta o dată, din Plex, la prima pornire după update (`redetectQualitiesOnce`, declanșat de `plex-link-reconciler`). Marcajul stă în tabela `one_time_jobs` — munca de pornire care atinge rețeaua nu poate sta într-o migrare sincronă, care rulează în tranzacție și e fatală la eșec.

---

## Urmărire automată

Două module simetrice, ambele conduse de plugin-ul `server/plugins/show-watcher.ts`.

**Seriale** (`src/lib/media/show-watch.ts`) — un serial cu urmărirea pornită își descarcă singur episoadele noi. Mecanismul e **declarativ, nu diferențial**: TMDB spune ce episoade au fost difuzate, `media WHERE parent_id = ?` spune ce avem, diferența e ce trebuie descărcat. Rularea e idempotentă — se auto-repară după restart, nu ratează nimic dacă un ciclu pică, și nu poate descărca de două ori, fiindcă verifică realitatea, nu un jurnal de evenimente. Activarea nu trage retroactiv tot istoricul: se pornește de la o poziție aleasă (`auto_download_from`, ex. `S03E05`).

**Filme** (`src/lib/media/movie-watch.ts`) — un film încă inexistent pe Filelist la calitatea cerută poate fi pus pe urmărire din wizard; e recăutat periodic până apare. Două diferențe intenționate față de seriale: urmărirea unui film **se stinge singură** la prima descărcare reușită (altfel ar căuta la nesfârșit ceva ce deja ai), iar un film urmărit **nu e un film deținut** — rândul lui din `media` n-are `torrent_hash` și n-are `plex_rating_key`, ceea ce îl face automat invizibil în Bibliotecă, în reconcilierea Plex și în reluarea descărcărilor, fără nicio modificare acolo. Apare doar în secțiunea „Filme așteptate".

**Unde stă starea.** Urmărirea sunt patru coloane pe rândul-părinte din `media` (`auto_download`, `auto_download_quality`, `auto_download_from`, `watch_last_checked_at`), nu o tabelă paralelă. Prima încercare (`pinned_items` + `pinned_watch_*`, eliminată în migrarea v14) ținea urmărirea într-o structură legată de `media` doar prin `tmdb_id`, și de-acolo veneau toate bug-urile ei: rânduri duplicate, dedublare între două liste, descărcare de N ori pentru N useri care fixaseră același titlu. Rândul `tv_show` e deja unic per serial și deja legat de episoade prin `parent_id`.

**Cadența** per titlu — 3h la seriale, 12h la filme — stă în DB, pe `watch_last_checked_at`, nu într-un timer în memorie care s-ar reseta la fiecare restart. Bucla plugin-ului doar întreabă periodic cine a expirat (la 10 min, plus un poll de 30s pentru filmele tocmai adăugate, ca prima verificare să cadă la ~1 minut după adăugare).

Tot în ticul acestui plugin: completarea numelor de episoade lipsă din TMDB (`fillMissingEpisodeTitles`) și reîmprospătarea metadatelor de serial (`refreshShowMetadata` — `tv_status`, următorul episod, plus ora exactă de la TVmaze, pe care TMDB n-o dă).

---

## Backup și retenție

**Backup-ul bazei** (`src/lib/system/db-backup.ts`, `server/plugins/db-backup.ts`) — `data/faikkitbox.db` ține absolut tot: bibliotecă, conturi, jurnal, abonamente push. Copia se face cu **`VACUUM INTO`**, nu cu `cp`: baza rulează în mod WAL, deci o copiere de fișier ar prinde un `.db` fără tranzacțiile încă necheckpoint-ate. Plugin-ul rulează la +90s după pornire, apoi la 24h, cu rotație la 14 fișiere în `data/backups/`; sare peste rulare dacă ultima copie e mai nouă de 20h, altfel o zi cu multe deploy-uri ar goli rotația de istoric util. Starea (vechimea ultimei copii, număr, spațiu) e vizibilă în Tehnic, cu buton de backup manual.

**Retenție** — Jurnalul de activitate se curăță la 30 de zile (`pruneActivityLog`, la pornire și apoi zilnic); jurnalul de erori, tot la 30 de zile, plafonat la 1000 de rânduri.

---

## Sistemul de erori și observabilitate

Toate `console.warn`/`console.error` din **toată aplicația** — server functions, SSR, plugin-uri de fundal, cod client — sunt captate automat și afișate în widget-ul **„Erori aplicație"** din Tehnic, fără să fie nevoie de un apel manual la fiecare loc din cod.

| Componentă | Rol |
|---|---|
| `src/lib/errors/console-capture.ts` | Suprascrie `console.error`/`console.warn` server-side, trimite spre `logError()`. Instalată idempotent din `server.ts` și fiecare plugin de fundal. |
| `src/lib/errors/client-error-capture.ts` | Echivalentul pentru browser, trimite spre `logClientError()` (server function, cu rate-limit per IP). Instalat din `__root.tsx`, alături de listenere `window.onerror`/`unhandledrejection`. |
| `src/lib/errors/error-log.ts` | Nucleul: grupare, rate-limit, retenție, notificare. Server-only. |
| `src/lib/errors/error-log.functions.ts` | Server functions (`getErrorLogs`, `clearErrorLogs`, `logClientError`) — fișierul subțire pe care îl importă clientul. |

**Grupare** — erori identice (sursă + nivel + mesaj) incrementează un contor (`×N`) pe același rând, în loc să umple jurnalul cu duplicate.

**Rate limit global** — max 60 scrieri/minut în SQLite; peste limită, o singură intrare sintetică de avertizare și logarea se suspendă temporar (protecție anti-flood, DB-ul e scris sincron).

**Retenție automată** — șterge intrări mai vechi de 30 de zile, plafonează la 1000 de rânduri.

**Notificare** — la apariția unui tip **nou** de eroare (nu la repetări), intră automat în Jurnalul de Activitate (categorie `app_error`) și trimite push — rate-limitat separat (max 5/10 min), ca o cascadă de erori diferite să nu spameze telefonul.

**UI** (`ErrorLogSection.tsx`) — nivel warn/error colorat distinct, căutare text, filtru pe sursă (Server/SSR/Browser), contor de erori necitite pe buton (persistat în `localStorage`).

Avertismentele proprii ale Node.js (`ExperimentalWarning` etc.) sunt filtrate din captare — nu sunt erori ale aplicației.

---

## Securitate

- **Toate server function-urile cer autentificare**, cu două excepții intenționate: `getAdminStatus` (clientul trebuie să poată afla că *nu* e logat) și `getVapidPublicKey` (cheie publică prin definiție). Gardul e `requireAuth()` (orice cont aprobat) sau `requireAdmin()`, ca primă instrucțiune din handler — nu în client, unde poate fi ocolit.
- **Sesiunile se validează în baza de date la fiecare cerere.** `requireAuth`/`requireAdmin` (și `/api/plex-thumb`, și `getAdminStatus`) verifică prin `liveAccount()` că rândul din `users` există și e `approved`, apoi citesc rolul de acolo. Cookie-ul e semnat și ține 7 zile, deci fără verificarea asta „revocă accesul" din pagina Utilizatori nu revoca nimic pentru sesiunile deja emise, iar o retrogradare din admin rămânea fără efect până la expirare. Statement-ul e pregătit o singură dată — verificarea rulează pe fiecare cerere, inclusiv pe fiecare poster.
- **Headere de securitate** pe toate răspunsurile, din `routeRules` (`vite.config.ts`, constanta `SECURITY_HEADERS`): `X-Frame-Options: DENY` + `frame-ancestors 'none'` (clickjacking peste butoanele de ștergere), `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS. **CSP-ul e deocamdată `Report-Only`** — SSR-ul injectează script și stiluri inline, iar o politică aplicată direct ar albi pagina; se trece pe aplicat după ce consola browserului rămâne curată.
- **Rate limiting** pe autentificare (15 încercări/IP și 8/utilizator la 15 min, contorul se stinge la login reușit) și pe înregistrare (6/IP pe oră). Înregistrarea interoghează lista de prieteni Plex, deci fără limită ar fi și un oracol de enumerare.
- **`/api/plex-thumb`** acceptă o singură formă de cale, pe **listă albă** (`/library/metadata/<id>/<tip>/<ts>`), nu o filtrare de `..`. `fetch()` normalizează `/library/../x` la `/x` înainte de a emite cererea, deci un `startsWith("/library/")` era ocolibil și transforma ruta într-un proxy autentificat către întreg API-ul Plex. Blacklist-urile de path traversal se ocolesc; forma nu.
- **Codul server nu ajunge în bundle-ul public.** Vezi regula `*.functions.ts` de mai jos. Verificare după orice refactor:

  ```bash
  grep -l "__vite-browser-external" .output/public/assets/*.js   # trebuie să nu întoarcă nimic
  ```

- **Secretele nu ajung niciodată în bundle** — build-ul înlocuiește `process.env` cu `{}` în codul de client. Verificare: caută valorile din `.env` în `.output/public/`.

### Privilegiile procesului

Serviciul rulează sub contul de sistem **`faikkitbox`** (grup `media`), nu ca root. Drepturile de sistem vin dintr-o listă sudoers cu comenzi fixe — exact cele din `agent.functions.ts` și `network-link.ts`, cu `ethtool` fixat pe interfața reală. O comandă nouă în pagina Tehnic trebuie adăugată și în `deploy/hardening/faikkitbox.sudoers`, altfel eșuează cu „not allowed".

Scrierea în bibliotecă (subtitrări, ștergeri) merge prin grupul `media`: `/media/ssd2tb` e `setgid` + scriibil de grup, iar qBittorrent pornește cu `Group=media` și `UMask=0002`, deci fișierele descărcate ies `root:media`.

Peste asta, un drop-in systemd (`deploy/hardening/hardening.conf`) restrânge procesul: `PrivateTmp`, `ProtectClock`, `ProtectControlGroups`, `ProtectKernelLogs`, `ProtectHostname`, `LockPersonality`, `RestrictRealtime`, familii de socket-uri limitate.

**Limita cunoscută:** `NoNewPrivileges` nu poate fi activat (sudo e setuid), iar `ProtectSystem` nici atât, cât timp pagina Sistem poate rula `apt-get upgrade` — apt scrie în `/usr` și `/var`. Prin sudo, `apt-get upgrade` e practic echivalent cu root deplin: orice pachet rulează scripturi la instalare. Contul dedicat limitează daunele și accesul la fișiere, dar nu blochează un atacator care ajunge să execute cod în aplicație. Detalii și pașii pentru etanșare: `deploy/hardening/README.md`.

---

## Performanță și date live

**Cache partajat pe server** (`cachedAsync`, `src/lib/services/shared.ts`) — statisticile live sunt cerute des, iar fără cache fiecare tab deschis producea propriul set de apeluri. Acum N clienți costă cât unul. Cererile concurente pe aceeași cheie primesc aceeași promisiune; eșecurile nu se cachează.

Pentru datele scumpe și lent-schimbătoare (`si.processes()`, statistici Docker) se folosește `staleWhileRevalidate`: la expirare se servește imediat valoarea veche și se reîmprospătează în fundal, ca nicio cerere de utilizator să nu plătească recalcularea.

**Ritm reglabil** — `src/lib/refresh-rate.ts`, cu widget în pagina Sistem (1s…30s, salvat per dispozitiv în `localStorage`). În `queries.ts`, `refetchInterval` e o **funcție**, evaluată la fiecare tick, deci schimbarea are efect imediat, fără reîncărcare.

**Ce curge, curge local.** Un ceas nu trebuie cerut de la server ca să fie corect: uptime-ul (`use-live-counter.ts`) și poziția de redare a sesiunilor Plex (`useLiveViewOffsets.ts`) sunt interpolate în client — reținem valoarea primită plus momentul primirii, adăugăm timpul scurs, ne resincronizăm la fiecare răspuns. Zero cereri în plus, ceas care avansează la secundă indiferent de cadența sursei (Plex raportează progresul în trepte de ~10s).

**Plex se contactează pe LAN.** `discoverPlexUrl` preferă `PLEX_URL` din `.env` (prioritate `-1`), nu adresele `https://…plex.direct` de la plex.tv. Măsurat pe `/status/sessions`: ~0.4ms direct pe LAN vs ~539ms prin `plex.direct` (rezolvare DNS + handshake TLS la fiecare cerere). Rămâne o preferință, nu o obligație — fiecare candidat e validat înainte de a fi acceptat, deci dacă adresa e greșită se cade automat pe descoperire.

---

## Stack tehnic

- [React 19](https://react.dev/) + [TanStack Start](https://tanstack.com/start) / [TanStack Router](https://tanstack.com/router) / [TanStack Query](https://tanstack.com/query)
- [Vite](https://vitejs.dev/) + [Nitro](https://nitro.build/) (preset `node-server`)
- [Tailwind CSS v4](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/) (doar componentele efectiv folosite — dialog, drawer, progress, sonner, button)
- [systeminformation](https://www.npmjs.com/package/systeminformation) — metrici sistem
- SQLite nativ (`node:sqlite`, Node.js 22.5+) — fără ORM
- [Vitest](https://vitest.dev/) — teste pe logica pură (urmărire seriale, reducer-ul și derivările wizard-ului, unirea vizionărilor recente, dimensionarea posterelor)
- TypeScript, ESLint, Prettier

---

## Structură proiect

Inventar complet, fișier-cu-fișier (ce conține + cine îl folosește), în **[`STRUCTURE.md`](./STRUCTURE.md)** — document viu, actualizat pe măsură ce codul se schimbă. Pe scurt:

```
src/
  components/         componente UI reutilizabile (AppHeader, BottomNav, gauge-uri...)
    biblioteca/         componente pagina Bibliotecă
    principala/         wizard-ul de adăugare titlu (shell + wizard/: reducer,
                        funcții pure, un fișier per pas)
    filelist/           căutare manuală Filelist + piese partajate cu wizard-ul
    descopera/          componente pagina Descoperă
    tehnic/             componente paginile Tehnic/Utilizatori
    sistem/             componente pagina Sistem (reglaj ritm reîmprospătare)
    ui/                 componente shadcn/ui
  hooks/              hook-uri React custom
  lib/                funcții server, organizate pe domeniu
    auth/               autentificare, conturi, legătură Plex
    media/              tabela `media` (upsert, backfill din Plex) +
                        urmărirea automată (show-watch.ts, movie-watch.ts)
    errors/             captare erori server+client, jurnal
    notifications/       conținut notificări push
    services/           Plex, Immich, qBittorrent, Host — agregare status dashboard
    filelist/           căutare unificată, download+upload qBittorrent, jurnal,
                        subtitrări, scoring de release (release-scoring.ts)
    system/             metrici host, agent de comenzi, legătură Ethernet,
                        speedtest, backup DB
    tvmaze/             ora exactă de difuzare a unui episod (supliment TMDB)
    wizard-check.functions.ts
                        verificarea completă a unui titlu, într-o cerere
    refresh-rate.ts     ritmul statisticilor live, reglabil per dispozitiv
    *.functions.ts      server functions TanStack — fișiere SUBȚIRI, fără
                        importuri server statice (vezi nota de mai jos)
  routes/             pagini: index, descopera, biblioteca, immich, qbit, sistem,
                      tehnic, users, login, register
server/
  plugins/            plugin-uri Nitro (fundal): activity-boot, filelist-resume,
                      plex-link-reconciler, plex-session-tracker,
                      show-watcher, db-backup, github-commit-tracker,
                      fast-shutdown
  routes/             rute API: GitHub webhook, SSE auto-reload, proxy thumbnail-uri Plex
deploy/
  hardening/          unit systemd, listă sudoers și scripturi pentru contul
                      dedicat sub care rulează serviciul (vezi Securitate)
public/               assets statice, Service Worker
```

---

## Configurare

Copiază `.env.example` în `.env` și completează valorile:

```bash
cp .env.example .env
```

| Variabilă | Descriere |
|---|---|
| `ADMIN_USER` / `ADMIN_PASS` | Credențiale login admin dashboard |
| `SESSION_SECRET` | Secret sesiune admin (min. 32 caractere, ex: `openssl rand -hex 32`) |
| `PLEX_URL` / `PLEX_TOKEN` | URL și token server Plex |
| `IMMICH_URL` / `IMMICH_API_KEY` | URL și cheie API Immich |
| `QBIT_URL` / `QBIT_USERNAME` / `QBIT_PASSWORD` | URL și credențiale WebUI qBittorrent |
| `FILELIST_USERNAME` / `FILELIST_PASSKEY` | Credențiale API FileList.io |
| `TMDB_API_KEY` | Token Bearer JWT pentru API TMDB (themoviedb.org) |
| `OPENSUBTITLES_API_KEY` | Cheie API OpenSubtitles.com, pentru subtitrare română automată când torrentul nu are niciuna (cont gratuit → profil → „API Consumers") |
| `OPENSUBTITLES_USERNAME` / `OPENSUBTITLES_PASSWORD` | *(opțional)* Login OpenSubtitles, doar dacă limita de download anonimă devine insuficientă |
| `SUBSRO_API_KEY` | Cheie API subs.ro, sursă de rezervă pentru subtitrări când OpenSubtitles nu are o potrivire exactă de sursă/rezoluție |
| `MEDIA_MOVIES_PATH` / `MEDIA_SERIES_PATH` | Căi locale unde qBittorrent salvează filmele/serialele din Filelist |
| `GITHUB_REPO` | Repo GitHub (ex: `Faicu/FaikkitBox`) pentru tracking commits |
| `GITHUB_TOKEN` | *(opțional)* Token GitHub API pentru limită mai mare la request-uri |
| `GITHUB_WEBHOOK_SECRET` | Secret pentru validarea webhook-urilor GitHub |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Chei VAPID pentru notificări web push |
| `PLEX_COMPOSE_FILE` / `IMMICH_COMPOSE_FILE` | *(opțional)* Căi custom `docker-compose.yml` pentru butoanele de restart |
| `SPEEDTEST_BIN` | *(opțional)* Cale completă binar `speedtest` (util dacă snap nu rulează din systemd) |
| `PORT` | Port server (implicit `3000`) |
| `NODE_ENV` | Mediu de rulare (`production` în producție) |
| `NODE_OPTIONS` | *(opțional)* `--disable-warning=ExperimentalWarning` — suprimă avertismentul Node pentru `node:sqlite`, fără să ascundă alte avertismente (ex. deprecation la upgrade de Node) |
| `FAIKKITBOX_DB_PATH` | *(opțional)* Cale custom pentru fișierul SQLite (implicit `/opt/faikkitbox/data/faikkitbox.db`) |

> **Nu comite niciodată `.env` în git.**

---

## Instalare și dezvoltare

```bash
npm install

npm run dev        # development
npm run build      # build producție
npm run preview    # preview build local

npm run test        # vitest (o rulare)
npm run test:watch  # vitest, mod watch

npm run lint        # ESLint
npm run lint -- --fix
npm run format       # Prettier
```

Pornire directă după build:

```bash
node .output/server/index.mjs
```

---

## Deploy

```bash
sudo systemctl stop faikkitbox        # 1. oprește serviciul ÎNAINTE de build
npm run build                         # 2. rulează tsc --noEmit, apoi vite build
sudo chown -R faikkitbox:media .output  # 3. build-ul rulat ca root lasă fișiere root
git add <fișiere> && git commit       # 4.
sudo systemctl start faikkitbox       # 5. repornește cu build-ul nou
```

**Push-ul către GitHub NU e automat** — commit-urile locale rămân nepublicate până când utilizatorul apasă butonul dedicat din pagina Tehnic (`pushToGitHub`, `src/lib/github.functions.ts`). E intenționat, nu o eroare de urmărit sau reparat — vezi `CLAUDE.md`.

`npm run build` = `tsc --noEmit && vite build && <marcaj de deploy>`. Verificarea de tipuri acoperă și `server/` (inclusiv plugin-urile și rutele API), care înainte nu erau în `tsconfig.json` deloc. Marcajul scris la final e consumat la prima pornire de după, ca deploy-urile să apară în Jurnalul de Activitate cu cauza corectă, fără push.

**De ce oprire înainte de build, nu doar la final:** `npm run build` scrie direct peste `.output/server/`, folosit de procesul live pentru chunk-uri SSR încărcate dinamic. Dacă serviciul rulează în timpul build-ului, o cerere poate nimeri exact în fereastra în care fișierele vechi au fost deja șterse/redenumite, dând `ERR_MODULE_NOT_FOUND` — a apărut recurent în istoric înainte de acest fix.

**De ce shutdown-ul e rapid și curat:** `server/plugins/fast-shutdown.ts` forțează ieșirea la 300ms după `SIGTERM`/`SIGINT`. Fără el, conexiunea SSE de auto-reload (`server/routes/api/deploy-sha.ts`, ține un tab de browser „la curent" cu restart-urile) ar ține procesul viu peste `TimeoutStopSec` din unitatea systemd, care oricum ar termina cu `SIGKILL` — un kill necurat, fără nicio garanție că apucă să ruleze codul de cleanup (ex. logarea opririi în Jurnalul de Activitate).

---

## Note tehnice pentru dezvoltare

Secțiune orientată spre a face modificări corecte rapid, nu spre a documenta fiecare fișier — pentru inventarul complet, vezi [`STRUCTURE.md`](./STRUCTURE.md).

### Arhitectură — TanStack Start, nu Next.js

Rutele NU sunt în `src/app/`, ci în `src/routes/*.tsx`, definite cu `createFileRoute("/cale")({ component, head, ... })`. Fiecare fișier de rută = o pagină. `src/routes/__root.tsx` e layout-ul rădăcină (providers, shell global, captare erori client).

Logica de server (DB, fetch extern, fișiere, comenzi shell) trăiește în `src/lib/*.functions.ts`, ca `createServerFn`:

```ts
export const getSomething = createServerFn({ method: "GET" })
  .validator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    /* rulează doar pe server */
  });
```

În componente client, se apelează fie direct (SSR/loader), fie prin `useServerFn(fn)` din `@tanstack/react-start` când e nevoie într-un event handler (`onClick` etc.). Handler-ele `.handler()` pot `await import(...)` module server-only (ex. `admin.server.ts`) ca să nu ajungă în bundle-ul client.

Plugin-urile de fundal (`server/plugins/*.ts`) nu au acces la request context — funcțiile server-only pe care le folosesc trebuie să aibă și o variantă „internă" (plain function, fără `createServerFn`), apelată prin `await import(...)` dinamic. Vezi `checkFilelistForItemInternal`, `getTmdbSeasonEpisodesInternal`, `checkShow`/`checkMovie`. Nitro încarcă `server/plugins/*.ts` și montează `server/routes/api/*.ts` **prin convenție de folder**, nu prin import explicit — un grep obișnuit nu le arată ca "folosite" din restul codului; e normal.

### TanStack Query — convenția `queryOptions`

Toate query-urile refolosite în mai multe componente sunt definite **o singură dată** ca `queryOptions(...)` în `src/lib/queries.ts` (queryKey, queryFn, staleTime, refetchInterval), și importate cu `useQuery(xQuery)` oriunde e nevoie. **Nu duplica un query inline cu același `queryKey`** dacă poate fi definit în `queries.ts` — o divergență aici produce cache desincronizat între pagini.

Pattern de invalidare după mutație:

```ts
await someMutationServerFn({ data: ... });
queryClient.invalidateQueries({ queryKey: ["cheia"] });
```

Pentru liste ce se încarcă incremental (ex. `DiscoverGrid`), se folosește `useInfiniteQuery` cu `initialPageParam`/`getNextPageParam`, nu paginare manuală cu state.

### Domenii principale în `src/lib/`

Vezi [`STRUCTURE.md`](./STRUCTURE.md) pentru lista completă, fișier cu fișier. Câteva invarianti importante de reținut:

- **Filelist** — `categories.ts` are `isMovieCategory`/`MOVIE_CATEGORIES`/`SERIES_CATEGORIES`, **nu reimplementa** verificarea film/serial în altă parte. `checkFilelistForItemInternal` (`filelist/filelist-client.ts`) e **sursa unică** pentru „există pe Filelist?" — nu duplica logica de căutare/matching, și nu vorbi cu API-ul Filelist din altă parte. `plex-refresh.ts` e **singurul** punct care declanșează rescan Plex.
- **Erori aplicație** — nu adăuga apeluri `logError()` manuale lângă un `console.warn`/`console.error` — captarea globală le prinde deja automat; ar produce intrări duplicate.
- **TMDB** — `getTmdbDetails` întoarce și `literalTitle` (din `alternative_titles`, `type: "literal title"`) — folosește-l pentru orice căutare externă (Filelist), nu `originalTitle` brut, care rămâne în scriptul nativ pentru producții non-latine. TMDB cache-uiește răspunsuri per URL exact — cererile pentru episoade au cache-bust explicit, altfel un episod difuzat recent poate rămâne cu placeholder generic ore bune după ce TMDB are deja titlul real.
- **`media` (db.ts)** — sursa unică de adevăr pentru bibliotecă. Conține conținut real (descărcat sau backfill din Plex), plus urmărirea, ca patru coloane pe rândul-părinte — **nu** ca tabelă paralelă: exact structura paralelă (`pinned_*`) a fost sursa unei clase întregi de bug-uri și a fost eliminată. Singura excepție de la „conținut real" e filmul urmărit, care are un rând fără `torrent_hash` și fără `plex_rating_key` — și tocmai de-asta rămâne invizibil peste tot unde se cere una dintre cele două coloane. Dacă ai nevoie de un flux nou de intenție/monitorizare, extinde rândul existent, nu crea o structură lângă el. Tabela `downloads` a fost eliminată în migrarea v25: nu mai există un jurnal separat de descărcări.
- **`*.functions.ts` — fără importuri server statice.** Corpul unui handler `createServerFn` e eliminat din bundle-ul de client, deci un `await import("./x")` din interiorul lui rămâne pe server; un import static la vârful fișierului trage tot graful în bundle-ul public. De aceea logica stă în `media.ts` / `activity-log.ts` / `error-log.ts` / `filelist/download.ts` / `system/network-link.ts` / `system/speedtest.ts` / `system/db-backup.ts`, iar definițiile de server functions în perechile lor `*.functions.ts`. Nerespectarea regulii a servit public schema SQLite completă și a produs eroarea `(0 , n.dirname) is not a function`, rămasă luni de zile neexplicată.
- **Munca de la pornirea serverului se declanșează din `server/plugins/`**, nu dintr-un `setTimeout` la nivel de modul. Un efect de modul rulează doar dacă cineva importă modulul, iar asta depinde de grafuri de import care se schimbă la refactorizări — două bug-uri identice au fost cauzate exact de asta (logarea pornirii/opririi rula abia la prima cerere HTTP; reluarea polling-urilor a încetat complet să mai ruleze după un refactor de bundle).
- **Munca de pornire care atinge rețeaua nu are ce căuta într-o migrare.** Migrarea rulează sincron, în tranzacție, și e fatală la eșec — un apel Plex picat ar bloca pornirea. Pentru „o singură dată pe instalare, dar cu rețea", folosește tabela `one_time_jobs` și declanșează din plugin (vezi `redetectQualitiesOnce`).
- **Migrările sunt tranzacționale și fatale la eșec** — `runCleanups` rulează în `BEGIN`/`COMMIT`, iar o eroare oprește pornirea. Înainte, un `catch` cu `console.warn` lăsa aplicația să pornească cu schemă parțială. O migrare nouă trebuie să fie idempotentă și să verifice că tabela sursă chiar există (v9 nu o făcea și lăsa o tabelă orfană pe orice instalare nouă).
- **DB** — SQLite nativ (`node:sqlite`), un singur fișier la `/opt/faikkitbox/data/faikkitbox.db` (override cu `FAIKKITBOX_DB_PATH`). Fără ORM/migrations tool — schema se creează cu `CREATE TABLE IF NOT EXISTS`, migrările incrementale via `PRAGMA user_version` (`runCleanups` în `db.ts`); orice schimbare de schemă se adaugă acolo, niciodată prin modificarea unei migrări deja aplicate.

### Puncte de refolosit în componente

- `src/components/filelist/quality-utils.ts` — `detectQuality(name)` (cele cinci categorii exclusive), `emptyQualitySet`, `groupTorrentsBySeasonEpisode`. Orice logică nouă de parsare a numelui de torrent ar trebui să treacă prin aici, nu regex inline în componente. O treaptă nouă de calitate se adaugă în șase locuri care trebuie să rămână în acord: `QualitySet` (`components/filelist/types.ts`), `detectQuality`, `detectTorrentQuality` (`lib/media/torrent-quality.ts`), `QUALITY_RANK` și tipul `WatchQuality` (`wizard/selection.ts`, `wizard/WizardControls.tsx`), selectorul de calitate din wizard, și filtrele din `FilelistSection.tsx`.
- `src/components/filelist/DownloadConfirmDialog.tsx` — dialogul standard de confirmare descărcare, inclusiv butonul „Info Căutare". Orice buton nou de download ar trebui să treacă prin el, nu să descarce direct.
- `src/components/filelist/use-download.ts` — `useDownload()` (upload qBittorrent + toast + invalidare cache).
- **Confirmările distructive se fac inline**, nu cu `AlertDialog`/`Dialog` Radix și nici cu `window.confirm()`. Wrapper-ul `ui/alert-dialog.tsx` a fost eliminat (21 sept. 2026): imbricat într-un `Drawer` vaul îngheța ecranul fără nicio eroare logată (vezi commit `c76ce30`). Modelul de urmat: overlay-ul simplu din `BibliotecaList.tsx` sau confirmarea inline din `PushSubscriptionsSection.tsx`.
- Pagina Descoperă are două moduri (`grid`/`feed`) cu componente separate (`DiscoverGrid.tsx`, `FeedView.tsx`) care share `FilterTabs`. Dacă adaugi un filtru nou, verifică dacă trebuie propagat în ambele moduri.
- `src/components/principala/AddMediaWizard.tsx` — wizard-ul de adăugare, deschis fie din Acasă, fie prefill dintr-un titlu deja identificat (prop `initialItem`, folosit din `SceneViewer.tsx`). E doar shell: starea e în `wizard/state.ts`, derivările în `wizard/derive-seasons.ts` și `wizard/selection.ts` (pure, testate), fiecare pas într-un fișier propriu. Un pas nou se adaugă în uniunea `Step`, nu ca `useState` în componentă.
- `src/components/ui/orb.tsx` — orb animat pentru o **așteptare fără capăt cunoscut** (urmărire activă, procesare în Plex, descărcare fără procent). Pentru confirmarea unui clic rămâne `Loader2` — un orb acolo ar promite o muncă de fundal care nu există.
- `src/hooks/use-flash-on-change.ts` — micro-flash pe o valoare tocmai schimbată (clasa `tick-flash`). Nu se declanșează la prima randare, ca flash-ul să însemne ceva.
- Drawer-uri de detalii (rând apăsabil → panou cu informații suplimentare + acțiuni) urmează modelul `CommitDrawer.tsx`/`SubtitleFixDrawer.tsx`/`UserDetailDrawer.tsx` (Tehnic/Utilizatori) și `TitleDetailDrawer.tsx` (Bibliotecă) — `Drawer`/`DrawerContent`/`DrawerHeader`/`DrawerTitle` din `components/ui/drawer.tsx`, stare `selected*` în componenta părinte, nu în drawer.

### Workflow obligatoriu

Vezi `CLAUDE.md` la rădăcina proiectului — orice modificare de cod trebuie urmată de secvența completă din [Deploy](#deploy) (stop → build → commit → start) înainte de a considera o sarcină finalizată. Push-ul rămâne manual, din Tehnic.
