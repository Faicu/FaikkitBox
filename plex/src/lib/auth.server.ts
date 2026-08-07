import { useSession } from "@tanstack/react-start/server";
import { getPlexDb } from "./plex-db";

export type PlexSession = { userId?: number; role?: string; status?: string };

function sessionConfig() {
  const password = process.env.SESSION_SECRET;
  if (!password || password.length < 32) {
    throw new Error("SESSION_SECRET nu este configurat (minim 32 caractere).");
  }
  return {
    password,
    name: "sm-plex-user",
    maxAge: 60 * 60 * 24 * 90, // 90 zile — rămâne logat pe device
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "lax" as const,
      path: "/",
    },
  };
}

export async function getSession() {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useSession<PlexSession>(sessionConfig());
}

export interface PlexUserRow {
  id: number;
  username: string;
  password_hash: string;
  email: string;
  whatsapp: string;
  role: string;
  status: string;
  blocked: number;
  created_at: string;
  approved_at: string | null;
}

export function getUserById(id: number): PlexUserRow | undefined {
  const db = getPlexDb();
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as PlexUserRow | undefined;
}

/** Aruncă 401 dacă nu e logat sau contul nu e aprobat/e blocat. */
export async function requireUser(): Promise<PlexUserRow> {
  const session = await getSession();
  const userId = session.data.userId;
  if (!userId) throw new Response("Unauthorized", { status: 401 });
  const user = getUserById(userId);
  if (!user || user.status !== "approved") {
    throw new Response("Unauthorized", { status: 401 });
  }
  return user;
}

/** La fel ca requireUser, dar permite și conturi pending (pt. pagina de așteptare). */
export async function requireSessionUser(): Promise<PlexUserRow> {
  const session = await getSession();
  const userId = session.data.userId;
  if (!userId) throw new Response("Unauthorized", { status: 401 });
  const user = getUserById(userId);
  if (!user) throw new Response("Unauthorized", { status: 401 });
  return user;
}

export async function requireAdminUser(): Promise<PlexUserRow> {
  const user = await requireUser();
  if (user.role !== "admin") throw new Response("Forbidden", { status: 403 });
  return user;
}
