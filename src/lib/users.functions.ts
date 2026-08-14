import { createServerFn } from "@tanstack/react-start";

export interface UserAccount {
  id: number;
  username: string;
  email: string | null;
  phone: string | null;
  role: "admin" | "user";
  status: "pending" | "approved";
  plexUsername: string | null;
  plexEmail: string | null;
  createdAt: string;
}

export const listUsers = createServerFn({ method: "GET" }).handler(
  async (): Promise<UserAccount[]> => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin();
    const { getDb } = await import("./db");
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, username, email, phone, role, status, plex_username, plex_email, created_at
         FROM users ORDER BY status ASC, created_at DESC`,
      )
      .all() as Array<{
      id: number;
      username: string;
      email: string | null;
      phone: string | null;
      role: string;
      status: string;
      plex_username: string | null;
      plex_email: string | null;
      created_at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      username: r.username,
      email: r.email,
      phone: r.phone,
      role: r.role as "admin" | "user",
      status: r.status as "pending" | "approved",
      plexUsername: r.plex_username,
      plexEmail: r.plex_email,
      createdAt: r.created_at,
    }));
  },
);

export const approveUser = createServerFn({ method: "POST" })
  .validator((data: { id: number }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin();
    const { getDb } = await import("./db");
    const db = getDb();
    db.prepare("UPDATE users SET status = 'approved' WHERE id = ? AND role = 'user'").run(
      data.id,
    );
    return { ok: true };
  });

// Respingerea unei cereri pending sau revocarea accesului unui cont deja
// aprobat — în ambele cazuri, ștergere directă (fără status "rejected").
export const deleteUser = createServerFn({ method: "POST" })
  .validator((data: { id: number }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin();
    const { getDb } = await import("./db");
    const db = getDb();
    db.prepare("DELETE FROM users WHERE id = ? AND role = 'user'").run(data.id);
    return { ok: true };
  });
