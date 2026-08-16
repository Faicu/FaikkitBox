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
  lastLoginAt: string | null;
}

export const listUsers = createServerFn({ method: "GET" }).handler(
  async (): Promise<UserAccount[]> => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin();
    const { getDb } = await import("./db");
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, username, email, phone, role, status, plex_username, plex_email, created_at, last_login_at
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
      last_login_at: string | null;
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
      lastLoginAt: r.last_login_at,
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
    db.prepare("UPDATE users SET status = 'approved' WHERE id = ? AND role = 'user'").run(data.id);
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

// ---------------------------------------------------------------------------
// Detalii complete pentru un cont — pagina Utilizatori, la click pe un rând
// ---------------------------------------------------------------------------

export interface UserLoginEntry {
  id: number;
  loggedInAt: string;
  ip: string | null;
  userAgent: string | null;
}

export interface UserPlexActivityEntry {
  title: string;
  show: string | null;
  season: number | null;
  episode: number | null;
  type: string;
  viewedAt: number;
  player: string | null;
}

export interface UserDownloadEntry {
  id: number;
  mediaType: "movie" | "episode";
  title: string;
  season: number | null;
  episode: number | null;
  posterUrl: string | null;
  quality: string | null;
  addedAt: string;
  completedAt: string | null;
}

export interface UserDetail extends UserAccount {
  plexAccountId: number | null;
  logins: UserLoginEntry[];
  plexActivity: UserPlexActivityEntry[];
  downloads: UserDownloadEntry[];
}

export const getUserDetail = createServerFn({ method: "GET" })
  .validator((data: { id: number }) => data)
  .handler(async ({ data }): Promise<UserDetail | null> => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin();
    const { getDb } = await import("./db");
    const db = getDb();

    const user = db
      .prepare(
        `SELECT id, username, email, phone, role, status, plex_account_id, plex_username, plex_email, created_at, last_login_at
         FROM users WHERE id = ?`,
      )
      .get(data.id) as
      | {
          id: number;
          username: string;
          email: string | null;
          phone: string | null;
          role: string;
          status: string;
          plex_account_id: number | null;
          plex_username: string | null;
          plex_email: string | null;
          created_at: string;
          last_login_at: string | null;
        }
      | undefined;
    if (!user) return null;

    const loginRows = db
      .prepare(
        `SELECT id, logged_in_at, ip, user_agent FROM user_logins
         WHERE user_id = ? ORDER BY logged_in_at DESC LIMIT 25`,
      )
      .all(user.id) as Array<{
      id: number;
      logged_in_at: string;
      ip: string | null;
      user_agent: string | null;
    }>;

    // Titlurile efectiv descărcate prin cont — sursate din `media` (nu din
    // `downloads`, jurnalul tehnic vechi), ca să arate titlul real (nu numele
    // tehnic al torrentului) + poster + calitate, consistent cu Bibliotecă.
    // torrent_hash IS NOT NULL exclude rândurile fără nimic descărcat.
    const downloadRows = db
      .prepare(
        `SELECT id, media_type, title, season, episode, poster_path, quality, added_at,
                COALESCE(completed_at, CASE WHEN plex_rating_key IS NOT NULL THEN added_at END) AS completed_at
         FROM media WHERE requested_by_user_id = ? AND media_type IN ('movie', 'episode')
         AND torrent_hash IS NOT NULL
         ORDER BY added_at DESC LIMIT 50`,
      )
      .all(user.id) as Array<{
      id: number;
      media_type: string;
      title: string;
      season: number | null;
      episode: number | null;
      poster_path: string | null;
      quality: string | null;
      added_at: string;
      completed_at: string | null;
    }>;

    const plexActivity = user.plex_username
      ? await (await import("./services/plex")).getPlexUserHistory(user.plex_username)
      : [];

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      phone: user.phone,
      role: user.role as "admin" | "user",
      status: user.status as "pending" | "approved",
      plexAccountId: user.plex_account_id,
      plexUsername: user.plex_username,
      plexEmail: user.plex_email,
      createdAt: user.created_at,
      lastLoginAt: user.last_login_at,
      logins: loginRows.map((r) => ({
        id: r.id,
        loggedInAt: r.logged_in_at,
        ip: r.ip,
        userAgent: r.user_agent,
      })),
      downloads: downloadRows.map((r) => ({
        id: r.id,
        mediaType: r.media_type as "movie" | "episode",
        title: r.title,
        season: r.season,
        episode: r.episode,
        posterUrl: r.poster_path,
        quality: r.quality,
        addedAt: r.added_at,
        completedAt: r.completed_at,
      })),
      plexActivity: plexActivity.slice(0, 30).map((e) => ({
        title: e.title,
        show: e.show ?? null,
        season: e.season ?? null,
        episode: e.episode ?? null,
        type: e.type,
        viewedAt: e.viewedAt,
        player: e.player ?? null,
      })),
    };
  });
