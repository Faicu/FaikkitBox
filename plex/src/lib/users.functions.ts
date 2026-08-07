import { createServerFn } from "@tanstack/react-start";
import { getPlexDb, hashPassword, verifyPassword, logActivity } from "./plex-db";
import { getSession, requireAdminUser, requireSessionUser } from "./auth.server";
import { pushToAdmins } from "./push-server";
import { discoverPlexUrl } from "@faikkitbox/lib/services/plex-shared";
import { fetchJson, fetchText } from "@faikkitbox/lib/services/shared";

type PlexAccountMatch = { username: string | null; email: string | null };

// Caută pe serverul Plex (owner + friends) un cont al cărui username SAU email
// se potrivește cu oricare dintre valorile date (username-ul și email-ul
// introduse la înregistrare). Returnează contul Plex REAL găsit (username +
// email așa cum sunt pe Plex, nu ce a introdus userul) — necesar pentru
// funcțiile care leagă activitatea Plex (vizionări, redare curentă) de
// userul din portal, unde nu putem presupune username-ul identic.
async function findPlexAccountMatch(
  candidates: string[],
): Promise<PlexAccountMatch | null> {
  const token = process.env.PLEX_TOKEN;
  if (!token) return { username: null, email: null }; // fail-open dacă nu avem token (nu blocăm portalul), fără match salvat
  const needles = candidates.map((c) => c.trim().toLowerCase()).filter(Boolean);
  if (needles.length === 0) return null;

  const isMatch = (username?: string, email?: string, title?: string) =>
    needles.some(
      (n) =>
        username?.toLowerCase() === n || email?.toLowerCase() === n || title?.toLowerCase() === n,
    );

  try {
    const account = await fetchJson<{ username?: string; email?: string }>(
      "https://plex.tv/api/v2/user",
      { headers: { Accept: "application/json", "X-Plex-Token": token } },
      8000,
    );
    if (isMatch(account.username, account.email)) {
      return { username: account.username ?? null, email: account.email ?? null };
    }
  } catch {
    // continuă cu friends
  }
  try {
    // /api/v2/friends a fost retras de Plex (răspunde 410 Gone) — lista de
    // utilizatori cu acces pe server e disponibilă în continuare doar prin
    // endpoint-ul XML mai vechi /api/users (fiecare <User> are title,
    // username, email ca atribute).
    const xml = await fetchText(
      "https://plex.tv/api/users",
      { headers: { "X-Plex-Token": token } },
      8000,
    );
    for (const match of xml.matchAll(/<User\b[^>]*>/g)) {
      const tag = match[0];
      const attr = (name: string) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];
      const username = attr("username");
      const email = attr("email");
      const title = attr("title");
      if (isMatch(username, email, title)) {
        return { username: username || title || null, email: email || null };
      }
    }
  } catch {
    return null;
  }
  return null;
}

export const registerUser = createServerFn({ method: "POST" })
  .validator(
    (data: { username: string; password: string; email: string; whatsapp: string }) => data,
  )
  .handler(async ({ data }) => {
    const username = data.username.trim();
    const email = data.email.trim();
    if (!username || !data.password || !email || !data.whatsapp) {
      throw new Error("Toate câmpurile sunt obligatorii.");
    }

    const plexMatch = await findPlexAccountMatch([username, email]);
    if (!plexMatch) {
      throw new Error("Niciun cont pe Plex cu acest Username sau Email. Încearcă din nou.");
    }

    const db = getPlexDb();
    const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
    if (existing) throw new Error("Acest username este deja folosit.");

    const info = db
      .prepare(
        `INSERT INTO users (username, password_hash, email, whatsapp, role, status, created_at, plex_username, plex_email)
         VALUES (?, ?, ?, ?, 'client', 'pending', datetime('now'), ?, ?)`,
      )
      .run(
        username,
        hashPassword(data.password),
        email,
        data.whatsapp,
        plexMatch.username,
        plexMatch.email,
      );

    const userId = Number(info.lastInsertRowid);
    const session = await getSession();
    await session.update({ userId, role: "client", status: "pending" });

    logActivity({ userId, action: "register", detail: username });
    await pushToAdmins("Cerere cont nou", `Utilizator nou: ${username}`);

    return { status: "ok" as const };
  });

