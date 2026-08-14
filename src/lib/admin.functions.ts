import { createServerFn } from "@tanstack/react-start";

export interface AdminUser {
  id: number;
  username: string;
  createdAt: string;
}

export const adminLogin = createServerFn({ method: "POST" })
  .validator((data: { user: string; pass: string }) => data)
  .handler(async ({ data }) => {
    const { getSession } = await import("./admin.server");
    const { getDb } = await import("./db");
    const { verifyPassword } = await import("./password");

    const db = getDb();
    const row = db
      .prepare("SELECT username, password_hash FROM admin_users WHERE username = ?")
      .get(data.user) as { username: string; password_hash: string } | undefined;

    if (!row || !verifyPassword(data.pass, row.password_hash)) {
      return { ok: false as const, error: "Utilizator sau parolă greșită." };
    }

    const session = await getSession();
    await session.update({ admin: true, username: row.username });
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
  return { isAdmin: !!session.data.admin, username: session.data.username ?? null };
});

// ---------------------------------------------------------------------------
// Gestionare conturi admin (necesită login admin) — vezi secțiunea din Tehnic
// ---------------------------------------------------------------------------

export const listAdminUsers = createServerFn({ method: "GET" }).handler(
  async (): Promise<AdminUser[]> => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin();
    const { getDb } = await import("./db");
    const db = getDb();
    const rows = db
      .prepare("SELECT id, username, created_at FROM admin_users ORDER BY created_at ASC")
      .all() as Array<{ id: number; username: string; created_at: string }>;
    return rows.map((r) => ({ id: r.id, username: r.username, createdAt: r.created_at }));
  },
);

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

    const exists = db.prepare("SELECT 1 FROM admin_users WHERE username = ?").get(username);
    if (exists) {
      return { ok: false, error: "Există deja un cont cu acest nume." };
    }

    db.prepare("INSERT INTO admin_users (username, password_hash) VALUES (?, ?)").run(
      username,
      hashPassword(data.password),
    );
    return { ok: true };
  });

export const deleteAdminUser = createServerFn({ method: "POST" })
  .validator((data: { id: number }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin();

    const { getDb } = await import("./db");
    const db = getDb();

    const count = db.prepare("SELECT COUNT(*) as c FROM admin_users").get() as { c: number };
    if (count.c <= 1) {
      return { ok: false, error: "Nu poți șterge singurul cont admin rămas." };
    }

    db.prepare("DELETE FROM admin_users WHERE id = ?").run(data.id);
    return { ok: true };
  });
