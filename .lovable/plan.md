## Plan

1. Store `GLANCES_URL = https://glances.faicu.ro/` as a runtime secret via `set_secret` (no user form needed — value is known).
2. Verify the Host page works by invoking the `getHost` server function and checking the response (status `ok` with CPU/mem/disk data means the reverse proxy is reachable from the Lovable server runtime).
3. Report back whether Glances responded successfully, or surface the error (e.g. Cloudflare 502, auth challenge from Zero Trust) so we can adjust.

### Notes
- No code changes needed — `src/lib/services.functions.ts` already reads `GLANCES_URL` from env.
- If Cloudflare Zero Trust requires a service-token (CF-Access-Client-Id / CF-Access-Client-Secret) because the app is behind an Access policy, the fetch will get an HTML login page instead of JSON. In that case we'll need to either bypass Access for this hostname or add the two service-token headers as additional secrets and send them from `getHost`.
