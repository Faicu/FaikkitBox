import { createServerFn } from "@tanstack/react-start";

// Ferestre de limitare pentru login (vezi auth/rate-limit.ts). Generoase cât
// să nu deranjeze pe cineva care greșește parola de câteva ori, dar suficient
// de strânse cât să facă ghicirea prin forță brută nepractică.
const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_MAX_PER_IP = 15;
const LOGIN_MAX_PER_USER = 8;

export const adminLogin = createServerFn({ method: "POST" })
  .validator((data: { user: string; pass: string }) => data)
  .handler(async ({ data }) => {
    const { getSession } = await import("./admin.server");
    const { getDb } = await import("../db");
    const { verifyPassword } = await import("./password");
    const { hitRateLimit, resetRateLimit, formatRetryAfter } = await import("./rate-limit");
    const { getClientIp } = await import("../client-ip.server");
    const { findLoginAccount } = await import("./account-identity.server");

    // Două limite complementare: una per IP (oprește o rafală de pe o singură
    // sursă, indiferent ce conturi încearcă) și una per cont (oprește un atac
    // distribuit concentrat pe un singur cont). Cheia per cont e id-ul când
    // contul există, ca username-ul și emailul să nu aibă fiecare limita lui.
    const ip = await getClientIp();
    const db = getDb();
    const found = findLoginAccount(db, data.user);
    const accountKey =
      found && "row" in found ? `id:${found.row.id}` : data.user.trim().toLowerCase();
    const perIp = hitRateLimit(`login:ip:${ip}`, LOGIN_MAX_PER_IP, LOGIN_WINDOW_MS);
    const perUser = hitRateLimit(`login:user:${accountKey}`, LOGIN_MAX_PER_USER, LOGIN_WINDOW_MS);
    if (!perIp.allowed || !perUser.allowed) {
      const wait = Math.max(perIp.retryAfterSec, perUser.retryAfterSec);
      return {
        ok: false as const,
        error: `Prea multe încercări. Reîncearcă peste ${formatRetryAfter(wait)}.`,
      };
    }

    if (found && "ambiguous" in found) {
      return {
        ok: false as const,
        error: "Email-ul aparține mai multor conturi — autentifică-te cu username-ul.",
      };
    }
    const row = found?.row;
    if (!row || !verifyPassword(data.pass, row.password_hash)) {
      return { ok: false as const, error: "Utilizator sau parolă greșită." };
    }
    if (row.status !== "approved") {
      return {
        ok: false as const,
        error: "Contul așteaptă aprobare din partea unui administrator.",
      };
    }

    const session = await getSession();
    await session.update({
      admin: row.role === "admin",
      userId: row.id,
      username: row.username,
      role: row.role as "admin" | "user",
      sessionVersion: row.session_version,
    });

    // Autentificare reușită — contorul de încercări se stinge, ca un login
    // corect după câteva greșeli să nu lase userul limitat degeaba.
    resetRateLimit(`login:ip:${ip}`);
    resetRateLimit(`login:user:${accountKey}`);

    const { getRequestHeader } = await import("@tanstack/react-start/server");
    const userAgent = getRequestHeader("user-agent") ?? null;
    db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(row.id);
    db.prepare("INSERT INTO user_logins (user_id, ip, user_agent) VALUES (?, ?, ?)").run(
      row.id,
      // "unknown" e doar santinela pentru cheia de rate limit — în istoricul
      // de autentificări păstrăm NULL, ca înainte.
      ip === "unknown" ? null : ip,
      userAgent,
    );

    return { ok: true as const };
  });

export const adminLogout = createServerFn({ method: "POST" }).handler(async () => {
  const { getSession } = await import("./admin.server");
  const session = await getSession();
  await session.clear();
  return { ok: true as const };
});

export const getAdminStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { getSession, isAccountLive } = await import("./admin.server");
  const session = await getSession();
  const userId = session.data.userId;

  // Aceeași verificare pe care o fac `requireAuth`/`requireAdmin`, ca UI-ul să
  // nu rămână „logat" pentru un cont căruia i s-a revocat accesul — altfel ar
  // arăta butoanele și ar lua 401 la fiecare apăsare, fără explicație.
  const role = userId ? await isAccountLive(userId, session.data.sessionVersion) : null;
  if (userId && !role) {
    await session.clear();
    return { isAdmin: false, isAuthenticated: false, username: null, role: null };
  }

  return {
    isAdmin: role === "admin",
    isAuthenticated: !!userId,
    username: session.data.username ?? null,
    role: (role as "admin" | "user" | null) ?? null,
  };
});

// ---------------------------------------------------------------------------
// Gestionare conturi admin (necesită login admin) — vezi pagina Utilizatori
// ---------------------------------------------------------------------------

export const addAdminUser = createServerFn({ method: "POST" })
  .validator((data: { username: string; email: string; password: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin();

    const username = data.username.trim();
    const email = data.email.trim();
    if (!username || !email || data.password.length < 8) {
      return { ok: false, error: "Utilizator sau email necompletat, ori parolă sub 8 caractere." };
    }

    const { getDb } = await import("../db");
    const { hashPassword } = await import("./password");
    const { validateNewAccount } = await import("./account-identity.server");
    const db = getDb();

    const invalid = validateNewAccount(db, username, email);
    if (invalid) return { ok: false, error: invalid };

    db.prepare(
      "INSERT INTO users (username, password_hash, email, role, status) VALUES (?, ?, ?, 'admin', 'approved')",
    ).run(username, hashPassword(data.password), email);
    return { ok: true };
  });

export const deleteAdminUser = createServerFn({ method: "POST" })
  .validator((data: { id: number }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin();

    const { getDb } = await import("../db");
    const db = getDb();

    const count = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get() as {
      c: number;
    };
    if (count.c <= 1) {
      return { ok: false, error: "Nu poți șterge singurul cont admin rămas." };
    }

    db.prepare("DELETE FROM users WHERE id = ? AND role = 'admin'").run(data.id);
    return { ok: true };
  });
