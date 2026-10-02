import { describe, it, expect } from "vitest";
// h3-v2 = h3-ul din TanStack Start, care emite cookie-ul de login; h3 = cel din
// Nitro, folosit de rutele brute din server/routes/api (plex-thumb).
import * as tanstackH3 from "h3-v2";
import * as nitroH3 from "h3";

// Plasă pentru delogarea din 2 oct 2026: după actualizarea Nitro, h3-ul lui
// rescria cookie-ul în alt format, pe care TanStack nu-l mai putea citi.
// plex-thumb citește acum sesiunea fără s-o rescrie — asta merge doar cât
// timp h3-ul din Nitro poate citi ce sigilează TanStack. Dacă testul pică
// după un `npm update`, rutele brute nu mai recunosc login-ul.
const config = { password: "p".repeat(40), name: "sm-admin", maxAge: 60 * 60 * 24 * 7 };

describe("cookie-ul de sesiune între h3-ul TanStack și cel din Nitro", () => {
  it("rutele brute citesc sesiunea emisă la login", async () => {
    const session = { id: "s1", createdAt: Date.now(), data: { userId: 1, role: "admin" } };
    const event = { context: { sessions: { [config.name]: session } } };
    const sealed = await tanstackH3.sealSession(event as never, config);
    const read = await nitroH3.unsealSession(event as never, config, sealed);
    expect(read.data).toEqual({ userId: 1, role: "admin" });
  });
});
