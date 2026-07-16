# FaikkitBox — instrucțiuni pentru Claude

## Workflow obligatoriu după orice modificare de cod

La finalul fiecărei sarcini care implică modificări de fișiere, execută întotdeauna, în ordine:

1. `npm run build` — verifică că build-ul trece fără erori
2. `git add <fișierele modificate>` + `git commit` cu un mesaj descriptiv
3. `git push origin main` — sincronizează cu github.com/Faicu/FaikkitBox
4. `systemctl restart faikkitbox` — aplică modificările pe server

Nu raporta sarcina ca finalizată până când toți cei 4 pași nu au fost executați cu succes.
