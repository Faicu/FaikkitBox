## Plan

Switch Plex monitoring from a hardcoded `PLEX_URL` to Plex's own connection discovery, while still using the existing `PLEX_TOKEN` authorization.

### What this solves

Your current `https://faicu.go.ro:32400` custom access URL is not valid for direct HTTPS because the certificate doesn't match that hostname. Plex clients can work anyway because Plex discovers and uses `plex.direct` / relay connections internally, but our dashboard currently does not do that discovery.

### Plex authorization options

- **Recommended:** keep using `X-Plex-Token`; this is Plex's normal API auth method for server stats.
- **Alternative token acquisition:** Plex PIN login flow can obtain the same kind of token, but it is mostly useful if we build a login/connect screen.
- **Alternative monitoring API:** Tautulli can expose richer Plex history/statistics via its own API key, but it requires installing Tautulli separately.

### Implementation approach

1. Add Plex connection discovery using the existing `PLEX_TOKEN`:
   - Call Plex's official resources endpoint.
   - Find your server's available connections.
   - Prefer reachable `https://*.plex.direct:32400` connections.
   - Fall back to direct HTTP only if no secure Plex-discovered URL works.

2. Make `PLEX_URL` optional/fallback instead of the primary source:
   - If discovery succeeds, use the discovered Plex URL.
   - If discovery fails, use `PLEX_URL` as a manual fallback.

3. Improve the error shown in the dashboard:
   - Show whether failure is token/auth, no Plex server found, no reachable connection, TLS mismatch, or timeout.

4. Keep secrets unchanged for now:
   - `PLEX_TOKEN` remains required.
   - `PLEX_URL` can remain `http://faicu.go.ro:32400` as fallback.
   - No username/password needed.

### Optional later enhancement

Add a Plex Connect screen using Plex PIN auth so you can authorize from Plex directly instead of manually saving a token.