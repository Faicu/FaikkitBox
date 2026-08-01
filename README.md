# FaikkitBox

Dashboard personal de monitorizare pentru serverul de acasă — Plex, Immich, qBittorrent și sistem.

Construit cu [TanStack Start](https://tanstack.com/start) (React 19 + TanStack Router/Query), rulează ca server Node via Nitro, gata de pus în spatele unui reverse proxy (nginx) pe Ubuntu.

---

## Funcționalități

### Prezentare generală
Status live pentru toate serviciile monitorizate într-un singur ecran: Plex, Immich, qBittorrent, gazdă, ultimul speedtest și jurnal de activitate.

### Plex
Sesiuni active cu progres și stare (Redare/Pauză), episoade vizionate azi, utilizatori activi.

### Immich
Număr fișiere, spațiu ocupat, coadă de joburi active.

### qBittorrent
Viteze download/upload, torrente active/total, filtre pe stări, căutare în listă, acțiuni de pauză/reluare (global sau individual) și ștergere torrent + fișiere.

### Sistem
CPU, memorie, swap, uptime, discuri cu viteze read/write, rețea, senzori temperatură, top procese și top I/O disc, aplicații monitorizate, comenzi de mentenanță (update Ubuntu, restart servicii).

### Tehnic
Speedtest (rulare test nou + istoric grafic), status plugin-uri server, statistici commit-uri și jurnal de activitate (evenimente server + commit-uri GitHub).

### Lansări — filme și seriale
Pagină dedicată cu search unificat (TMDB) pentru filme și seriale. Itemele fixate afișează:

- **Poster** din TMDB
- **Status Plex**
  - Pentru **filme**: `Complet în Plex` (+ calitatea) / `Lipsă din Plex` — badge unic, `PlexStatusBadge` (`src/components/lansari/PlexStatusBadge.tsx`)
  - Pentru **seriale**: badge cu 6 stări posibile, calculate în `computeTvPlexStatus` (`src/components/lansari/plex-status.ts`) și afișate tot cu `PlexStatusBadge` — vezi detalii mai jos
- **Download de pe Filelist** — butoane pe calități (`1080p`, `4K`, `4K HDR`) cu confirmare înainte de descărcare; pornește doar la deschiderea „Mai multe detalii" pe card, nu automat pentru toate itemele fixate (contul Filelist are limită orară de cereri)
  - Seriale: grupate pe sezoane cu accordion; suportă atât pack-uri întregi (S01) cât și episoade individuale (S01E01) în același sezon
  - Per-episod: status Plex individual cu badge `În bibliotecă`
- **Countdown** până la următorul episod (zile/ore/min/sec) cu data și ora exactă (ora României)
- **Ultimul episod lansat** cu status Plex

Căutare Plex robustă: suportă titluri localizate (ex: „Casa Dragonului" găsit prin „House of the Dragon") și titluri cu diacritice (ex: „Cămătarii") prin fallback la parcurgerea întregii biblioteci.

#### Badge-uri Plex pentru seriale

Definite în **`src/components/lansari/plex-status.ts`** (tipul `TvPlexStatus` + funcția pură `computeTvPlexStatus`) și randate de componenta **`src/components/lansari/PlexStatusBadge.tsx`**. Sunt folosite din `ShowCard.tsx` (badge principal, pe cardul restrâns) și `SeasonPanel.tsx` (badge pe secțiunea de sezon expandată).

6 stări posibile, în ordinea de prioritate (prima condiție adevărată câștigă):

| # | Stare | Când apare |
|---|---|---|
| 1 | **Episod nou disponibil** | Ultimul episod lansat are sub 24h și încă lipsește din Plex. Prioritate maximă — e temporar și urgent. |
| 2 | **Complet în Plex** | Toate sezoanele și toate episoadele deja apărute există în Plex. |
| 3 | **Incomplet (ultimul sezon)** | Lipsește cel puțin un episod chiar din ultimul sezon. Mai specific decât starea 5, deci are prioritate peste ea. |
| 4 | **Complet (ultimul sezon)** | Ultimul sezon e complet în Plex — nu contează dacă sezoane/episoade anterioare lipsesc, parțial sau total. |
| 5 | **Lipsesc episoade** | Fallback generic, pentru cazuri ambigue (nu ar trebui să apară în practică). |
| 6 | **Lipsă din Plex** | Niciun episod din serial nu există în bibliotecă. |

Pentru starea 1, `computeTvPlexStatus` primește `lastAired` din `getTvShowCountdown` (`src/lib/tmdb.functions.ts`), care are deja câmpul `inLibrary` calculat prin verificare directă pe Plex pentru acel episod exact — nu se recalculează separat.

Pentru filme, `MovieCard.tsx` folosește aceeași componentă `PlexStatusBadge` cu doar 2 stări (`complet` / `lipsa`), pe baza rezultatului simplu `checkPlexHasTitle`.

### FileList.io
Căutare torrent direct din dashboard, trimitere în qBittorrent pe foldere separate filme/seriale, jurnal cu ultimele descărcări.

### Notificări push
Notificări web push pentru commit-uri noi pe GitHub. Funcționează fără browser deschis — se recuperează automat notificările pierdute în timpul unui restart.

### Verificare versiuni
Indicator de versiune Plex/Immich (actualizat/necesită update) afișat în header-ul fiecărei pagini de serviciu, cu acțiune de restart pentru containerul Docker.

### Autentificare admin
Acces protejat prin sesiune (user/parolă + secret de sesiune) pentru funcțiile administrative.

---

## Stack tehnic

- [React 19](https://react.dev/) + [TanStack Start](https://tanstack.com/start) / [TanStack Router](https://tanstack.com/router) / [TanStack Query](https://tanstack.com/query)
- [Vite](https://vitejs.dev/) + [Nitro](https://nitro.build/) (preset `node-server`)
- [Tailwind CSS v4](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/)
- [systeminformation](https://www.npmjs.com/package/systeminformation) — metrici sistem
- SQLite nativ (Node.js 22.5+) — fără ORM
- TypeScript, ESLint, Prettier

---

## Structură proiect

```
src/
  components/       # componente UI reutilizabile (AppHeader, BottomNav, gauge-uri, ui/ shadcn)
    lansari/         # componente specifice paginii Lansări
    tehnic/          # componente specifice paginii Sistem/Tehnic
    ui/              # componente shadcn/ui
  hooks/            # hook-uri React custom
  lib/              # funcții server, pe domeniu
    services/         # Plex, Immich, qBittorrent, Host (agregare status pentru dashboard)
    filelist/          # client qBittorrent, categorii, download, jurnal Filelist
    *.functions.ts     # server functions TanStack (admin, github, push, tmdb, tvshows, versions...)
  routes/           # pagini: index, plex, immich, qbit, sistem, tehnic, lansari, login
server/
  plugins/          # plugin-uri Nitro: Plex session tracker, GitHub commit tracker, pinned watcher
  routes/           # rute API: GitHub webhook, push subscription
public/             # assets statice, Service Worker
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
| `GITHUB_TOKEN` | (opțional) Token GitHub API pentru limită mai mare la request-uri |
| `GITHUB_WEBHOOK_SECRET` | Secret pentru validarea webhook-urilor GitHub |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Chei VAPID pentru notificări web push |
| `PLEX_COMPOSE_FILE` / `IMMICH_COMPOSE_FILE` | (opțional) Căi custom `docker-compose.yml` pentru butoanele de restart |
| `SPEEDTEST_CACHE_FILE` | (opțional) Cale fișier cache ultimul rezultat Speedtest |
| `SPEEDTEST_BIN` | (opțional) Cale completă binar `speedtest` (util dacă snap nu rulează din systemd) |
| `PORT` | Port server (implicit `3000`) |
| `NODE_ENV` | Mediu de rulare (`production` în producție) |

**Nu comite niciodată `.env` în git.**

---

## Instalare și rulare

```bash
npm install

# Development
npm run dev

# Build producție
npm run build

# Preview build local
npm run preview

# Lint / Formatare
npm run lint
npm run format
```

Pornire directă după build:

```bash
node .output/server/index.mjs
```

## Deploy

```bash
git pull
npm install
npm run build
sudo systemctl restart faikkitbox
```

---

## Note tehnice pentru dezvoltare

Secțiune orientată spre a face modificări corecte rapid, nu spre a documenta fiecare fișier — pentru detalii complete, citește codul.

### Arhitectură — TanStack Start, nu Next.js

Rutele NU sunt în `src/app/`, ci în `src/routes/*.tsx`, definite cu `createFileRoute("/cale")({ component, head, ... })`. Fiecare fișier de rută = o pagină. `src/routes/__root.tsx` e layout-ul rădăcină (providers, shell global).

Logica de server (DB, fetch extern, fișiere, comenzi shell) trăiește în `src/lib/*.functions.ts`, ca `createServerFn`:

```ts
export const getSomething = createServerFn({ method: "GET" })
  .validator((data: { id: number }) => data)
  .handler(async ({ data }) => { /* rulează doar pe server */ });
```

În componente client, se apelează fie direct (SSR/loader), fie prin `useServerFn(fn)` din `@tanstack/react-start` când e nevoie într-un event handler (`onClick`, etc.) — vezi orice `sections/*.tsx` din `lansari/`. Handler-ele `.handler()` pot `await import(...)` module server-only (ex. `admin.server.ts`) ca să nu ajungă în bundle-ul client.

### TanStack Query — convenția queryOptions

Toate query-urile refolosite în mai multe componente sunt definite **o singură dată** ca `queryOptions(...)` în `src/lib/queries.ts` (queryKey, queryFn, staleTime, refetchInterval), și importate cu `useQuery(xQuery)` oriunde e nevoie. **Nu duplica un query inline cu același `queryKey`** dacă poate fi definit în `queries.ts` — am avut o bilă exact din cauza asta (`pinnedItemsQuery`, vezi mai jos) și a produs cache desincronizat între pagini.

Pattern de invalidare după mutație:
```ts
await someMutationServerFn({ data: ... });
queryClient.invalidateQueries({ queryKey: ["cheia"] });
```

Pentru liste ce se încarcă incremental (ex. `DiscoverGrid`), se folosește `useInfiniteQuery` cu `initialPageParam`/`getNextPageParam`, nu paginare manuală cu state.

### Domenii principale în `src/lib/`

| Domeniu | Fișiere | Note |
|---|---|---|
| Pinned items (Lansări) | `pinned.functions.ts` | Tabelă SQLite `pinned_items`. `setPinnedItems` = full-replace (folosit de UI-ul de căutare din Lansări), `addPinnedItem` = insert unic (folosit de `PinToLansariButton` din Descoperă). Ambele trebuie să invalideze `["pinnedItems"]` (`pinnedItemsQuery` din `queries.ts`) ca să rămână sincron între pagini. |
| Filelist | `filelist.functions.ts` (barrel) + `filelist/{types,categories,download,match,log}.ts` | `categories.ts` are `isMovieCategory`/`MOVIE_CATEGORIES`/`SERIES_CATEGORIES` — **nu reimplementa** verificarea film/serial pe alte fișiere. `download.ts` face upload în qBittorrent + poll în fundal (până la 48h, la 30s) + refresh bibliotecă Plex la finalizare. `match.ts` are `torrentMatchesTitle`/`stripDiacritics` — matching nume torrent ↔ titlu TMDB. `checkFilelistForItemInternal` (`download.ts`) e **sursa unică** pentru „există pe Filelist?": caută secvențial IMDB ID → titlu original → titlu englez, se oprește la primul rezultat, cu cache 10 min (contul Filelist are limită orară de cereri). E folosită din 3 locuri — nu duplica logica de căutare/matching în altă parte: `FilelistCheckButton.tsx` (Descoperă, la click), `PinnedItemCard.tsx` (Lansări, la deschiderea „Mai multe detalii"), `server/plugins/pinned-watcher.ts` (job automat la 3 ore, doar pentru itemele cu toggle „Torrent nou Filelist" activat). |
| qBittorrent client | `qbit-client.ts` | Autentificare cu cache SID; dacă apar erori 403 la upload, verifică header-ele Referer/Origin și expirarea SID-ului (deja rezolvat o dată, vezi istoricul git). |
| TMDB | `tmdb.functions.ts` (search/details/countdown/episoade), `tmdb.discover.functions.ts` (trending/popular/newest + feed clipuri video), `tmdb-client.ts` (fetch helper cu token Bearer) | Funcțiile de discover întorc `{ items/clips, degraded }` — `degraded: true` înseamnă eroare TMDB înghițită în try/catch, nu listă goală legitimă. Păstrează distincția asta când adaugi UI nou pe aceste date. |
| Servicii dashboard | `services/{plex,immich,qbittorrent,host,plex-library,shared}.ts` + `services.functions.ts` | Agregă statusul pentru pagina principală și pentru status Plex per-item din Lansări (`checkPlexHasTitle`, `getPlexEpisodesInSeason`). |
| Auth admin | `admin.functions.ts` + `admin.server.ts` | Sesiune cookie-based (`getSession()`), fără JWT. `adminStatusQuery` e cache-uit 30s — dacă testezi login/logout și nu vezi schimbarea imediat, e din cauza staleTime, nu un bug. |
| DB | `db.ts` | SQLite nativ (`node:sqlite`, Node 22.5+), un singur fișier la `/opt/faikkitbox/data/faikkitbox.db` (override cu `FAIKKITBOX_DB_PATH`). Fără ORM/migrations tool — schema se creează cu `CREATE TABLE IF NOT EXISTS` direct în `db.ts`; orice tabelă nouă se adaugă acolo. |

### Componente Lansări/Descoperă — puncte de refolosit

- `src/components/lansari/utils.ts` — `detectQuality(name)` (1080p/4K/4K HDR din numele torrentului), `groupTorrentsBySeasonEpisode`. Orice logică nouă de parsare a numelui de torrent ar trebui să treacă prin aici, nu regex inline în componente. (Matching-ul torrent ↔ titlu e în `src/lib/filelist/match.ts`, folosit server-side de `checkFilelistForItemInternal`.)
- `src/components/lansari/plex-status.ts` + `PlexStatusBadge.tsx` — logica (funcție pură) și, respectiv, componenta pentru badge-ul de status Plex al serialelor (6 stări). Orice modificare a priorității stărilor se face în `plex-status.ts`, nu inline în `PinnedItemCard.tsx`/`ShowCard.tsx`.
- `src/components/lansari/DownloadConfirmDialog.tsx` — dialogul standard de confirmare descărcare (folosit din `MovieCard`, `ShowCard`, `FilelistSection`). Orice buton nou de download ar trebui să treacă prin el, nu să descarce direct.
- `src/components/lansari/hooks.ts` — `useDownload()` (upload qBittorrent + toast + invalidare `filelistLog`), `useCountdown(targetIso)`.
- `src/components/ui/alert-dialog.tsx` — wrapper Radix deja stilizat; folosește-l pentru orice confirmare distructivă în loc de `window.confirm()`.
- Pagina Descoperă are două moduri (`grid`/`feed`) cu componente separate (`DiscoverGrid.tsx`, `FeedView.tsx`) care share doar `FilterTabs`, `PinToLansariButton`, `FilelistCheckButton`. Dacă adaugi un filtru nou, verifică dacă trebuie propagat în ambele moduri.

### Workflow obligatoriu

Vezi `CLAUDE.md` la rădăcina proiectului — orice modificare de cod trebuie urmată de `npm run build` → commit → `git push origin main` → `systemctl restart faikkitbox`, în această ordine, înainte de a considera o sarcină finalizată.
