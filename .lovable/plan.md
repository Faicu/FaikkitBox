## Problemă

În `fetchPlexHistory` (src/lib/services.functions.ts, linia 238), numele utilizatorului se ia din `e.User?.title`. Endpoint-ul `/status/sessions/history/all` returnat ca JSON nu include obiectul `User` pe fiecare intrare — doar `accountID` (număr). În plus, ternarul actual e greșit logic:

```
e?.accountID != null ? e?.User?.title ?? e?.title ?? `user ${e.accountID}` : e?.User?.title ?? ""
```

Rezultat: toți utilizatorii ajung în bucket-ul `"Unknown"` sau primesc etichete generice, iar "Top Spectatori" nu afișează nume reale.

## Soluție

1. În `fetchPlexHistory`, înainte de agregare, apelez `${url}/accounts` (JSON) și construiesc `Map<number, string>` din `MediaContainer.Account[]` cu `id` → `name` (fallback `title`). Erorile la /accounts nu opresc restul (try/catch, map gol).
2. Pentru fiecare intrare din istoric, calculez `user`:
   - Dacă `e.accountID != null` → nume din map; fallback `User.title`; fallback `Utilizator #<id>`.
   - Dacă lipsește complet → `"Necunoscut"`.
3. Elimin bucket-ul `"Unknown"` din top (skip intrări fără user identificabil dacă map-ul e gol și `accountID` lipsește).
4. Cache-ul de 60s rămâne — accounts sunt luate în același ciclu.

## Fișiere

- `src/lib/services.functions.ts` — funcția `fetchPlexHistory` (parse accounts + fix maparea user-ului).

Nicio schimbare de UI; `topWatchers[].user` va conține numele real.
