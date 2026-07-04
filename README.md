# Faikkitbox

Dashboard de monitorizare pentru serverul de acasă (Plex, Immich, qBittorrent), rulat independent — fără Lovable, fără Supabase.

Aplicația este construită cu [TanStack Start](https://tanstack.com/start) (React 19 + TanStack Router/Query) și rulează ca server Node standard (via Nitro, preset `node-server`), gata de pus în spatele unui reverse proxy (ex. nginx) pe Ubuntu.

## Funcționalități

- **Prezentare generală** — status live pentru Plex, Immich, qBittorrent și gazdă, într-un singur ecran.
- **Plex** — sesiuni active, episoade vizionate azi, utilizatori activi azi.
- **Immich** — număr fișiere, spațiu ocupat, coadă de joburi.
- **qBittorrent** — viteze download/upload, torrente active/total.
- **Gazdă** — CPU, memorie, swap, uptime, discuri, rețea, senzori de temperatură, top procese și top I/O disc, plus aplicații monitorizate.
- **Autentificare admin** — acces protejat prin sesiune (user/parolă + secret de sesiune) pentru funcții suplimentare.
- **Actualizări** — pagină de admin pentru verificarea versiunilor serviciilor și rularea de comenzi (restart containere Docker etc.).

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
  routes/            # pagini/rute: index (overview), plex, immich, qbit, host, login, updates
  server.ts          # entrypoint server (handler fetch, normalizare erori SSR)
  start.ts           # bootstrap TanStack Start
  styles.css         # stiluri globale Tailwind
public/              # assets statice
deploy.sh            # script de deploy (fetch/reset pe main + build + restart systemd)
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
| `PLEX_COMPOSE_FILE` / `IMMICH_COMPOSE_FILE`    | (opțional) căi custom către `docker-compose.yml` ale serviciilor, folosite de butoanele de restart |
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

Scriptul [`deploy.sh`](./deploy.sh) automatizează actualizarea pe server: verifică schimbări noi pe branch-ul `main`, face `git fetch` + `git reset --hard` pe `origin/main`, instalează dependințele, rulează build-ul și repornește serviciul systemd (`DEPLOY_SERVICE`, implicit `faikkitbox`).

```bash
./deploy.sh
```

Presupune că repository-ul este clonat în `/opt/faikkitbox` și că există un serviciu systemd configurat pentru a rula aplicația build-uită.
