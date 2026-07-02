## Problemă
`Rație totală` afișează `data.globalRatio`, luat din `/transfer/info → global_ratio`. Acest câmp e adesea `"0"` sau `"0.00"` la qBit (nu reflectă all-time, ci sesiunea curentă, și uneori nici atât). De aceea vezi 0.00 chiar dacă `alltime_ul`/`alltime_dl` sunt reale (8.4 TB).

## Fix
Calculăm rația all-time din valorile reale pe care deja le avem.

### `src/routes/qbit.tsx` (linia 112)
Înlocuiesc sub-eticheta de la cardul „Total încărcat" să calculeze:
```
rație = alltimeUp / max(alltimeDl, 1)
```
- Dacă `alltimeDl > 0` → afișez `Rație totală X.XX`.
- Dacă `alltimeDl == 0` și `alltimeUp > 0` → `Rație totală ∞`.
- Altfel → `Rație totală 0.00`.

Nu mai folosim `data.globalRatio` aici (rămâne totuși în tip pentru alte locuri).

Atât — o singură modificare punctuală în `qbit.tsx`, nu ating logica din server.
