import type { getDb } from "../db";

type Db = ReturnType<typeof getDb>;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type LoginRow = {
  id: number;
  username: string;
  password_hash: string;
  role: string;
  status: string;
  session_version: number;
};

const LOGIN_COLUMNS = "id, username, password_hash, role, status, session_version";

// Câmpul de login acceptă username sau email. „@” decide ce e — de asta
// username-urile cu „@” sunt refuzate la creare (vezi validateNewAccount).
// Emailul nu e UNIQUE în schemă; dacă tot apare un duplicat, nu ghicim contul.
export function findLoginAccount(
  db: Db,
  input: string,
): { row: LoginRow } | { ambiguous: true } | null {
  const value = input.trim();
  if (!value) return null;
  if (!value.includes("@")) {
    const row = db.prepare(`SELECT ${LOGIN_COLUMNS} FROM users WHERE username = ?`).get(value) as
      | LoginRow
      | undefined;
    return row ? { row } : null;
  }
  const rows = db
    .prepare(`SELECT ${LOGIN_COLUMNS} FROM users WHERE lower(trim(email)) = lower(?)`)
    .all(value) as LoginRow[];
  if (rows.length > 1) return { ambiguous: true };
  return rows.length === 1 ? { row: rows[0] } : null;
}

// Regulile comune pentru conturi noi (înregistrare și admin adăugat din
// Utilizatori), ca ambele căi să păstreze emailul neambiguu la login.
export function validateNewAccount(db: Db, username: string, email: string): string | null {
  if (username.includes("@")) return "Username-ul nu poate conține „@”.";
  if (!EMAIL_RE.test(email)) return "Email invalid.";
  if (db.prepare("SELECT 1 FROM users WHERE username = ?").get(username)) {
    return "Există deja un cont cu acest nume.";
  }
  if (db.prepare("SELECT 1 FROM users WHERE lower(trim(email)) = lower(?)").get(email)) {
    return "Email-ul e deja folosit de alt cont.";
  }
  return null;
}
