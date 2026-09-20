import { useSession } from "@tanstack/react-start/server";

export type AdminSession = {
  admin?: boolean;
  userId?: number;
  username?: string;
  role?: "admin" | "user";
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
export async function isAccountLive(userId: number): Promise<string | null> {
  return (await liveAccount(userId))?.role ?? null;
}

async function liveAccount(userId: number): Promise<{ role: string; status: string } | null> {
  const { getDb } = await import("../db");
  const row = getDb().prepare("SELECT role, status FROM users WHERE id = ?").get(userId) as
    | { role: string; status: string }
    | undefined;
  if (!row || row.status !== "approved") return null;
  return row;
}

// Orice cont autentificat (admin sau user obișnuit, ambele aprobate).
export async function requireAuth() {
  const session = await getSession();
  const userId = session.data.userId;
  if (!userId) {
    throw new Response("Unauthorized", { status: 401 });
  }
  const account = await liveAccount(userId);
  if (!account) {
    // Golim cookie-ul, altfel clientul continuă să se creadă logat și se
    // lovește de 401 la fiecare cerere, fără să fie trimis la autentificare.
    await session.clear();
    throw new Response("Unauthorized", { status: 401 });
  }
  return session;
}

export async function requireAdmin() {
  const session = await getSession();
  const userId = session.data.userId;
  if (!userId) {
    throw new Response("Unauthorized", { status: 401 });
  }
  const account = await liveAccount(userId);
  if (!session.data.admin || account?.role !== "admin") {
    throw new Response("Unauthorized", { status: 401 });
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
