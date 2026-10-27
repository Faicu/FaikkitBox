import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Bază SQLite reală, ca în account-status.test.ts; calea se setează înainte de import.
const dir = mkdtempSync(join(tmpdir(), "faikkitbox-identity-test-"));
process.env.FAIKKITBOX_DB_PATH = join(dir, "test.db");

type Identity = typeof import("./account-identity.server");

let findLoginAccount: Identity["findLoginAccount"];
let validateNewAccount: Identity["validateNewAccount"];
let db: ReturnType<typeof import("../db")["getDb"]>;

function insertUser(username: string, email: string | null): number {
  db.prepare(
    "INSERT INTO users (username, password_hash, email, role, status) VALUES (?, 'x:y', ?, 'user', 'approved')",
  ).run(username, email);
  return (db.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id: number }).id;
}

beforeAll(async () => {
  ({ findLoginAccount, validateNewAccount } = await import("./account-identity.server"));
  db = (await import("../db")).getDb();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("findLoginAccount", () => {
  it("găsește contul după username sau după email, indiferent de majuscule la email", () => {
    const id = insertUser("Ana", "ana@example.com");
    expect(findLoginAccount(db, "Ana")).toMatchObject({ row: { id } });
    expect(findLoginAccount(db, "  ANA@Example.com ")).toMatchObject({ row: { id } });
    expect(findLoginAccount(db, "nimeni@example.com")).toBeNull();
    expect(findLoginAccount(db, "")).toBeNull();
  });

  it("nu ghicește contul când emailul e duplicat", () => {
    insertUser("dup1", "dup@example.com");
    insertUser("dup2", "DUP@example.com");
    expect(findLoginAccount(db, "dup@example.com")).toEqual({ ambiguous: true });
  });
});

describe("validateNewAccount", () => {
  it("refuză username cu @, email invalid, username sau email deja folosit", () => {
    insertUser("Bogdan", "bogdan@example.com");
    expect(validateNewAccount(db, "a@b", "x@example.com")).toMatch(/@/);
    expect(validateNewAccount(db, "nou", "nu-e-email")).toBe("Email invalid.");
    expect(validateNewAccount(db, "Bogdan", "alt@example.com")).toMatch(/nume/);
    expect(validateNewAccount(db, "nou", "BOGDAN@example.com")).toMatch(/deja folosit/);
    expect(validateNewAccount(db, "nou", "nou@example.com")).toBeNull();
  });
});
