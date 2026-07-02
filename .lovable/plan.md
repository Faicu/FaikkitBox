## Plan: Expand stats across all services

### 1. Format helper (`src/lib/format.ts`)
- `formatDuration()` → accept option to include seconds, e.g. `17h 40m 12s`. Add new `formatDurationHMS()` for uptime & progress.
- `formatCount()` for large numbers (5,577).

### 2. Plex — top charts (`src/lib/services.functions.ts` + `src/routes/plex.tsx`)
Extend `PlexData` with:
- `topShows: { title, plays, lastViewedAt, thumbPath? }[]`
- `topMovies: { title, plays, lastViewedAt, thumbPath? }[]`
- `topWatchers: { user, plays, lastViewedAt }[]`

Fetch via Plex history endpoint:
```
GET /status/sessions/history/all?sort=viewedAt:desc&X-Plex-Container-Size=500
```
Aggregate in-memory: group by `grandparentTitle` (shows), `title` where `type=movie` (movies), `User.title` (watchers). Return top 5 of each. Cache for 60s (history is expensive).

Render as 3 new sections on `/plex`: "Top Shows", "Top Movies", "Top Watchers" — ranked list with play count.

### 3. Immich extras
Extend `ImmichData`:
- `uploadsToday`, `uploadsThisWeek` — from `/api/assets/statistics` or by querying `/api/search/metadata` with date filter; fallback to zero if endpoint missing.
- `topUploaders` — reuse existing `usageByUser`, sort by photos+videos desc, top 5.
- `jobQueueDepth` — sum of `active + waiting` across all jobs (already fetched).

Render new "Top Uploaders" and "Uploads" cards on `/immich`.

### 4. qBit extras
Extend `QbitData`:
- `sessionDl`, `sessionUp` — from `/api/v2/transfer/info` (`dl_info_data`, `up_info_data`).
- `alltimeDl`, `alltimeUp` — from `/api/v2/sync/maindata` `server_state.alltime_dl` / `alltime_ul`.
- `largestEta` — pick torrent with max `size * (1 - progress)`, return `{ name, eta }`.
- `perCategory` — group torrents by `category` field, return `{ category, count, dlspeed, upspeed }[]`.

Render "Session", "All-time", "Categories" cards + largest-ETA callout on `/qbit`.

### 5. Host — per-app grouping + h:m:s uptime + temperature trend
Extend `HostData`:
- `uptimeSec` already exists → format as `17h 40m 12s` on `/host`.
- `apps: { name, cpu, mem, netRx?, netTx?, source: "process"|"container" }[]`
  - Fetch `/api/3/processlist` and `/api/3/containers` from Glances in parallel (containers may 404 — swallow).
  - Container match first: map by container name → `Plex`, `Immich`, `qBittorrent`, `cloudflared` (case-insensitive contains).
  - Process fallback: group processes by regex on `name` (`plex`, `immich`, `qbittorrent-nox`, `cloudflared`, `dockerd`), sum cpu + mem across matches.
  - Container objects include `network_rx`/`network_tx` in bytes/sec; processes don't → leave `netRx`/`netTx` undefined for process-only rows.
- `diskIO: { name, ioRead, ioWrite }[]` — top 5 processes by `io_counters` from processlist.
- `sensorHistory` — client-side ring buffer; keep 60 samples in a React `useRef` on `/host` and render a mini sparkline for CPU temp.

Render on `/host`:
- Uptime pill with seconds.
- New "Apps" section: one row per known app with icon, CPU%, Mem%, and (when container) ↓/↑ rates.
- New "Disk I/O" section under Top Processes.
- Small CPU-temp sparkline next to Sensors.

### 6. Poll cadence
Keep 1s from previous turn. Plex history query is 60s-cached server-side so we don't hammer it.

### Technical notes
- All new fields optional so old error paths don't break.
- Cache Plex history in a module-level `Map<url, { data, expiresAt }>` — 60s TTL.
- App-name mapping table lives in `services.functions.ts` as a const so it's easy to extend later.
- Sparkline is a pure inline `<svg>` (no chart lib) to keep bundle small.

### Out of scope this pass
- Historical trends beyond in-session sparkline (would need a DB).
- Per-process network I/O (Linux only exposes it via `nethogs`; Glances doesn't).
