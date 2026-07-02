## Plan

Cloudflared ingress now points to `http://192.168.1.192:61208`. Verify the Host page loads live Glances data by polling the server function from the preview and reading the rendered Host page.

Steps:
1. Navigate the preview to `/host` and wait for the 2s poll to fire.
2. Read the visible page text — success looks like CPU/Memory/Disk numbers instead of an error card.
3. If it still fails, capture the exact error string (Cloudflare status, timeout, JSON parse) and adjust from there — e.g. some cloudflared setups strip the trailing slash and Glances is picky about `/api/3/all` vs `/api/3/all/`.

No code changes expected.
