## Modificări pe pagina `/qbit`

### 1. Elimină „Categorii"
Șterg blocul liniile 137-155 din `src/routes/qbit.tsx`. Nu ating `perCategory` din `services.functions.ts` (rămâne inofensiv în tip).

### 2. Afișează toate torrentele
În `src/lib/services.functions.ts` linia 711 scot `.slice(0, 40)` — mapez întreg `torrentsRaw`. Fără altă limită.

### 3. Cardurile „În descărcare" și „Seed" devin butoane cu listă
Grid-ul cu 3 pastile de la linia 103 devine interactiv:
- „În descărcare" (sky) și „Seed" (emerald) devin `<button>` — apăsare toggle deschide un panou dedesubt cu lista torrentelor filtrate.
- „Oprite" rămâne static (sau, pentru consistență, îl fac și pe el buton — confirm mai jos).
- Filtrarea se face client-side pe `data.torrents` după `state` folosind aceleași reguli ca `stateBadge` (`download*` → descărcare, `up*`/`stalledUP`/`uploading` → seed).
- Panoul afișează pentru fiecare intrare: nume (trunchiat), % progres, viteza corespunzătoare (↓ pentru descărcări, ↑ pentru seed). Design consecvent cu lista principală, dar compact.
- Dacă lista filtrată e goală → mesaj „Niciun torrent".
- Stare deschis/închis într-un `useState<"downloading" | "seeding" | null>`.

Notă: din moment ce ridic limita la 40, lista principală de „Torrente" va afișa tot ce e — asta e comportamentul cerut. Fac și pastila „Oprite" buton pentru simetrie (spune-mi dacă nu vrei).
