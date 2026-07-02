## Setare AGENT_TOKEN

`AGENT_TOKEN` e un bearer token secret, generat aleator, folosit ca „parolă" între app și agentul de pe mini-PC. Trebuie să fie **identic** în ambele locuri.

### Pași

1. **Generez tokenul în Lovable Cloud**
   - Folosesc `generate_secret` pentru `AGENT_TOKEN` (64 caractere aleatoare).
   - După generare îți afișez valoarea o singură dată ca s-o poți copia pe mini-PC.

2. **Setezi și `AGENT_URL`** (dacă nu e deja) — URL-ul public al agentului expus prin Cloudflare Tunnel, ex: `https://agent.faicu.ro`.

3. **Pe mini-PC**, în directorul unde rulează `agent.py`, creezi `.env` cu:
   ```
   AGENT_TOKEN=<valoarea copiată de mai sus>
   ```
   apoi repornești serviciul agentului (`systemctl restart lovable-agent` sau cum l-ai configurat din `agent/README.md`).

4. **Test** — deschid `/updates` din app și apăs pe „Clear DNS Cache" ca să verific end-to-end că tokenul se potrivește (agentul răspunde 200) și comanda rulează.

### Detalii tehnice

- Tokenul e comparat în `agent.py` cu `hmac.compare_digest` (timing-safe) în handler-ul `/exec`.
- Din partea app, `runAgentCommand` (`src/lib/agent.functions.ts`) citește `process.env.AGENT_TOKEN` și îl trimite ca `Authorization: Bearer <token>`.
- Dacă vrei să-l rotești ulterior, folosim `update_secret` pentru Lovable + actualizezi `.env`-ul de pe mini-PC cu aceeași valoare.
