import { createServerFn } from "@tanstack/react-start";
import { getPlexDb, hashPassword, verifyPassword, logActivity } from "./plex-db";
import { getSession, requireAdminUser, requireSessionUser } from "./auth.server";
import { pushToAdmins } from "./push";
import { discoverPlexUrl } from "@faikkitbox/lib/services/plex-shared";
import { fetchJson } from "@faikkitbox/lib/services/shared";

async function plexAccountMatches(usernameOrEmail: string): Promise<boolean> {
  const token = process.env.PLEX_TOKEN;
  if (!token) return true; // fail-open dacă nu avem token configurat (nu blocăm total portalul)
  const needle = usernameOrEmail.trim().toLowerCase();
  try {
    // Owner-ul contului
    const account = await fetchJson<{ username?: string; email?: string }>(
      "https://plex.tv/api/v2/user",
      { headers: { Accept: "application/json", "X-Plex-Token": token } },
      8000,
    );
    if (account.username?.toLowerCase() === needle || account.email?.toLowerCase() === needle) {
      return true;
    }
  } catch {
    // continuă cu friends
  }
  try {
    const friends = await fetchJson<
      Array<{ username?: string; email?: string; title?: string }>
    >(
      "https://plex.tv/api/v2/friends",
      { headers: { Accept: "application/json", "X-Plex-Token": token } },
      8000,
    );
    return friends.some(
      (f) =>
        f.username?.toLowerCase() === needle ||
        f.email?.toLowerCase() === needle ||
        f.title?.toLowerCase() === needle,
    );
  } catch {
    return false;
  }
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

    const matches = await plexAccountMatches(username) || (await plexAccountMatches(email));
    if (!matches) {
      throw new Error("Niciun cont pe Plex cu acest Username sau Email. Încearcă din nou.");
    }

    const db = getPlexDb();
    const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
    if (existing) throw new Error("Acest username este deja folosit.");

    const info = db
      .prepare(
        `INSERT INTO users (username, password_hash, email, whatsapp, role, status, created_at)
         VALUES (?, ?, ?, ?, 'client', 'pending', datetime('now'))`,
      )
      .run(username, hashPassword(data.password), email, data.whatsapp);

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
