# FaikkitBox

**Dashboard personal de monitorizare și control pentru serverul de acasă.**

Un singur ecran pentru Plex, Immich, qBittorrent, sistemul de operare și descoperirea/urmărirea automată a filmelor și serialelor — cu notificări push, jurnal de activitate și captare automată a erorilor.

Construit cu [TanStack Start](https://tanstack.com/start) (React 19 + TanStack Router/Query), rulează ca server Node prin Nitro, în spatele unui reverse proxy (nginx) pe Ubuntu.

---

## Cuprins

- [Funcționalități](#funcționalități)
- [Lansări — filme și seriale](#lansări--filme-și-seriale)
- [Sistemul de erori și observabilitate](#sistemul-de-erori-și-observabilitate)
- [Stack tehnic](#stack-tehnic)
- [Structură proiect](#structură-proiect)
- [Configurare](#configurare)
- [Instalare și dezvoltare](#instalare-și-dezvoltare)
- [Deploy](#deploy)
- [Note tehnice pentru dezvoltare](#note-tehnice-pentru-dezvoltare)

---

## Funcționalități

| Pagină | Ce arată |
|---|---|
| **Acasă** | Status live pentru toate serviciile într-un singur ecran: Plex, Immich, qBittorrent, gazdă, ultimul speedtest, jurnal de activitate. |
| **Plex** | Sesiuni active cu progres și stare (Redare/Pauză), episoade vizionate azi, utilizatori activi. |
| **Immich** | Număr fișiere, spațiu ocupat, coadă de joburi active. |
| **qBittorrent** | Viteze download/upload, torrente active/total, filtre pe stări, căutare în listă, pauză/reluare (global sau individual), ștergere torrent + fișiere. |
| **Sistem** | CPU, memorie, swap, uptime, discuri (viteze read/write), rețea, senzori temperatură, top procese și top I/O disc, aplicații monitorizate, mentenanță (update Ubuntu, restart servicii). |
| **Tehnic** | Speedtest (test nou + istoric grafic), status plugin-uri server, statistici commit-uri, jurnal de activitate, **widget Erori aplicație** (vezi mai jos). |
| **Descoperă** | Explorare TMDB (grid + feed video) cu status Plex și Filelist per titlu, fixare directă în Lansări. |
| **Lansări** | Căutare, monitorizare automată și descărcare filme/seriale (detalii mai jos). |

Alte capabilități transversale:

- **Notificări push** — web push pentru commit-uri GitHub, actualizări Lansări, și erori noi ale aplicației. Funcționează fără browser deschis; recuperează automat notificările pierdute în timpul unui restart.
- **Verificare versiuni** — indicator Plex/Immich (actualizat / necesită update) în header-ul fiecărei pagini de serviciu, cu acțiune de restart pentru containerul Docker.
- **Autentificare admin** — sesiune cookie-based (user/parolă + secret de sesiune) pentru funcțiile administrative.

---

## Lansări — filme și seriale

Căutare unificată (TMDB) pentru filme și seriale. Fiecare item fixat afișează poster, status Plex, descărcare de pe Filelist și, pentru seriale, countdown până la următorul episod.

### Status Plex

| Tip | Comportament |
|---|---|
| **Filme** | Badge unic — `Complet în Plex` (+ calitate) sau `Lipsă din Plex`. |
| **Seriale** | Badge cu **6 stări**, calculate în ordine de prioritate: |

| # | Stare | Când apare |
|---|---|---|
| 1 | **Episod nou disponibil** | Ultimul episod are sub 24h și încă lipsește din Plex — prioritate maximă, e temporar și urgent. |
| 2 | **Complet în Plex** | Toate sezoanele și episoadele deja apărute există în Plex. |
| 3 | **Incomplet (ultimul sezon)** | Lipsește cel puțin un episod din ultimul sezon — mai specific decât starea 5. |
| 4 | **Complet (ultimul sezon)** | Ultimul sezon e complet — nu contează dacă sezoanele anterioare lipsesc, parțial sau total. |
| 5 | **Lipsesc episoade** | Fallback generic pentru cazuri ambigue. |
| 6 | **Lipsă din Plex** | Niciun episod din serial nu există în bibliotecă. |

Logica trăiește în `src/components/lansari/plex-status.ts` (`computeTvPlexStatus`, funcție pură), randată de `PlexStatusBadge.tsx`. Căutarea Plex suportă titluri localizate (ex. „Casa Dragonului" găsit prin „House of the Dragon") și diacritice, cu fallback la parcurgerea întregii biblioteci.

### Descărcare de pe Filelist

Căutarea „există pe Filelist?" e **unificată** într-o singură sursă de adevăr (`checkFilelistForItemInternal`, `src/lib/filelist/download.ts`), folosită din 3 locuri: butonul din Descoperă, cardul din Lansări (la deschiderea „Mai multe detalii" — nu automat, ca să nu epuizeze limita orară a contului Filelist) și job-ul automat de fundal.

Caută secvențial, se oprește la primul rezultat:

1. **IMDB ID** — cel mai fiabil, funcționează indiferent cum e denumită lansarea pe scenă.
2. **Titlul original literal** — romanizarea reală (ex. „Gunche"), luată din TMDB `alternative_titles` (`type: "literal title"`), **nu** `original_title` brut (care rămâne în scriptul nativ, ex. „군체", inutil ca text de căutare).
3. **Titlul englez/internațional**.

Fiecare rezultat păstrează `matchedVia` (prin ce criteriu a fost găsit) și `matchedByImdb` — vizibile prin butonul **„Info Căutare"** din dialogul de confirmare descărcare.

**Descărcare automată**: pornește doar pentru torrente confirmate prin **IMDB ID** (`matchedByImdb === true`). Un torrent găsit doar prin potrivire de text pe titlu poate fi alt film/serial cu nume asemănător (ex. un documentar „making of" al aceluiași titlu) — prea riscant pentru o acțiune automată, fără confirmare umană.

### Job de fundal (`server/plugins/pinned-watcher.ts`)

Verifică fiecare item fixat la exact **3 ore**, persistat per item în SQLite (`pinned_watch_state.last_checked_at`) — supraviețuiește restart-urilor serviciului, spre deosebire de un timer în memorie. Bucla de polling rulează la 10 minute, dar sare peste itemele care încă n-au ajuns la 3 ore.

Detectează, cu toggle independent per tip:

- Torrente noi pe Filelist (opțional filtrat doar pe sezonul curent)
- Episoade noi lansate (TMDB)
- Episoade/filme noi apărute în Plex

Prima verificare per item = baseline (fără notificări) — doar reține ce există deja, ca reper pentru „ce e nou" la verificările următoare. La finalizarea unei descărcări (automate sau manuale) sau la ștergerea unei intrări din jurnal, biblioteca Plex corespunzătoare (Filme/Seriale) e rescanată automat (`refreshPlexLibrary`, `src/lib/filelist/download.ts`).

---

## Sistemul de erori și observabilitate

Toate `console.warn`/`console.error` din **toată aplicația** — server functions, SSR, plugin-uri de fundal, cod client — sunt captate automat și afișate în widget-ul **„Erori aplicație"** din Tehnic, fără să fie nevoie de un apel manual la fiecare loc din cod.

| Componentă | Rol |
|---|---|
| `src/lib/console-capture.ts` | Suprascrie `console.error`/`console.warn` server-side, trimite spre `logError()`. Instalată idempotent din `server.ts` și fiecare plugin de fundal. |
| `src/lib/client-error-capture.ts` | Echivalentul pentru browser, trimite spre `logClientError()` (server function, cu rate-limit per IP). Instalat din `AutoReloadWatcher` (`__root.tsx`), alături de listenere `window.onerror`/`unhandledrejection`. |
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
- [Tailwind CSS v4](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/)
- [systeminformation](https://www.npmjs.com/package/systeminformation) — metrici sistem
- SQLite nativ (`node:sqlite`, Node.js 22.5+) — fără ORM
- TypeScript, ESLint, Prettier

---

## Structură proiect

```
src/
  components/         componente UI reutilizabile (AppHeader, BottomNav, gauge-uri, ui/ shadcn)
    lansari/            componente specifice paginii Lansări
    descopera/          componente specifice paginii Descoperă
    tehnic/             componente specifice paginii Sistem/Tehnic
    ui/                 componente shadcn/ui
  hooks/              hook-uri React custom
  lib/                funcții server, organizate pe domeniu
    services/           Plex, Immich, qBittorrent, Host — agregare status dashboard
    filelist/           căutare unificată, client qBittorrent, categorii, download, jurnal
    *.functions.ts      server functions TanStack (admin, github, push, tmdb, pinned...)
  routes/             pagini: index, plex, immich, qbit, sistem, tehnic, lansari, login
server/
  plugins/            plugin-uri Nitro (fundal): pinned-watcher, plex-session-tracker,
                      github-commit-tracker, fast-shutdown
  routes/             rute API: GitHub webhook, push subscription, SSE auto-reload
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
| `MEDIA_MOVIES_PATH` / `MEDIA_SERIES_PATH` | Căi locale unde qBittorrent salvează filmele/serialele din Filelist |
| `GITHUB_REPO` | Repo GitHub (ex: `Faicu/FaikkitBox`) pentru tracking commits |
| `GITHUB_TOKEN` | *(opțional)* Token GitHub API pentru limită mai mare la request-uri |
| `GITHUB_WEBHOOK_SECRET` | Secret pentru validarea webhook-urilor GitHub |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Chei VAPID pentru notificări web push |
| `PLEX_COMPOSE_FILE` / `IMMICH_COMPOSE_FILE` | *(opțional)* Căi custom `docker-compose.yml` pentru butoanele de restart |
| `SPEEDTEST_CACHE_FILE` | *(opțional)* Cale fișier cache ultimul rezultat Speedtest |
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
git push origin main             # 4.
sudo systemctl start faikkitbox  # 5. repornește cu build-ul nou
```

**De ce oprire înainte de build, nu doar la final:** `npm run build` scrie direct peste `.output/server/`, folosit de procesul live pentru chunk-uri SSR încărcate dinamic. Dacă serviciul rulează în timpul build-ului, o cerere poate nimeri exact în fereastra în care fișierele vechi au fost deja șterse/redenumite, dând `ERR_MODULE_NOT_FOUND` — a apărut recurent în istoric înainte de acest fix.

**De ce shutdown-ul e rapid și curat:** `server/plugins/fast-shutdown.ts` forțează ieșirea la 300ms după `SIGTERM`/`SIGINT`. Fără el, conexiunea SSE de auto-reload (`server/routes/api/deploy-sha.ts`, ține un tab de browser „la curent" cu restart-urile) ar ține procesul viu peste `TimeoutStopSec` din unitatea systemd, care oricum ar termina cu `SIGKILL` — un kill necurat, fără nicio garanție că apucă să ruleze codul de cleanup (ex. logarea opririi în Jurnalul de Activitate).

---

## Note tehnice pentru dezvoltare

Secțiune orientată spre a face modificări corecte rapid, nu spre a documenta fiecare fișier — pentru detalii complete, citește codul.

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

În componente client, se apelează fie direct (SSR/loader), fie prin `useServerFn(fn)` din `@tanstack/react-start` când e nevoie într-un event handler (`onClick` etc.) — vezi orice `sections/*.tsx` din `lansari/`. Handler-ele `.handler()` pot `await import(...)` module server-only (ex. `admin.server.ts`) ca să nu ajungă în bundle-ul client.

Plugin-urile de fundal (`server/plugins/*.ts`) nu au acces la request context — funcțiile server-only pe care le folosesc trebuie să aibă și o variantă „internă" (plain function, fără `createServerFn`), apelată prin `await import(...)` dinamic. Vezi `checkFilelistForItemInternal`, `checkPlexHasTitleInternal`, `downloadFilelistInternal`.

### TanStack Query — convenția `queryOptions`

Toate query-urile refolosite în mai multe componente sunt definite **o singură dată** ca `queryOptions(...)` în `src/lib/queries.ts` (queryKey, queryFn, staleTime, refetchInterval), și importate cu `useQuery(xQuery)` oriunde e nevoie. **Nu duplica un query inline cu același `queryKey`** dacă poate fi definit în `queries.ts` — o divergență aici produce cache desincronizat între pagini (a fost deja o problemă reală, vezi istoricul git pentru `pinnedItemsQuery`).

Pattern de invalidare după mutație:

```ts
await someMutationServerFn({ data: ... });
queryClient.invalidateQueries({ queryKey: ["cheia"] });
```

Pentru liste ce se încarcă incremental (ex. `DiscoverGrid`), se folosește `useInfiniteQuery` cu `initialPageParam`/`getNextPageParam`, nu paginare manuală cu state.

### Domenii principale în `src/lib/`

| Domeniu | Fișiere | Note |
|---|---|---|
| Pinned items (Lansări) | `pinned.functions.ts` | Tabelă SQLite `pinned_items`. `setPinnedItems` = full-replace (UI-ul de căutare din Lansări), `addPinnedItem` = insert unic (`PinToLansariButton` din Descoperă). Ambele trebuie să invalideze `["pinnedItems"]` (`pinnedItemsQuery`) ca să rămână sincron între pagini. |
| Filelist | `filelist.functions.ts` (barrel) + `filelist/{types,categories,download,match,log}.ts` | `categories.ts` are `isMovieCategory`/`MOVIE_CATEGORIES`/`SERIES_CATEGORIES` — **nu reimplementa** verificarea film/serial în altă parte. `checkFilelistForItemInternal` (`download.ts`) e **sursa unică** pentru „există pe Filelist?" — nu duplica logica de căutare/matching. `refreshPlexLibrary`/`refreshPlexLibraryForCategory` sunt **singurul** punct care declanșează rescan Plex din acest modul. `match.ts` are `torrentMatchesTitle`/`stripDiacritics`. |
| Erori aplicație | `error-log.ts`, `console-capture.ts`, `client-error-capture.ts` | Vezi [Sistemul de erori](#sistemul-de-erori-și-observabilitate). Nu adăuga apeluri `logError()` manuale lângă un `console.warn`/`console.error` — captarea globală le prinde deja automat; ar produce intrări duplicate. |
| TMDB | `tmdb.functions.ts` (search/details/countdown/episoade), `tmdb.discover.functions.ts` (trending/popular/newest + feed clipuri video), `tmdb-client.ts` (fetch helper cu token Bearer) | `getTmdbDetails` întoarce și `literalTitle` (din `alternative_titles`, `type: "literal title"`) — folosește-l pentru orice căutare externă (Filelist), nu `originalTitle` brut, care rămâne în scriptul nativ pentru producții non-latine. Funcțiile de discover întorc `{ items/clips, degraded }` — `degraded: true` înseamnă eroare TMDB înghițită în try/catch, nu listă goală legitimă. |
| Servicii dashboard | `services/{plex,immich,qbittorrent,host,plex-library,shared}.ts` + `services.functions.ts` | Agregă statusul pentru pagina principală și pentru status Plex per-item din Lansări (`checkPlexHasTitle`, `getPlexEpisodesInSeason`). |
| Auth admin | `admin.functions.ts` + `admin.server.ts` | Sesiune cookie-based (`getSession()`), fără JWT. `adminStatusQuery` e cache-uit 30s — dacă testezi login/logout și nu vezi schimbarea imediat, e din cauza staleTime, nu un bug. |
| DB | `db.ts` | SQLite nativ (`node:sqlite`), un singur fișier la `/opt/faikkitbox/data/faikkitbox.db` (override cu `FAIKKITBOX_DB_PATH`). Fără ORM/migrations tool — schema se creează cu `CREATE TABLE IF NOT EXISTS`, migrările incrementale via `PRAGMA user_version` (`runCleanups`); orice schimbare de schemă se adaugă acolo. |

### Componente Lansări/Descoperă — puncte de refolosit

- `src/components/lansari/utils.ts` — `detectQuality(name)` (1080p/4K/4K HDR din numele torrentului), `groupTorrentsBySeasonEpisode`. Orice logică nouă de parsare a numelui de torrent ar trebui să treacă prin aici, nu regex inline în componente.
- `src/components/lansari/plex-status.ts` + `PlexStatusBadge.tsx` — logica (funcție pură) și componenta pentru badge-ul de status Plex al serialelor. Orice modificare a priorității stărilor se face în `plex-status.ts`, nu inline în `PinnedItemCard.tsx`/`ShowCard.tsx`.
- `src/components/lansari/DownloadConfirmDialog.tsx` — dialogul standard de confirmare descărcare (folosit din `MovieCard`, `ShowCard`, `SeasonPanel`, `FilelistSection`), inclusiv butonul „Info Căutare". Orice buton nou de download ar trebui să treacă prin el, nu să descarce direct.
- `src/components/lansari/hooks.ts` — `useDownload()` (upload qBittorrent + toast + invalidare `filelistLog`), `useCountdown(targetIso)`.
- `src/components/ui/alert-dialog.tsx` — wrapper Radix deja stilizat; folosește-l pentru orice confirmare distructivă în loc de `window.confirm()`.
- Pagina Descoperă are două moduri (`grid`/`feed`) cu componente separate (`DiscoverGrid.tsx`, `FeedView.tsx`) care share doar `FilterTabs`, `PinToLansariButton`, `FilelistCheckButton`, `PlexLibraryStatus`. Dacă adaugi un filtru nou, verifică dacă trebuie propagat în ambele moduri.

### Workflow obligatoriu

Vezi `CLAUDE.md` la rădăcina proiectului — orice modificare de cod trebuie urmată de secvența completă din [Deploy](#deploy) (stop → build → commit → push → start) înainte de a considera o sarcină finalizată.
