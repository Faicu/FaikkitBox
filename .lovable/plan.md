## Plan

Change `REFRESH_MS` from `2000` to `1000` in `src/lib/queries.ts`. All queries (Plex, Immich, qBit, Host) derive from this constant, so every value updates every 1 second.
