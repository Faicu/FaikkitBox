
# Plan: Sistem Admin + Pagina Actualizări

## 1. Autentificare Administrator

**Mecanism**: parolă partajată + cookie de sesiune criptat server-side (fără bază de date).

Secrets noi:
- `ADMIN_USER` = "Faicu"
- `ADMIN_PASS` = "FaikkitBox"
- `SESSION_SECRET` (generat automat, 64 chars)

Fișiere:
- `src/lib/admin.functions.ts` — `adminLogin({user, pass})`, `adminLogout()`, `getAdminStatus()`. Comparare timing-safe (SHA-256 + `timingSafeEqual`). Sesiune via `useSession` din `@tanstack/react-start/server`, cookie `httpOnly + secure + sameSite=lax`, 7 zile.
- Helper server-only `requireAdmin()` folosit în toate funcțiile privilegiate.

UI:
- `/login` — formular user + parolă, toast la eroare, redirect la `/` după succes.
- `AppHeader`: afișează un buton "Admin" (icon lock) → deschide `/login`; când e logat, afișează "Ieșire" + badge "Administrator".
- Query `adminStatusQuery` (React Query) folosit peste tot pentru a arăta/ascunde controalele.

## 2. Controale qBittorrent

Butoanele Stop/Resume (per torrent + Toate) există deja. Le condiționez cu `isAdmin` — vizitatorii neautentificați văd doar statisticile; adminul vede butoanele.

## 3. Pagina "Actualizări" (`/updates`, doar admin)

Route protejat (gate în `beforeLoad` care redirect la `/login` dacă nu e admin).

Server function `fetchVersions()`:
- **Plex**: `/identity` (currentVersion) + `https://plex.tv/api/downloads/5.json` (latest server version).
- **Immich**: `/api/server-info/version` + GitHub `repos/immich-app/immich/releases/latest`.
- **qBittorrent**: `/api/v2/app/version` + GitHub `repos/qbittorrent/qBittorrent/releases/latest`.

Afișare: 3 carduri (versiune curentă vs. ultima, badge "La zi" verde / "Actualizare disponibilă" portocaliu, link la changelog).

Butoane acțiuni (toate apelează agentul HTTP — vezi secțiunea 4):
- Restart Plex / Immich / qBittorrent (câte unul pe card).
- Secțiune "Sistem Ubuntu":
  - `apt-get update`
  - `apt-get upgrade -y`
  - **Clear DNS Cache** (`resolvectl flush-caches`)
- Pentru comenzi lungi: modal cu stream/output final + toast succes/eroare.

## 4. Agent HTTP pe mini-PC (necesar pentru SSH/restart)

Serverul Lovable rulează pe Cloudflare Workers — nu poate deschide SSH direct. Îți furnizez un script Python mic pe care îl instalezi pe mini-PC:

```
/opt/lovable-agent/agent.py  (FastAPI + uvicorn, port 8765, doar localhost + Cloudflare tunnel)
```

Endpoints (autentificate cu header `Authorization: Bearer $AGENT_TOKEN`):
- `POST /exec` `{cmd: "apt_update"|"apt_upgrade"|"flush_dns"|"restart_plex"|"restart_immich"|"restart_qbit"}` — allowlist strict, fără input liber, fiecare mapat la comandă hard-coded (`sudo systemctl restart plexmediaserver`, etc.).
- Răspuns: `{exit_code, stdout, stderr}`.

Îl expui prin același Cloudflare tunnel (ex: `https://agent.faicu.ro`).

Secrets noi:
- `AGENT_URL` = ex. `https://agent.faicu.ro`
- `AGENT_TOKEN` = token bearer random (îl generez eu 64 chars, îl pui și în agent).

În Lovable: `src/lib/agent.functions.ts` cu `runAgentCommand(cmd)` — protejat de `requireAdmin()`.

Îți dau la implementare scriptul complet + instrucțiuni instalare (systemd unit, sudoers pentru comenzile specifice, config Cloudflare tunnel).

## 5. Fișiere noi/modificate

Noi:
- `src/lib/admin.functions.ts`
- `src/lib/agent.functions.ts`
- `src/lib/versions.functions.ts`
- `src/routes/login.tsx`
- `src/routes/updates.tsx`
- `agent/agent.py` + `agent/README.md` (scriptul pentru mini-PC)

Modificate:
- `src/components/AppHeader.tsx` — buton Admin/Logout + badge.
- `src/components/BottomNav.tsx` — tab "Actualizări" vizibil doar când e admin.
- `src/routes/qbit.tsx` — gate `isAdmin` pe butoane.
- `src/lib/queries.ts` — query pentru admin status și versiuni.

## Detalii tehnice

- Cookie sesiune: `httpOnly`, `secure`, `sameSite=lax`, name `sm-admin`.
- Toate funcțiile de scriere / restart / SSH: `requireAdmin()` verifică sesiunea, altfel throw 401.
- Verificarea parolei: `timingSafeEqual` pe hash-uri SHA-256 (nu direct `===`).
- Query versiuni: cache 5 min ca să nu spamăm GitHub API (rate limit 60/h unauth — folosim `If-None-Match` + user-agent).
- Butoanele de acțiune: `useMutation` cu toast, disable + spinner cât rulează.

## Ce îmi trebuie de la tine după aprobare

1. Confirmi domeniul agentului (ex. `agent.faicu.ro`) sau îl setezi tu ulterior.
2. Instalezi scriptul agent după ce ți-l generez (îți dau pași clari).
