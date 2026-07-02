## Modificări pe pagina principală (`/`)

### 1. Plex — extindere card

Înlocuiesc cele două metrici actuale ("Se redă acum", "Biblioteci") cu:

- **Câți se uită acum** — listă cu numele utilizatorilor din `plex.sessions` (sau "Nimeni" dacă e goală)
- **Episoade vizionate astăzi** — număr de intrări din istoric cu `type === "episode"` și `viewedAt` în ziua curentă locală
- **Utilizatori activi azi** — număr de utilizatori unici din istoricul zilei (orice tip vizionat)

**Modificări cod:**

- `src/lib/services.functions.ts` (`PlexData` + `getPlex`): calculez din `history` deja fetchat și adaug câmpurile `episodesToday: number`, `activeUsersToday: number`. Ziua = de la miezul nopții local server, comparat cu `viewedAt * 1000`.
- `src/routes/index.tsx`: card Plex primește layout nou — un rând "Se uită acum" (listă compactă de nume sau "—") + două `Metric` pentru "Episoade azi" și "Utilizatori activi azi".

### 2. Immich — adaug "Sarcini în curs"

Păstrez "Fișiere" și "Spațiu", adaug al treilea `Metric`:

- **Sarcini în curs** — `immich.jobQueueDepth ?? sum(activeJobs.active + waiting)` (deja calculat).

Layout devine grid pe 3 coloane pe cardul Immich.

### 3. qBittorrent — schimb "Active"

Al treilea `Metric` devine formatul `X / Y`:

- **Active**: `counts.downloading + counts.seeding` / `counts.total`
- Etichetă: "Active"
- Prima două rămân "↓" și "↑".

Nicio modificare la datele existente.

### 4. Gazdă — grafic nou

Elimin `<Meter>`-ele orizontale de acolo și pun **3 gauge-uri circulare** (SVG conic) aliniate pe un rând, cu procent în centru:

- **Procesor** — `cpuPercent`
- **Memorie** — `memPercent`
- **Rețea** — total `rxSec + txSec` al interfețelor din `data.net`, afișat ca text mare sub un mini-inel de activitate (procent față de un maxim mobil în ultima sesiune — dacă e prea complicat, doar valoare `formatSpeed` cu ↓/↑ separate)

**Componentă nouă:** `src/components/RadialGauge.tsx` — SVG simplu, `size`, `value` (0-100), `label`, `centerText`, culoare temă (folosește `text-primary`, `text-emerald-400`, `text-sky-400`).

**Toate etichetele rămân în română.**

---

### Fișiere modificate

- `src/lib/services.functions.ts` — adaug `episodesToday`, `activeUsersToday` în `PlexData` și calculez în `getPlex`
- `src/routes/index.tsx` — refac cele 4 carduri de servicii
- `src/components/RadialGauge.tsx` — componentă nouă

### Verificare

`tsgo --noEmit` + inspecție vizuală pe `/`.