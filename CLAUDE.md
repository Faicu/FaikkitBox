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
4. `sudo systemctl start faikkitbox` — repornește serviciul cu build-ul nou

Nu raporta sarcina ca finalizată până când toți cei 4 pași nu au fost executați cu succes (serviciul activ, la final).

**Nu face `git push` singur.** Push-ul către GitHub se face manual, de utilizator,
din pagina Tehnic (buton dedicat) — vezi `pushToGitHub` în
`src/lib/github.functions.ts`. Commit-urile locale rămân nepublicate până când
utilizatorul apasă butonul; asta e intenționat, nu o eroare de urmărit sau reparat.
