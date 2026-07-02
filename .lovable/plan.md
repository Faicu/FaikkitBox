## Plan: Refresh stats every 2 seconds without full-page reload

Update `src/lib/queries.ts` to poll every 2 seconds instead of 5s/15s. TanStack Query's `refetchInterval` refreshes data in the background and only re-renders the components that consume each query — no page reload occurs.

### Changes
- `REFRESH_MS`: `5000` → `2000` (applies to Plex, qBittorrent, Host).
- `immichQuery.refetchInterval`: `15_000` → `2000`.
- Keep `refetchIntervalInBackground: false` so polling pauses when the tab is hidden (saves API quota on Plex/Immich/qBit).

### Notes
- No changes to `index.tsx` or route files needed; queries are shared and every page using them (`/`, `/plex`, `/immich`, `/qbit`, `/host`) will inherit the 2s cadence.
- 2s polling hits Plex discovery/Immich/qBit/host endpoints frequently. If any endpoint is slow (>2s) React Query will still wait for the previous request to complete before firing the next, so this is safe but may increase server load. Let me know if you'd like different intervals per service.