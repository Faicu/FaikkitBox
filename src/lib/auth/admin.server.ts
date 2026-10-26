import type { StatementSync } from "node:sqlite";
import { setResponseStatus, useSession } from "@tanstack/react-start/server";

import { FORBIDDEN_MESSAGE, UNAUTHORIZED_MESSAGE } from "./unauthorized";

export type AdminSession = {
  admin?: boolean;
  userId?: number;
  username?: string;
  role?: "admin" | "user";
  // users.session_version de la login; cookie-urile mai vechi contează ca 0.
  sessionVersion?: number;
};

// Pentru rutele Nitro brute (server/routes/api/*), care nu pot folosi
// getSession() — aceeași configurație de cookie, nu una duplicată.
export function sessionConfig() {
  const password = process.env.SESSION_SECRET;
  if (!password || password.length < 32) {
    throw new Error("SESSION_SECRET nu este configurat (minim 32 caractere).");
  }
  return {
    password,
    name: "sm-admin",
    maxAge: 60 * 60 * 24 * 7,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "lax" as const,
      path: "/",
    },
  };
}

export async function getSession() {
  // Helper server-side, nu React Hook.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useSession<AdminSession>(sessionConfig());
}

// Contul din cookie mai există și mai e aprobat? Cookie-ul semnat ține 7 zile,
// deci fără verificare „revocă accesul” nu revoca nimic. Tot de aici vin rolul
// curent (un admin retrogradat își pierde drepturile) și versiunea sesiunii
// (resetarea parolei invalidează cookie-urile vechi). Un SELECT pe cheie e
// prea ieftin pentru un cache care ar reintroduce fereastra.
export async function isAccountLive(
  userId: number,
  sessionVersion: number | undefined,
): Promise<string | null> {
  return (await liveAccount(userId, sessionVersion))?.role ?? null;
}

// Pregătit o singură dată: rulează la FIECARE cerere autentificată, inclusiv la
// fiecare poster.
let accountStmt: StatementSync | null = null;

async function liveAccount(
  userId: number,
  sessionVersion: number | undefined,
): Promise<{ role: string; status: string } | null> {
  if (!accountStmt) {
    const { getDb } = await import("../db");
    accountStmt = getDb().prepare("SELECT role, status, session_version FROM users WHERE id = ?");
  }
  const row = accountStmt.get(userId) as
    { role: string; status: string; session_version: number } | undefined;
  if (!row || row.status !== "approved") return null;
  if (row.session_version !== (sessionVersion ?? 0)) return null;
  return row;
}

// 401, dar cu o eroare serializată, nu un `Response` brut (vezi unauthorized.ts).
function throwUnauthorized(): never {
  setResponseStatus(401);
  throw new Error(UNAUTHORIZED_MESSAGE);
}

// Logat, dar fără rol — separat de 401, ca clientul să nu trimită la login un
// user obișnuit care atinge o funcție de admin.
function throwForbidden(): never {
  setResponseStatus(403);
  throw new Error(FORBIDDEN_MESSAGE);
}

// Orice cont autentificat și aprobat.
export async function requireAuth() {
  const session = await getSession();
  const userId = session.data.userId;
  if (!userId) {
    throwUnauthorized();
  }
  const account = await liveAccount(userId, session.data.sessionVersion);
  if (!account) {
    // Golim cookie-ul, altfel clientul se crede logat și ia 401 la nesfârșit.
    await session.clear();
    throwUnauthorized();
  }
  return session;
}

export async function requireAdmin() {
  const session = await getSession();
  const userId = session.data.userId;
  if (!userId) {
    throwUnauthorized();
  }
  const account = await liveAccount(userId, session.data.sessionVersion);
  if (!account) throwUnauthorized();
  if (!session.data.admin || account.role !== "admin") {
    throwForbidden();
  }
  return session;
}

// Admin sau chiar contul care a inițiat acțiunea (cel care a descărcat poate
// corecta sau șterge). Întoarce bool, nu aruncă — apelanții răspund cu un
// mesaj prietenos.
export function isAdminOrOwner(
  session: { data: AdminSession },
  ownerUserId: number | null,
): boolean {
  return !!session.data.admin || (ownerUserId != null && session.data.userId === ownerUserId);
}

// Adminul verificat ca la requireAdmin (sesiune ȘI rol din DB), fără să arunce —
// pentru acțiuni deschise tuturor, cu reguli în plus pentru non-admini.
export async function isLiveAdmin(session: { data: AdminSession }): Promise<boolean> {
  const userId = session.data.userId;
  if (!userId || !session.data.admin) return false;
  const account = await liveAccount(userId, session.data.sessionVersion);
  return account?.role === "admin";
}
