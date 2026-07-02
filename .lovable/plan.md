## Problemă

Cardul "Rație" afișează `1044995792.00` pentru că qBit returnează `global_ratio: "0"` la pornire, iar fallback-ul actual `up_info_data / max(1, dl_info_data)` împarte octeții încărcați la 1 când nu s-a descărcat nimic încă în sesiune. Rezultatul: număr uriaș fără sens.

## Ce fac

qBit nu are un contor „per zi", dar are contoare de sesiune (`up_info_data` / `dl_info_data` din `/api/v2/transfer/info`), care se resetează la fiecare pornire a qBit — adică efectiv „de azi" în cazul tău (qBit-ul rulează continuu, resetat prin restart-ul zilnic sau la boot).

1. În `src/lib/services.functions.ts`:
   - Adaug două câmpuri noi în `QbitData`: `sessionDl: number`, `sessionUp: number` (din `xfer.dl_info_data` / `xfer.up_info_data`).
   - Elimin fallback-ul periculos din `globalRatio` — folosesc doar `global_ratio` real de la qBit (rația all-time, ce vezi și în client).

2. În `src/routes/qbit.tsx`:
   - Redenumesc cardul „Rație" → „Rație azi" și calculez `sessionUp / sessionDl`, cu guard:
     - dacă `sessionDl < 1 MB` și `sessionUp > 0` → afișez `∞`;
     - dacă ambele sunt 0 → afișez `0.00`;
     - altfel → `(sessionUp / sessionDl).toFixed(2)`.
   - Sub-textul cardului: `↑ formatBytes(sessionUp) · ↓ formatBytes(sessionDl)` ca să fie clar de unde vine numărul.
   - Cardul „Total descărcat / Total încărcat" rămân neschimbate (alltime).
   - Adaug un al 5-lea card mic sau reordonez ca să păstrez grid-ul 2×2 curat (rația all-time reală de la qBit o mut ca sub-text la „Total încărcat": `Rație totală X.XX`).

## Note

- Dacă vrei rație strict calendaristică „de la 00:00 azi" (nu de la ultima repornire qBit), avem nevoie de persistență (snapshot zilnic în DB) — activăm Lovable Cloud și adaug un job. Spune-mi dacă preferi asta; altfel merg pe sesiune, care e ce afișează și clientul qBit ca „Session".
