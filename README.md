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
- **Status Plex** — `Complet` / `Incomplet` / `Lipsă` cu culori (verde/galben/roșu)
  - Pentru **filme**: afișează și calitatea existentă în bibliotecă (ex: `1080p · Complet`)
  - Pentru **seriale**: statusul reflectă *doar ultimul sezon lansat*, nu întreaga serie
- **Download de pe Filelist** — butoane pe calități (`1080p`, `4K`, `4K HDR`) cu confirmare înainte de descărcare
  - Seriale: grupate pe sezoane cu accordion; suportă atât pack-uri întregi (S01) cât și episoade individuale (S01E01) în același sezon
  - Per-episod: status Plex individual cu badge `În bibliotecă`
- **Countdown** până la următorul episod (zile/ore/min/sec) cu data și ora exactă (ora României)
- **Ultimul episod lansat** cu status Plex

Căutare Plex robustă: suportă titluri localizate (ex: „Casa Dragonului" găsit prin „House of the Dragon") și titluri cu diacritice (ex: „Cămătarii") prin fallback la parcurgerea întregii biblioteci.

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
