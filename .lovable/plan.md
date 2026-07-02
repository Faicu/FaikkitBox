## Add qBittorrent Controls

Extend the qBit page with interactive controls so torrents can be managed directly from the dashboard.

### Server functions (`src/lib/services.functions.ts`)
Add authenticated server functions that proxy to the qBittorrent Web API (reusing the existing login/cookie logic):
- `qbitTorrentAction({ hashes: string[] | "all", action: "pause" | "resume" })` → calls `/api/v2/torrents/pause` or `/api/v2/torrents/resume` with `hashes=<joined>|all`.
- Return `{ ok: true }` on success; surface qBit errors otherwise.

### UI (`src/routes/qbit.tsx`)
- **Global controls** (header row): two buttons
  - **Resume All Torrents** (Play icon) → `qbitTorrentAction({ hashes: "all", action: "resume" })`
  - **Stop All Torrents** (Square/Pause icon) → `qbitTorrentAction({ hashes: "all", action: "pause" })`
- **Per-torrent controls**: in each torrent row, add a small Pause/Resume toggle button based on the torrent's current state (paused/stopped states show Resume, active states show Pause).
- Use `useMutation` with `onSuccess` invalidating the qBit query key so the list refreshes immediately (next 1.1s poll will also refresh).
- Show a subtle loading state on the clicked button while the mutation is in flight; toast on error via existing toast setup (if present) or inline error text.

### Notes
- All logic stays in the existing qBit auth/session flow — no new secrets.
- No changes to other services or shared layout.
