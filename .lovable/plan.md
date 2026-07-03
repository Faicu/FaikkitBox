## Ce este de făcut

### 1. Pagina principală — număr corect "Vizionate azi"

**Cauza probabilă a lui 0:**
- `startOfTodaySec` se calculează cu `new Date().setHours(0,0,0,0)`, dar codul rulează în Cloudflare Worker (UTC). Dacă ora locală este dimineața devreme sau seara târziu, "azi" în UTC e altă zi decât "azi" al utilizatorului → episoade omise.
- Contorul incrementează doar pentru `e.type === "episode" || e.grandparentTitle`. Un film vizionat azi nu se numără.

**Fix:**
- În `src/lib/services.functions.ts` schimbă `episodesToday` să numere **orice** vizionare de azi (episoade + filme), redenumit conceptual "vizionări azi".
- Calculează începutul zilei în fusul orar `Europe/Bucharest` (UTC+2/+3), nu în UTC-ul worker-ului.
- Salvează în cache pentru fiecare vizionare de azi și lista completă: `{ title, show, season, episode, type, viewedAt, user }` → nou câmp `todayViews: PlexTodayView[]`.
- Adaugă și `activeUsersTodayList: Array<{ user: string; count: number }>` (utilizatori distincți azi + câte vizionări).

### 2. Pagina principală — carduri interactive

În `src/routes/index.tsx`:
- Redenumește "Episoade azi" → **"Vizionate Azi"**.
- Transformă cele două `Metric` (Vizionate Azi + Utilizatori activi azi) în **butoane** care deschid câte un `Drawer`.
- Împiedică `Link`-ul părinte să navigheze când apeși pe butoane (`e.preventDefault()` + `e.stopPropagation()`).
- **Drawer "Vizionate Azi"**: listă cu titlu (serial/film + SxxEyy dacă e cazul), ora exactă (`toLocaleTimeString`), utilizator, tip badge.
- **Drawer "Utilizatori activi azi"**: listă utilizatori + număr episoade/filme vizionate, sortat descrescător.

### 3. Pagina Plex — istoric global

În `src/routes/plex.tsx`, adaugă o nouă secțiune **"Istoric vizionări"** (ultimele 10) după "Top spectatori":
- Sursă: nou câmp în `PlexData` — `recentHistory: PlexHistoryEntry[]` cu `user` inclus, primele 10 din istoricul complet (sortat desc după `viewedAt`).
- Afișare: card cu titlu (serial + SxxEyy sau film), utilizator, dispozitiv (dacă există), timestamp complet.

### Modificări tehnice

**`src/lib/services.functions.ts`**
- Extinde tipul `PlexHistoryEntry` cu `user?: string` (opțional, pt. compat).
- Adaugă tip nou `PlexTodayView = PlexHistoryEntry & { user: string }`.
- În `PlexData` adaugă: `todayViews?: PlexTodayView[]`, `activeUsersTodayList?: Array<{ user: string; count: number }>`, `recentHistory?: PlexTodayView[]`.
- În `fetchPlexHistory`:
  - Calculează începutul zilei local (Europe/Bucharest) folosind offset-ul curent.
  - Numără **toate** vizionările de azi în `episodesToday`.
  - Populează `todayViews`, `activeUsersTodayList`, `recentHistory` (primele 10 global).

**`src/routes/index.tsx`**
- Importă `Drawer`.
- State local: `openDrawer: "views" | "users" | null`.
- Refactorizează cele 2 `Metric` în `<button>` cu `onClick` care oprește propagarea și setează drawer-ul.
- Randează cele 2 `Drawer`-uri cu listele.

**`src/routes/plex.tsx`**
- Adaugă secțiune "Istoric vizionări" cu `data.recentHistory`.

Fără modificări la backend, agent, sau alte servicii.
