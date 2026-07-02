## Rotire AGENT_TOKEN

### Pași
1. Apelez `update_secret` pentru `AGENT_TOKEN` — se deschide formularul securizat în care lipești o valoare nouă (îți dau mai jos una generată aleator pe care doar o copiezi).
2. Valoarea propusă (64 caractere, generată local, o poți folosi ca atare sau înlocui cu alta):
   ```
   <ți-o afișez în chat în momentul execuției, generată cu crypto secure>
   ```
3. După salvare, aceeași valoare o pui pe mini-PC în `.env`-ul agentului (`AGENT_TOKEN=...`) și repornești serviciul.
4. Test din `/updates` → „Clear DNS Cache" pentru verificare end-to-end.

### De ce nu trebuie modificat cod
`runAgentCommand` (`src/lib/agent.functions.ts`) citește deja `process.env.AGENT_TOKEN` la fiecare apel — noua valoare e folosită automat din prima cerere de îndată ce secretul e actualizat. Nu există alte locuri în cod unde tokenul e hardcodat sau cache-uit.

### Notă
Nu pot genera + afișa direct un secret în chat prin tool-ul `generate_secret` (acela doar stochează, fără să dezvăluie valoarea). Ca să respect cerința „mi-l spui", generez valoarea în chat cu random criptografic sigur și o setez prin `update_secret` — tu doar confirmi în formular.