export const loginUser = createServerFn({ method: "POST" })
  .validator((data: { username: string; password: string }) => data)
  .handler(async ({ data }) => {
    const db = getPlexDb();
    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(data.username) as
      | {
          id: number;
          password_hash: string;
          role: string;
          status: string;
          blocked: number;
        }
      | undefined;
    if (!user || !verifyPassword(data.password, user.password_hash)) {
      throw new Error("Username sau parolă greșită.");
    }

    const session = await getSession();
    await session.update({ userId: user.id, role: user.role, status: user.status });

    if (user.status === "pending") {
      return { status: "pending" as const };
    }
    if (user.status === "rejected") {
      throw new Error("Contul tău a fost respins.");
    }

    logActivity({ userId: user.id, action: "login" });
    return { status: "ok" as const, role: user.role };
  });

export const logoutUser = createServerFn({ method: "POST" }).handler(async () => {
  const session = await getSession();
  await session.clear();
  return { status: "ok" as const };
});

export const getCurrentUser = createServerFn({ method: "GET" }).handler(async () => {
  const session = await getSession();
  const userId = session.data.userId;
  if (!userId) return null;
  const db = getPlexDb();
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as
    | {
        id: number;
        username: string;
        role: string;
        status: string;
        blocked: number;
      }
    | undefined;
  return user ?? null;
});

export const listPendingUsers = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdminUser();
  const db = getPlexDb();
  return db.prepare("SELECT * FROM users WHERE status = 'pending' ORDER BY created_at").all();
});

export const approveUser = createServerFn({ method: "POST" })
  .validator((data: { userId: number }) => data)
  .handler(async ({ data }) => {
    await requireAdminUser();
    const db = getPlexDb();
    db.prepare(
      "UPDATE users SET status = 'approved', approved_at = datetime('now') WHERE id = ?",
    ).run(data.userId);
    logActivity({ userId: data.userId, action: "user_approved" });
    return { status: "ok" as const };
  });

export const rejectUser = createServerFn({ method: "POST" })
  .validator((data: { userId: number }) => data)
  .handler(async ({ data }) => {
    await requireAdminUser();
    const db = getPlexDb();
    db.prepare("DELETE FROM users WHERE id = ? AND status = 'pending'").run(data.userId);
    logActivity({ userId: null, action: "user_rejected", detail: String(data.userId) });
    return { status: "ok" as const };
  });

export const listAllUsers = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdminUser();
  const db = getPlexDb();
  return db.prepare("SELECT * FROM users ORDER BY created_at DESC").all();
});

export const setUserBlocked = createServerFn({ method: "POST" })
  .validator((data: { userId: number; blocked: boolean }) => data)
  .handler(async ({ data }) => {
    await requireAdminUser();
    const db = getPlexDb();
    db.prepare("UPDATE users SET blocked = ? WHERE id = ?").run(data.blocked ? 1 : 0, data.userId);
    logActivity({
      userId: data.userId,
      action: data.blocked ? "user_blocked" : "user_unblocked",
    });
    return { status: "ok" as const };
  });

export const deleteUser = createServerFn({ method: "POST" })
  .validator((data: { userId: number }) => data)
  .handler(async ({ data }) => {
    await requireAdminUser();
    const db = getPlexDb();
    db.prepare("DELETE FROM users WHERE id = ?").run(data.userId);
    return { status: "ok" as const };
  });

export const resetUserPassword = createServerFn({ method: "POST" })
  .validator((data: { userId: number; newPassword: string }) => data)
  .handler(async ({ data }) => {
    await requireAdminUser();
    const db = getPlexDb();
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
      hashPassword(data.newPassword),
      data.userId,
    );
    logActivity({ userId: data.userId, action: "password_reset" });
    return { status: "ok" as const };
  });

// Pentru pagina de așteptare (poll de status pending)
export const refreshMyStatus = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireSessionUser();
  return { status: user.status };
});
