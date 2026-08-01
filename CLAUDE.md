# FaikkitBox — instrucțiuni pentru Claude

## Workflow obligatoriu după orice modificare de cod

La finalul fiecărei sarcini care implică modificări de fișiere, execută întotdeauna, în ordine:

1. `sudo systemctl stop faikkitbox` — oprește serviciul **înainte** de build
2. `npm run build` — verifică că build-ul trece fără erori. `npm run build` scrie
   direct peste `.output/server/`, folosit de procesul live pentru chunk-uri
   SSR încărcate dinamic; dacă serviciul rulează în timpul build-ului, o
   cerere poate nimeri exact în fereastra în care fișierele vechi au fost
   deja șterse/redenumite, dând `ERR_MODULE_NOT_FOUND` (a apărut recurent în
   istoric — vezi Jurnalul de Activitate / Erori aplicație). De asta build-ul
   rulează cu serviciul oprit, nu invers.
   - Dacă build-ul eșuează: repară și repetă până trece — serviciul rămâne
     oprit între timp, nu-l lăsa așa la finalul sesiunii.
3. `git add <fișierele modificate>` + `git commit` cu un mesaj descriptiv
4. `git push origin main` — sincronizează cu github.com/Faicu/FaikkitBox
5. `sudo systemctl start faikkitbox` — repornește serviciul cu build-ul nou

Nu raporta sarcina ca finalizată până când toți cei 5 pași nu au fost executați cu succes (serviciul activ, la final).
