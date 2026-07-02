## Sortare automată în lista expandabilă

În `src/routes/qbit.tsx`, în blocul `openList` unde construiesc `filtered`, adaug sortare după filtru:
- `downloading` → descrescător după `t.dlspeed`
- `seeding` → descrescător după `t.upspeed`
- `paused` → descrescător după `t.size` (fallback logic)

Sortarea rulează la fiecare render, deci se actualizează automat cu polling-ul de 1.1s din TanStack Query — fără cod suplimentar.

Atât — o singură modificare punctuală.
