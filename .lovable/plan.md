## Diagnosis

Your Glances is running in **server mode** (`-s -B 127.0.0.1`), which exposes only the XML-RPC protocol on port **61209** for the Glances desktop client. Our app needs the **REST/Web API** on port **61208**, which requires the `-w` flag. That's why Cloudflare returns 502 — nothing is listening on the port the tunnel is trying to reach.

## Fix (on the mini-PC, no code changes needed)

Edit the systemd unit to use `-w` instead of `-s`:

```bash
sudo systemctl edit --full glances.service
```

Change the `ExecStart` line to:
```
ExecStart=/usr/bin/glances -w --disable-webui -B 127.0.0.1
```

- `-w` enables the REST API on port 61208
- `--disable-webui` skips the HTML UI (we only need the JSON API)
- `-B 127.0.0.1` keeps it bound to localhost (safe, cloudflared reaches it locally)

Then:
```bash
sudo systemctl daemon-reload
sudo systemctl restart glances
curl http://127.0.0.1:61208/api/4/all | head -c 200
```

If curl returns JSON, verify your cloudflared ingress for `glances.faicu.ro` points to `http://localhost:61208` (not 61209), restart cloudflared, and the Host page will go green within 2 seconds.

## If Glances is v4+

Newer Glances uses `/api/4/`. Our code currently calls `/api/3/all`. Once you confirm which version responds (`glances -V`), I'll update `src/lib/services.functions.ts` to try `/api/4` first and fall back to `/api/3`.

### Notes
- No app-side code changes until you confirm the API version and the tunnel reaches port 61208.
