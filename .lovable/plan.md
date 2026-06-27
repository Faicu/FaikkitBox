## Mini-PC Monitoring Dashboard (mobile PWA)

A mobile-first web dashboard, installable to your Android home screen, that monitors Plex, Immich, qBittorrent, and the host machine. Open access (no login), HTTPS endpoints reached via a server-side proxy so your API tokens never touch the browser.

### Services & data shown

- **Plex** (`https://faicu.go.ro:32400`)
  - Now playing: title, user, device, progress, bitrate, transcode vs direct
  - Libraries: count of movies/shows/episodes per library
  - Server status, version, recently added
- **Immich** (`https://faicu.go.ro`)
  - Storage used, total assets, photos vs videos, recent uploads
  - Backup/job status, server version
- **qBittorrent** (`https://torrent.faicu.ro`)
  - Global down/up speed, ratio, total session transfer
  - Active torrents list: name, progress, speed, ETA, status, peers
  - Free disk space (reported by qBit)
- **Host machine** — requires installing **Glances** on the mini-PC (one command, runs as a service, exposes JSON on port 61208). I'll include the setup snippet. Once exposed via your reverse proxy as e.g. `https://glances.faicu.ro`:
  - CPU %, per-core load, temperatures
  - RAM + swap usage
  - Disk usage per mount, disk I/O
  - Network I/O per interface
  - Top processes
  - Uptime, load average

### UX

- Mobile-first layout: bottom tab nav (Overview · Plex · Immich · qBit · Host)
- Overview shows status pills + key live numbers for all 4 sources at a glance
- Auto-refresh every 3s (configurable), pull-to-refresh, last-updated timestamp
- Service-down state shown clearly per card (red pill + error reason)
- Installable PWA: home-screen icon, standalone display, themed splash

### Technical

- **Stack**: TanStack Start (default), Tailwind, shadcn/ui, TanStack Query for polling
- **Server functions** (`createServerFn`) proxy every upstream call. Browser only ever talks to same-origin `/` — solves CORS and keeps tokens server-side.
- **Lovable Cloud enabled** purely as a secret store (no DB tables needed). Secrets requested via `add_secret`:
  - `PLEX_URL`, `PLEX_TOKEN`
  - `IMMICH_URL`, `IMMICH_API_KEY`
  - `QBIT_URL`, `QBIT_USERNAME`, `QBIT_PASSWORD`
  - `GLANCES_URL` (added after you set up Glances)
- **qBittorrent** uses cookie-based login (`/api/v2/auth/login`), cookie cached in-memory on the server and re-auth on 403.
- **PWA**: `vite-plugin-pwa` with `NetworkFirst` for navigations, guarded registration (no SW in Lovable preview), manifest + icons.
- **Host metrics**: Glances REST API (`/api/4/all` or per-plugin endpoints).

### Open-access caveat

You chose no login. The dashboard URL will expose live stats from your services to anyone with the link. Consider revisiting later (Lovable Cloud auth = one-click add). I'll proceed open as requested.

### Glances install snippet (for the mini-PC)

```text
# Debian/Ubuntu
sudo apt install glances
glances -w  # starts web/REST server on :61208
# Run as a service via systemd, then reverse-proxy to https://glances.faicu.ro
```

### Build order

1. Enable Lovable Cloud (secret storage)
2. Request the 8 secrets above (Glances secret optional, added later)
3. Scaffold routes: `/` (overview), `/plex`, `/immich`, `/qbit`, `/host`
4. Server functions: `getPlexStatus`, `getImmichStatus`, `getQbitStatus`, `getHostStats`
5. UI components: StatCard, ServicePill, TorrentRow, NowPlayingCard, MetricGauge
6. TanStack Query polling + error states
7. PWA manifest, icons, guarded service worker
8. Mobile viewport tuning

### What I need from you after approval

- Plex X-Plex-Token (Plex Web → any media → ⋯ → Get Info → View XML, copy `X-Plex-Token` from URL)
- Immich API key (Account Settings → API Keys → New)
- qBittorrent Web UI username + password
- Decision on Glances now or later