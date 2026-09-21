import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Pe bază SQLite reală, ca la unfinished-torrents.test.ts: ce verificăm aici e
// chiar interogarea care decide dacă o sesiune mai e validă, iar un mock de DB
// ar testa mock-ul. `FAIKKITBOX_DB_PATH` se setează ÎNAINTE de import — getDb()
// citește calea o singură dată și apoi ține conexiunea în cache.
const dir = mkdtempSync(join(tmpdir(), "faikkitbox-auth-test-"));
process.env.FAIKKITBOX_DB_PATH = join(dir, "test.db");

type DbModule = typeof import("../db");
type AdminServer = typeof import("./admin.server");

let isAccountLive: AdminServer["isAccountLive"];
let db: ReturnType<DbModule["getDb"]>;

function insertUser(username: string, role: "admin" | "user", status: string): number {
  db.prepare(
    "INSERT INTO users (username, password_hash, role, status) VALUES (?, 'x:y', ?, ?)",
  ).run(username, role, status);
  const row = db.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id: number };
  return row.id;
}

beforeAll(async () => {
  ({ isAccountLive } = await import("./admin.server"));
  const { getDb } = (await import("../db")) as DbModule;
  db = getDb();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

// Regresie pentru gaura reparată pe 20 sept. 2026: cookie-ul de sesiune e
// semnat și ține 7 zile, deci „revocă accesul" din pagina Utilizatori nu avea
// niciun efect asupra sesiunilor deja emise. Verificarea din `liveAccount` e
// singurul lucru care leagă o sesiune de starea reală a contului.
describe("isAccountLive", () => {
  it("acceptă un cont aprobat și întoarce rolul lui", async () => {
    const id = insertUser("aprobat", "user", "approved");
    expect(await isAccountLive(id)).toBe("user");
  });

  it("întoarce rolul curent, nu cel cu care s-a făcut login", async () => {
    const id = insertUser("promovat", "user", "approved");
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(id);
    expect(await isAccountLive(id)).toBe("admin");

    // Și invers: o retrogradare trebuie să se vadă imediat, nu la expirarea
    // cookie-ului care încă poartă `admin: true`.
    db.prepare("UPDATE users SET role = 'user' WHERE id = ?").run(id);
    expect(await isAccountLive(id)).toBe("user");
  });

  it("respinge un cont care așteaptă aprobare", async () => {
    const id = insertUser("in_asteptare", "user", "pending");
    expect(await isAccountLive(id)).toBeNull();
  });

  it("respinge un cont șters", async () => {
    const id = insertUser("sters", "user", "approved");
    expect(await isAccountLive(id)).toBe("user");
    db.prepare("DELETE FROM users WHERE id = ?").run(id);
    expect(await isAccountLive(id)).toBeNull();
  });

  it("respinge un id care n-a existat niciodată", async () => {
    expect(await isAccountLive(999_999)).toBeNull();
  });
});
