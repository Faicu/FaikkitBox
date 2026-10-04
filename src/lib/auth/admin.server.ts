import type { StatementSync } from "node:sqlite";
import { setResponseStatus, useSession } from "@tanstack/react-start/server";

import { FORBIDDEN_MESSAGE, UNAUTHORIZED_MESSAGE } from "./unauthorized";

export type AdminSession = {
  admin?: boolean;
  userId?: number;
  username?: string;
  role?: "admin" | "user";
  // Copia lui users.session_version de la login. Cookie-urile emise înainte
  // de coloană n-o au — contează ca 0, valoarea implicită din DB.
  sessionVersion?: number;
};

// Exportată pentru rutele Nitro brute (server/routes/api/*), care rulează în
// afara AsyncLocalStorage-ului TanStack Start și nu pot folosi getSession() de
// mai jos — au nevoie de aceeași configurație de cookie ca să citească exact
// aceeași sesiune, nu de una duplicată care s-ar putea desincroniza.
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
  // Nu e un React Hook — e un helper server-side din @tanstack/react-start.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useSession<AdminSession>(sessionConfig());
}

// Contul din cookie mai există și mai e aprobat?
//
// Cookie-ul e semnat și ține 7 zile, deci fără verificarea asta „revocă
// accesul" din pagina Utilizatori nu revoca nimic: rândul dispărea din `users`,
// dar sesiunea deja emisă rămânea bună până expira singură, cu tot cu dreptul
// de a descărca și șterge. Un SELECT pe cheie primară într-un SQLite local e
// prea ieftin ca să merite un cache care ar reintroduce exact fereastra asta.
//
// Tot de aici vine și rolul: dacă cineva e retrogradat din admin, sesiunea lui
// nu mai trebuie să poarte mai departe `admin: true` înghețat la login.
//
// Și versiunea sesiunii: resetarea parolei incrementează users.session_version,
// deci orice cookie emis cu parola veche nu mai trece.
export async function isAccountLive(
  userId: number,
  sessionVersion: number | undefined,
): Promise<string | null> {
  return (await liveAccount(userId, sessionVersion))?.role ?? null;
}

// Statement-ul se pregătește o singură dată: verificarea rulează la FIECARE
// cerere autentificată, inclusiv la fiecare poster prin /api/plex-thumb, iar
// re-parsarea SQL-ului de fiecare dată ar fi singurul cost care se vede.
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

// Statusul HTTP rămâne 401 (util în Network/loguri), dar corpul e o eroare
// serializată, nu un `Response` brut — vezi unauthorized.ts pentru de ce.
function throwUnauthorized(): never {
  setResponseStatus(401);
  throw new Error(UNAUTHORIZED_MESSAGE);
}

// Logat, dar fără rolul cerut. Separat de 401: clientul redirecționează spre
// login doar la sesiune pierdută, nu și când un user obișnuit atinge o
// funcție de admin.
function throwForbidden(): never {
  setResponseStatus(403);
  throw new Error(FORBIDDEN_MESSAGE);
}

// Orice cont autentificat (admin sau user obișnuit, ambele aprobate).
export async function requireAuth() {
  const session = await getSession();
  const userId = session.data.userId;
  if (!userId) {
    throwUnauthorized();
  }
  const account = await liveAccount(userId, session.data.sessionVersion);
  if (!account) {
    // Golim cookie-ul, altfel clientul continuă să se creadă logat și se
    // lovește de 401 la fiecare cerere, fără să fie trimis la autentificare.
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

// true dacă sesiunea e admin sau chiar contul care a inițiat acțiunea (ex.
// cel care a descărcat un torrent poate corecta/șterge subtitrarea sau
// titlul, fără să aibă nevoie de rol de admin) — folosit pentru acțiuni pe
// intrări din jurnalul de descărcări (downloads.requested_by_user_id).
// Întoarce bool (nu aruncă), ca apelanții să poată răspunde cu un mesaj
// prietenos în același format {status:"error"} folosit de restul funcțiilor,
// nu cu un 401 brut.
export function isAdminOrOwner(
  session: { data: AdminSession },
  ownerUserId: number | null,
): boolean {
  return !!session.data.admin || (ownerUserId != null && session.data.userId === ownerUserId);
}
