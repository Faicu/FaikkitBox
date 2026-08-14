import { createServerFn } from "@tanstack/react-start";

export const adminLogin = createServerFn({ method: "POST" })
  .validator((data: { user: string; pass: string }) => data)
  .handler(async ({ data }) => {
    const { getSession } = await import("./admin.server");
    const { getDb } = await import("./db");
    const { verifyPassword } = await import("./password");

    const db = getDb();
    const row = db
      .prepare("SELECT id, username, password_hash, role, status FROM users WHERE username = ?")
      .get(data.user) as
      | { id: number; username: string; password_hash: string; role: string; status: string }
      | undefined;

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
    });

    const { getRequestIP, getRequestHeader } = await import("@tanstack/react-start/server");
    const ip = getRequestIP() ?? null;
    const userAgent = getRequestHeader("user-agent") ?? null;
    db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(row.id);
    db.prepare("INSERT INTO user_logins (user_id, ip, user_agent) VALUES (?, ?, ?)").run(
      row.id,
      ip,
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
  const { getSession } = await import("./admin.server");
  const session = await getSession();
  return {
    isAdmin: !!session.data.admin,
    isAuthenticated: !!session.data.userId,
    username: session.data.username ?? null,
    role: session.data.role ?? null,
  };
});

// ---------------------------------------------------------------------------
// Gestionare conturi admin (necesită login admin) — vezi pagina Utilizatori
// ---------------------------------------------------------------------------

export const addAdminUser = createServerFn({ method: "POST" })
  .validator((data: { username: string; password: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin();

    const username = data.username.trim();
    if (!username || data.password.length < 8) {
      return { ok: false, error: "Utilizator necompletat sau parolă sub 8 caractere." };
    }

    const { getDb } = await import("./db");
    const { hashPassword } = await import("./password");
    const db = getDb();

    const exists = db.prepare("SELECT 1 FROM users WHERE username = ?").get(username);
    if (exists) {
      return { ok: false, error: "Există deja un cont cu acest nume." };
    }

    db.prepare(
      "INSERT INTO users (username, password_hash, role, status) VALUES (?, ?, 'admin', 'approved')",
    ).run(username, hashPassword(data.password));
    return { ok: true };
  });

export const deleteAdminUser = createServerFn({ method: "POST" })
  .validator((data: { id: number }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin();

    const { getDb } = await import("./db");
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
