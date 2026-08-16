# FaikkitBox

**Dashboard personal de monitorizare și control pentru serverul de acasă.**

Un singur ecran pentru Plex, Immich, qBittorrent, sistemul de operare și descoperirea/adăugarea de filme și seriale — cu notificări push, jurnal de activitate și captare automată a erorilor.

Construit cu [TanStack Start](https://tanstack.com/start) (React 19 + TanStack Router/Query), rulează ca server Node prin Nitro, în spatele unui reverse proxy (nginx) pe Ubuntu.

---

## Cuprins

- [Funcționalități](#funcționalități)
- [Autentificare și conturi](#autentificare-și-conturi)
- [Adăugare și urmărire titluri](#adăugare-și-urmărire-titluri)
- [Sistemul de erori și observabilitate](#sistemul-de-erori-și-observabilitate)
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
| **Bibliotecă** (`/biblioteca`) | Cont aprobat | Tot ce e descărcat prin aplicație sau deja existent în Plex (backfill) — căutare, grupare pe serial, detalii per titlu (calitate, subtitrare RO, cine a văzut), corectare/ștergere subtitrare, ștergere completă (admin/cel care a adăugat). |
| **qBittorrent** (`/qbit`) | Cont aprobat | Viteze download/upload, torrente active/total, filtre pe stări, căutare în listă, pauză/reluare (global sau individual), ștergere torrent + fișiere. |
| **Immich** | Admin | Număr fișiere, spațiu ocupat, coadă de joburi active. |
| **Sistem** | Admin | CPU, memorie, swap, uptime, discuri (viteze read/write), rețea, senzori temperatură, top procese și top I/O disc, aplicații monitorizate, mentenanță (update Ubuntu, restart servicii). |
| **Tehnic** | Admin | Control serviciu Plex (restart/actualizare), speedtest (test nou + istoric grafic), status plugin-uri server, statistici commit-uri, jurnal de activitate, **widget Erori aplicație** (vezi mai jos), push manual către GitHub. |
| **Utilizatori** (`/users`) | Admin | Cereri de aprobare cont, listă conturi (admin + obișnuite), click pe orice cont deschide detalii complete (contact, legătură Plex, descărcări inițiate, activitate Plex, istoric autentificări). |

Alte capabilități transversale:

- **Notificări push** — web push pentru commit-uri GitHub, torrente adăugate/complete, cereri noi de aprobare cont, și erori noi ale aplicației. Funcționează fără browser deschis; recuperează automat notificările pierdute în timpul unui restart.
- **Verificare versiuni** — indicator Plex/Immich (actualizat / necesită update) în header-ul fiecărei pagini de serviciu, cu acțiune de restart pentru containerul Docker.
- **Autentificare multi-rol** — vezi secțiunea următoare.

---

## Autentificare și conturi

Sistem cu două roluri, o singură tabelă `users` (nu conturi separate pentru admin/user):

| Rol | Cum se obține | Acces |
|---|---|---|
| **Admin** | Creat manual de un alt admin, din pagina Utilizatori (`addAdminUser`). Aprobat automat (`status='approved'`). | Toate paginile. |
| **User obișnuit** | Auto-înregistrare publică (`/register`) + aprobare manuală de admin. | Acasă (public oricum), Descoperă, Bibliotecă, qBittorrent (fără căutarea manuală Filelist și alegerea manuală a torrentului, admin-only) — vezi tabelul de mai sus. |

**Înregistrare** (`registerUser`, `src/lib/registration.functions.ts`) — formular Username/Parolă/Email/Telefon (WhatsApp). Username-ul **sau** email-ul introdus trebuie să corespundă unui cont din biblioteca Plex (`matchPlexAccount`, `src/lib/plex-users.server.ts` — interoghează `plex.tv/api/users`, parsat manual din XML, cache 5 min; API-ul ignoră `Accept: application/json`), altfel cererea e respinsă direct, cu mesaj clar. Contul creat intră cu `status='pending'` — nu poate face login până nu e aprobat. Fiecare cerere nouă generează automat o intrare `account_request` în Jurnalul de activitate + notificare push.

**Aprobare** (`/users`, pagina Utilizatori) — admin vede cererile pending cu detalii (contact + legătura Plex găsită) și poate Aproba sau Respinge (respingerea șterge direct rândul — nu există status `rejected`). Orice cont existent poate fi „revocat" (șters) din secțiunea Utilizatori aprobați.

**Login unificat** (`/login`) — aceeași pagină și logică pentru admin și utilizatori obișnuiți; `adminLogin` verifică username+parolă în `users` fără filtrare pe rol, respinge conturile `pending`. Fiecare login reușit scrie un rând în `user_logins` (dată, IP, user-agent) + actualizează `users.last_login_at` — istoric vizibil în pagina de detalii a contului.

**Doi guarzi de rută**, exportați din `src/lib/admin-route-guard.ts`:

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

Wizard-ul de adăugare (`AddMediaWizard.tsx`) — accesibil din butonul „Adaugă film/serial" de pe Acasă, sau direct dintr-un titlu deja deschis în Descoperă (`SceneViewer.tsx`) — face totul într-un flux: căutare TMDB → verificare Plex + Filelist (un singur request batched pentru toate sezoanele unui serial, `getTmdbAllSeasons`) → alegere calitate (1080p implicit, restul ascunse sub un toggle, admin-only) → confirmare și descărcare. Pentru seriale, fiecare sezon/episod arată statusul lui (în Plex / se descarcă / disponibil pe Filelist / indisponibil / nelansat încă), iar descărcarea respectă ce oferă efectiv Filelist — pachet de sezon întreg sau episod individual, nu presupune una din ele.

**Bibliotecă** (`/biblioteca`) arată tot ce există efectiv — descărcat prin aplicație sau deja în Plex dinainte de acest sistem (backfill) — citit direct din tabela `media`, fără cereri Plex/TMDB live la navigare. Fiecare titlu are un drawer de detalii cu subtitrare RO, cine a văzut, și acțiuni (corectare/ștergere subtitrare, ștergere completă) pentru cel care l-a adăugat sau pentru admin.

### Descărcare de pe Filelist

Căutarea „există pe Filelist?" e **unificată** într-o singură sursă de adevăr (`checkFilelistForItemInternal`, `src/lib/filelist/download.ts`), folosită atât de wizard cât și de căutarea manuală (`FilelistSection`, admin, de pe Acasă).

Caută secvențial, se oprește la primul rezultat:

1. **IMDB ID** — cel mai fiabil, funcționează indiferent cum e denumită lansarea pe scenă.
2. **Titlul original literal** — romanizarea reală (ex. „Gunche"), luată din TMDB `alternative_titles` (`type: "literal title"`), **nu** `original_title` brut (care rămâne în scriptul nativ, ex. „군체", inutil ca text de căutare).
3. **Titlul englez/internațional**.

Fiecare rezultat păstrează `matchedVia` (prin ce criteriu a fost găsit) și `matchedByImdb` — vizibile prin butonul **„Info Căutare"** din dialogul de confirmare descărcare (`DownloadConfirmDialog.tsx`).

### Subtitrare română automată (`src/lib/filelist/subtitles.ts`)

La finalul fiecărei descărcări (înainte de refresh-ul Plex), `ensureRomanianSubtitle` verifică automat:

1. **Fișierul media are deja subtitrare română încorporată?** — detectat cu `ffprobe` (dacă e instalat pe server; dacă lipsește, se sare peste acest pas, nu blochează). Dacă da, nu mai face nimic.
2. **Există un `.srt` în torrent, dar cu denumire greșită pentru Plex?** — Plex identifică limba unei subtitrări externe după numele fișierului (`<nume-media>.ro.srt`), nu după conținut. Dacă torrentul conține exact un `.srt`, conținutul e verificat întâi (diacritice ă/â/î/ș/ț ca semnal principal, cuvinte uzuale RO ca rezervă) — **nu se presupune** că e automat română doar pentru că e singurul fișier `.srt` din torrent (unele lansări vin cu subtitrare engleză bundle-uită). Dacă pare română, e **redenumit prin API-ul qBittorrent** (`torrents/renameFile`) — obligatoriu prin API, nu direct pe disk, altfel qBittorrent pierde evidența fișierului. Dacă nu pare română, e redenumit `.en.srt` (nu rămâne ambiguă pentru Plex) și se continuă la pasul 3, ca și cum n-ar fi existat niciun `.srt`.
3. **Nicio subtitrare deloc?** — se caută pe **OpenSubtitles** (`OPENSUBTITLES_API_KEY` în `.env`) după IMDb id, limba română. Din rezultate se alege cel al cărui `release` se potrivește cel mai bine cu sursa/rezoluția torrentului (ex. WEB-DL/AMZN 1080p vs BluRay 2160p) — o subtitrare pentru altă sursă desincronizează timpii de afișare. Dacă OpenSubtitles nu are o potrivire clară (sursă+rezoluție), se caută și pe **subs.ro** (`SUBSRO_API_KEY` în `.env`) — arhivele de acolo conțin adesea mai multe variante (una per sursă/rezoluție), extrase și scorate la fel; câștigă oricare din cele două surse cu potrivirea mai bună. Dacă nici așa nu există o potrivire clară, se salvează totuși cel mai apropiat rezultat, dar cu un avertisment în log ("verifică sincronizarea").

**Backfill**: butonul „Verifică subtitrări" din Bibliotecă (admin) rulează aceeași verificare retroactiv pe toate torrentele active din qBittorrent, nu doar cele din jurnalul aplicației.

### Sincronizare de fundal (`server/plugins/media-torrent-sync.ts`)

Rulează periodic, fără acțiune din UI: completează `media` cu orice titlu din Plex încă neindexat (echivalent backfill-ului manual), leagă retroactiv torrente existente din qBittorrent de rândurile `media` corespunzătoare, și verifică subtitrările pentru descărcările vechi.

Conținutul (titlu + text) notificărilor de torrent adăugat/complet trăiește în `src/lib/notifications.ts` — sursă unică, nu recalculat inline la fiecare loc care trimite o notificare.

---

## Sistemul de erori și observabilitate

Toate `console.warn`/`console.error` din **toată aplicația** — server functions, SSR, plugin-uri de fundal, cod client — sunt captate automat și afișate în widget-ul **„Erori aplicație"** din Tehnic, fără să fie nevoie de un apel manual la fiecare loc din cod.

| Componentă | Rol |
|---|---|
| `src/lib/console-capture.ts` | Suprascrie `console.error`/`console.warn` server-side, trimite spre `logError()`. Instalată idempotent din `server.ts` și fiecare plugin de fundal. |
| `src/lib/client-error-capture.ts` | Echivalentul pentru browser, trimite spre `logClientError()` (server function, cu rate-limit per IP). Instalat din `__root.tsx`, alături de listenere `window.onerror`/`unhandledrejection`. |
| `src/lib/error-log.ts` | Nucleul: grupare, rate-limit, retenție, notificare. |

**Grupare** — erori identice (sursă + nivel + mesaj) incrementează un contor (`×N`) pe același rând, în loc să umple jurnalul cu duplicate.

**Rate limit global** — max 60 scrieri/minut în SQLite; peste limită, o singură intrare sintetică de avertizare și logarea se suspendă temporar (protecție anti-flood, DB-ul e scris sincron).

**Retenție automată** — șterge intrări mai vechi de 30 de zile, plafonează la 1000 de rânduri.

**Notificare** — la apariția unui tip **nou** de eroare (nu la repetări), intră automat în Jurnalul de Activitate (categorie `app_error`) și trimite push — rate-limitat separat (max 5/10 min), ca o cascadă de erori diferite să nu spameze telefonul.

**UI** (`ErrorLogSection.tsx`) — nivel warn/error colorat distinct, căutare text, filtru pe sursă (Server/SSR/Browser), contor de erori necitite pe buton (persistat în `localStorage`).

Avertismentele proprii ale Node.js (`ExperimentalWarning` etc.) sunt filtrate din captare — nu sunt erori ale aplicației.

---

## Stack tehnic

- [React 19](https://react.dev/) + [TanStack Start](https://tanstack.com/start) / [TanStack Router](https://tanstack.com/router) / [TanStack Query](https://tanstack.com/query)
- [Vite](https://vitejs.dev/) + [Nitro](https://nitro.build/) (preset `node-server`)
- [Tailwind CSS v4](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/) (doar componentele efectiv folosite — dialog, drawer, alert-dialog, progress, sonner, button)
- [systeminformation](https://www.npmjs.com/package/systeminformation) — metrici sistem
- SQLite nativ (`node:sqlite`, Node.js 22.5+) — fără ORM
- TypeScript, ESLint, Prettier

---

## Structură proiect

Inventar complet, fișier-cu-fișier (ce conține + cine îl folosește), în **[`STRUCTURE.md`](./STRUCTURE.md)** — document viu, actualizat pe măsură ce codul se schimbă. Pe scurt:

```
src/
  components/         componente UI reutilizabile (AppHeader, BottomNav, gauge-uri...)
    biblioteca/         componente pagina Bibliotecă
    principala/         wizard-ul de adăugare titlu (deschis din Acasă/Descoperă)
    filelist/           căutare manuală Filelist + piese partajate cu wizard-ul
    descopera/          componente pagina Descoperă
    tehnic/             componente paginile Sistem/Tehnic/Utilizatori
    ui/                 componente shadcn/ui
  hooks/              hook-uri React custom
  lib/                funcții server, organizate pe domeniu
    services/           Plex, Immich, qBittorrent, Host — agregare status dashboard
    filelist/           căutare unificată, download+upload qBittorrent, jurnal, subtitrări
    *.functions.ts      server functions TanStack (admin, github, push, tmdb...)
  routes/             pagini: index, descopera, biblioteca, immich, qbit, sistem,
                      tehnic, users, login, register
server/
  plugins/            plugin-uri Nitro (fundal): media-torrent-sync, plex-session-tracker,
                      github-commit-tracker, fast-shutdown
  routes/             rute API: GitHub webhook, SSE auto-reload, proxy thumbnail-uri Plex
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
sudo systemctl stop faikkitbox   # 1. oprește serviciul ÎNAINTE de build
npm run build                    # 2. verifică că build-ul trece fără erori
git add <fișiere> && git commit  # 3.
sudo systemctl start faikkitbox  # 4. repornește cu build-ul nou
```

**Push-ul către GitHub NU e automat** — commit-urile locale rămân nepublicate până când utilizatorul apasă butonul dedicat din pagina Tehnic (`pushToGitHub`, `src/lib/github.functions.ts`). E intenționat, nu o eroare de urmărit sau reparat — vezi `CLAUDE.md`.

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

Plugin-urile de fundal (`server/plugins/*.ts`) nu au acces la request context — funcțiile server-only pe care le folosesc trebuie să aibă și o variantă „internă" (plain function, fără `createServerFn`), apelată prin `await import(...)` dinamic. Vezi `checkFilelistForItemInternal`, `runSubtitleBackfillIfIdle`, `runMediaBackfillIfIdle`, `getTmdbSeasonEpisodesInternal`. Nitro încarcă `server/plugins/*.ts` și montează `server/routes/api/*.ts` **prin convenție de folder**, nu prin import explicit — un grep obișnuit nu le arată ca "folosite" din restul codului; e normal.

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

- **Filelist** — `categories.ts` are `isMovieCategory`/`MOVIE_CATEGORIES`/`SERIES_CATEGORIES`, **nu reimplementa** verificarea film/serial în altă parte. `checkFilelistForItemInternal` (`filelist/download.ts`) e **sursa unică** pentru „există pe Filelist?" — nu duplica logica de căutare/matching. `plex-refresh.ts` e **singurul** punct care declanșează rescan Plex.
- **Erori aplicație** — nu adăuga apeluri `logError()` manuale lângă un `console.warn`/`console.error` — captarea globală le prinde deja automat; ar produce intrări duplicate.
- **TMDB** — `getTmdbDetails` întoarce și `literalTitle` (din `alternative_titles`, `type: "literal title"`) — folosește-l pentru orice căutare externă (Filelist), nu `originalTitle` brut, care rămâne în scriptul nativ pentru producții non-latine. TMDB cache-uiește răspunsuri per URL exact — cererile pentru episoade au cache-bust explicit, altfel un episod difuzat recent poate rămâne cu placeholder generic ore bune după ce TMDB are deja titlul real.
- **`media` (db.ts)** — conține STRICT conținut real (descărcat sau backfill din Plex); un titlu doar căutat, fără nimic descărcat, nu are niciun rând acolo. Nu adăuga un flux nou care creează rânduri `media` doar pentru intenție/monitorizare — a fost sursa unei clase întregi de bug-uri într-o versiune anterioară (fixare/urmărire, eliminată complet).
- **DB** — SQLite nativ (`node:sqlite`), un singur fișier la `/opt/faikkitbox/data/faikkitbox.db` (override cu `FAIKKITBOX_DB_PATH`). Fără ORM/migrations tool — schema se creează cu `CREATE TABLE IF NOT EXISTS`, migrările incrementale via `PRAGMA user_version` (`runCleanups` în `db.ts`); orice schimbare de schemă se adaugă acolo, niciodată prin modificarea unei migrări deja aplicate.

### Puncte de refolosit în componente

- `src/components/filelist/quality-utils.ts` — `detectQuality(name)` (1080p/4K/4K HDR din numele torrentului), `groupTorrentsBySeasonEpisode`. Orice logică nouă de parsare a numelui de torrent ar trebui să treacă prin aici, nu regex inline în componente.
- `src/components/filelist/DownloadConfirmDialog.tsx` — dialogul standard de confirmare descărcare, inclusiv butonul „Info Căutare". Orice buton nou de download ar trebui să treacă prin el, nu să descarce direct.
- `src/components/filelist/use-download.ts` — `useDownload()` (upload qBittorrent + toast + invalidare cache).
- `src/components/ui/alert-dialog.tsx` — wrapper Radix deja stilizat; folosește-l pentru orice confirmare distructivă în loc de `window.confirm()`.
- Pagina Descoperă are două moduri (`grid`/`feed`) cu componente separate (`DiscoverGrid.tsx`, `FeedView.tsx`) care share `FilterTabs`. Dacă adaugi un filtru nou, verifică dacă trebuie propagat în ambele moduri.
- `src/components/principala/AddMediaWizard.tsx` — wizard-ul de adăugare, deschis fie din Acasă, fie prefill dintr-un titlu deja identificat (prop `initialItem`, folosit din `SceneViewer.tsx`). Reutilizează `DownloadConfirmDialog`, `detectQuality`/`groupTorrentsBySeasonEpisode`, `getTmdbAllSeasons` — nu duplică logica de căutare/descărcare.
- Drawer-uri de detalii (rând apăsabil → panou cu informații suplimentare + acțiuni) urmează modelul `CommitDrawer.tsx`/`SubtitleFixDrawer.tsx`/`UserDetailDrawer.tsx` (Tehnic/Utilizatori) și `TitleDetailDrawer.tsx` (Bibliotecă) — `Drawer`/`DrawerContent`/`DrawerHeader`/`DrawerTitle` din `components/ui/drawer.tsx`, stare `selected*` în componenta părinte, nu în drawer.

### Workflow obligatoriu

Vezi `CLAUDE.md` la rădăcina proiectului — orice modificare de cod trebuie urmată de secvența completă din [Deploy](#deploy) (stop → build → commit → start) înainte de a considera o sarcină finalizată. Push-ul rămâne manual, din Tehnic.
