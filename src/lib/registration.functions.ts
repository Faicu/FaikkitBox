import { createServerFn } from "@tanstack/react-start";

export const registerUser = createServerFn({ method: "POST" })
  .validator(
    (data: { username: string; password: string; email: string; phone: string }) => data,
  )
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    const username = data.username.trim();
    const email = data.email.trim();
    const phone = data.phone.trim();

    if (!username || !email || !phone) {
      return { ok: false, error: "Toate câmpurile sunt obligatorii." };
    }
    if (data.password.length < 8) {
      return { ok: false, error: "Parola trebuie să aibă minim 8 caractere." };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, error: "Email invalid." };
    }

    const { getDb } = await import("./db");
    const db = getDb();

    const exists = db.prepare("SELECT 1 FROM users WHERE username = ?").get(username);
    if (exists) {
      return { ok: false, error: "Există deja un cont cu acest nume." };
    }

    const { matchPlexAccount } = await import("./plex-users.server");
    const plexMatch = await matchPlexAccount(username, email);
    if (!plexMatch) {
      return {
        ok: false,
        error:
          "Username-ul sau email-ul trebuie să corespundă unui cont din biblioteca Plex. Verifică datele introduse.",
      };
    }

    const { hashPassword } = await import("./password");
    db.prepare(
      `INSERT INTO users (username, password_hash, email, phone, role, status, plex_account_id, plex_username, plex_email)
       VALUES (?, ?, ?, ?, 'user', 'pending', ?, ?, ?)`,
    ).run(username, hashPassword(data.password), email, phone, plexMatch.id, plexMatch.username, plexMatch.email);

    return { ok: true };
  });
