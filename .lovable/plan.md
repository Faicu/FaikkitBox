## Status

- Glances is now running on port 61208 (curl reached it — the 404 came from Glances, not the OS).
- Glances v3.4 uses `/api/3/`, which matches what `src/lib/services.functions.ts` already calls. **No code changes needed.**

## Remaining step (on your side)

Confirm the cloudflared tunnel ingress for `glances.faicu.ro` points to `http://localhost:61208`:

```bash
cat /etc/cloudflared/config.yml
```

The ingress rule should look like:
```yaml
- hostname: glances.faicu.ro
  service: http://localhost:61208
```

If it says `61209` (or anything else), fix it and:
```bash
sudo systemctl restart cloudflared
```

Then verify from anywhere:
```bash
curl -s https://glances.faicu.ro/api/3/all | head -c 200
```

Once that returns JSON, the Host page will go green within 2 seconds — no redeploy needed.

## If you'd like me to act

Paste the output of the two curl commands above and I'll confirm end-to-end, or say "test it" and I'll poll the server function from here.
