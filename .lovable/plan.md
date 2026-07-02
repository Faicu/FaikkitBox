
## Modificări

### 1. `agent/agent.py` (pe mini-PC)
- Mărește `timeout=600` → `timeout=1800` (30 min) pentru comenzi lungi (ex. `apt upgrade`).
- Nu mai trunchia output-ul: elimină `[-4000:]` și returnează `stdout`/`stderr` complete.
- Modifică handler-ul `flush_dns` să ruleze o secvență: `resolvectl flush-caches`, apoi `sleep 2`, apoi `systemctl restart qbittorrent-nox`; concatenând output-urile în răspuns. Implementat printr-un caz special în `exec_cmd` (listă de comenzi cu delay între ele) — restul rămân o singură comandă.

### 2. `src/lib/agent.functions.ts`
- Mărește timeout-ul fetch de la 120s → 1800s (aliniat cu agentul) ca să nu abandoneze cererea înainte ca `apt upgrade` să termine.

### 3. `src/routes/updates.tsx`
- Afișează output-ul complet: scoate `max-h-72` de pe `<pre>` (sau înlocuiește cu `max-h-none`) ca să nu mai fie tăiat vizual; păstrează scroll-ul opțional cu `overflow-auto` doar pe orizontală. Adaugă buton mic „Copiază" care copiază `stdout+stderr` în clipboard.
- Etichetează butonul „Clear DNS Cache" ca „Clear DNS Cache + repornește qBittorrent" pentru claritate.
- Adaugă un indicator vizibil „Se rulează... (poate dura câteva minute)" cât timp mutation-ul e `pending`, ca să fie clar că nu s-a blocat.

### Note
- Utilizatorul trebuie să repornească agentul pe mini-PC după update (`sudo systemctl restart lovable-agent`) ca modificările din `agent.py` să fie active.
- Cloudflare Tunnel poate impune propriul timeout (~100s implicit pe unele setup-uri); dacă `apt upgrade` tot se termină prematur cu eroare de rețea, va trebui ajustat `proxy_read_timeout`/`connectTimeout` pe tunel — voi menționa asta în răspuns.
