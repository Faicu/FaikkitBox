# FaikkitBox

Dashboard de monitorizare pentru serverul de acasă (Plex, Immich, qBittorrent), rulat independent.

Aplicația este construită cu [TanStack Start](https://tanstack.com/start) (React 19 + TanStack Router/Query) și rulează ca server Node standard (via Nitro, preset `node-server`), gata de pus în spatele unui reverse proxy (ex. nginx) pe Ubuntu.

## Funcționalități

- **Prezentare generală** — status live pentru Plex, Immich, qBittorrent și gazdă, într-un singur ecran.
- **Plex** — sesiuni active cu progres și status Redare/Pauză, episoade vizionate azi, utilizatori activi azi.
- **Immich** — număr fișiere, spațiu ocupat, coadă de joburi.
- **qBittorrent** — viteze download/upload, torrente active/total, filtre pe stări și căutare în listă.
- **Control qBittorrent** — acțiuni admin de pauză/reluare (global sau individual) și ștergere torrent + fișiere.
- **Gazdă** — CPU, memorie, swap, uptime, discuri (inclusiv viteze read/write per disc), rețea, senzori de temperatură, top procese și top I/O disc, plus aplicații monitorizate.
- **Jurnal activitate** — timeline unificat cu evenimente server (pornire/oprire, Plex, qBit, update-uri) și commit-uri GitHub, cu detalii commit la click.
- **Speedtest** — card pe pagina principală cu vitezele ultimului test (Speedtest by Ookla); rularea unui test nou necesită autentificare admin. Presupune CLI-ul `speedtest` (Ookla) instalat și disponibil în `PATH` pe server.
- **Lansări seriale** — pagină dedicată pentru episoade lansate/următoare, cu căutare seriale prin TVmaze, fixare în listă, countdown până la episodul următor și status „în bibliotecă”.
- **FileList.io** — căutare torrent direct din dashboard, trimitere în qBittorrent pe foldere separate filme/seriale și jurnal cu ultimele descărcări.
- **Actualizări** — pagină de admin pentru verificarea versiunilor Plex/Immich și comenzi de mentenanță (update Ubuntu, restart/update servicii).
- **Pagină Test** — rută dedicată pentru verificare rapidă a UI-ului (toast de test).
- **Autentificare admin** — acces protejat prin sesiune (user/parolă + secret de sesiune) pentru funcțiile administrative.

## Stack tehnic

- [React 19](https://react.dev/) + [TanStack Start](https://tanstack.com/start) / [TanStack Router](https://tanstack.com/router) / [TanStack Query](https://tanstack.com/query)
- [Vite](https://vitejs.dev/) + [Nitro](https://nitro.build/) (preset `node-server`)
- [Tailwind CSS v4](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/) (componente Radix UI)
- [systeminformation](https://www.npmjs.com/package/systeminformation) pentru metrici de sistem
- TypeScript, ESLint, Prettier

## Structură proiect

```
src/
  components/       # componente UI reutilizabile (AppHeader, BottomNav, gauges, ui/ shadcn)
  hooks/             # hook-uri React custom
  lib/               # funcții server (Plex/Immich/qBittorrent/host), autentificare admin, query-uri, formatare
  routes/            # pagini/rute: index (overview), plex, immich, qbit, host, lansari, login, updates
  server.ts          # entrypoint server (handler fetch, normalizare erori SSR)
  start.ts           # bootstrap TanStack Start
  styles.css         # stiluri globale Tailwind
public/              # assets statice
```

## Cerințe

- Node.js (compatibil cu dependințele din `package.json`) și npm
- Acces la serviciile monitorizate: Plex, Immich, qBittorrent (opțional, fiecare secțiune arată eroare dacă serviciul nu e configurat/accesibil)

## Configurare

Copiază `.env.example` în `.env` și completează valorile:

```bash
cp .env.example .env
```

Variabile disponibile:

| Variabilă                                      | Descriere                                                                                          |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `ADMIN_USER` / `ADMIN_PASS`                    | Credențiale pentru login-ul de admin al dashboard-ului                                             |
| `SESSION_SECRET`                               | Secret pentru sesiunea de admin (minim 32 caractere aleatorii, ex. `openssl rand -hex 32`)         |
| `PLEX_URL` / `PLEX_TOKEN`                      | URL și token pentru serverul Plex                                                                  |
| `IMMICH_URL` / `IMMICH_API_KEY`                | URL și cheie API pentru Immich                                                                     |
| `QBIT_URL` / `QBIT_USERNAME` / `QBIT_PASSWORD` | URL și credențiale pentru WebUI-ul qBittorrent                                                     |
| `FILELIST_USERNAME` / `FILELIST_PASSKEY`       | Credențiale API FileList.io pentru căutare și descărcare torrent                                   |
| `MEDIA_MOVIES_PATH` / `MEDIA_SERIES_PATH`      | Căi locale unde qBittorrent salvează filmele și serialele adăugate din FileList                   |
| `PLEX_COMPOSE_FILE` / `IMMICH_COMPOSE_FILE`    | (opțional) căi custom către `docker-compose.yml` ale serviciilor, folosite de butoanele de restart |
| `SPEEDTEST_CACHE_FILE`                         | (opțional) cale către fișierul unde e salvat ultimul rezultat Speedtest (implicit un fișier temporar) |
| `SPEEDTEST_BIN`                                | (opțional) cale completă către binarul `speedtest` (util dacă instalarea via snap nu rulează din systemd) |
| `GITHUB_TOKEN`                                 | (opțional) token GitHub API pentru limită mai mare la request-uri (commits + verificări versiuni) |
| `PORT`                                         | Portul pe care rulează serverul (implicit `3000`)                                                  |
| `NODE_ENV`                                     | Mediul de rulare (`production` în producție)                                                       |

**Nu comite niciodată fișierul `.env` în git.**

## Instalare și rulare

```bash
npm install

# Development (Vite dev server, port 8080)
npm run dev

# Build de producție (Nitro, preset node-server)
npm run build

# Preview build local
npm run preview

# Lint
npm run lint

# Formatare cod (Prettier)
npm run format
```

După `npm run build`, aplicația poate fi pornită direct cu:

```bash
node .output/server/index.mjs
```

## Deploy

Repository-ul nu include script de deploy automat.

```bash
git pull
npm install
npm run build
sudo systemctl restart faikkitbox
```
