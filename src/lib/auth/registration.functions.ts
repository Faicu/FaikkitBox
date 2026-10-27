import { createServerFn } from "@tanstack/react-start";

// Înregistrarea e o acțiune rară și deliberată — o limită strânsă nu deranjează
// pe nimeni real, dar taie sondarea automată a listei de conturi Plex.
const REGISTER_WINDOW_MS = 60 * 60_000;
const REGISTER_MAX_PER_IP = 6;

export const registerUser = createServerFn({ method: "POST" })
  .validator((data: { username: string; password: string; email: string; phone: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    // Limitare per IP: înregistrarea interoghează lista de prieteni Plex
    // (matchPlexAccount), deci fără limită era și un oracol de enumerare —
    // se putea afla, cerere cu cerere, ce username/email are acces la
    // bibliotecă, fără niciun cont.
    const { hitRateLimit, formatRetryAfter } = await import("./rate-limit");
    const { getClientIp } = await import("../client-ip.server");
    const ip = await getClientIp();
    const limit = hitRateLimit(`register:ip:${ip}`, REGISTER_MAX_PER_IP, REGISTER_WINDOW_MS);
    if (!limit.allowed) {
      return {
        ok: false,
        error: `Prea multe încercări de înregistrare. Reîncearcă peste ${formatRetryAfter(limit.retryAfterSec)}.`,
      };
    }

    const username = data.username.trim();
    const email = data.email.trim();
    const phone = data.phone.trim();

    if (!username || !email || !phone) {
      return { ok: false, error: "Toate câmpurile sunt obligatorii." };
    }
    if (data.password.length < 8) {
      return { ok: false, error: "Parola trebuie să aibă minim 8 caractere." };
    }

    const { getDb } = await import("../db");
    const { validateNewAccount } = await import("./account-identity.server");
    const db = getDb();

    const invalid = validateNewAccount(db, username, email);
    if (invalid) return { ok: false, error: invalid };

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
    ).run(
      username,
      hashPassword(data.password),
      email,
      phone,
      plexMatch.id,
      plexMatch.username,
      plexMatch.email,
    );

    const { logActivity } = await import("../activity-log");
    await logActivity(
      "account_request",
      `Cerere nouă de aprobare cont: ${username} (Plex: ${plexMatch.username})`,
    );

    return { ok: true };
  });
