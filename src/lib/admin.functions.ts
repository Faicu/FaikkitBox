import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";
import { createHash, timingSafeEqual } from "node:crypto";

type AdminSession = { admin?: boolean };

function sessionConfig() {
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

function eq(a: string, b: string) {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

export async function requireAdmin() {
  const session = await useSession<AdminSession>(sessionConfig());
  if (!session.data.admin) {
    throw new Response("Unauthorized", { status: 401 });
  }
  return session;
}

export const adminLogin = createServerFn({ method: "POST" })
  .inputValidator((data: { user: string; pass: string }) => data)
  .handler(async ({ data }) => {
    const expectedUser = process.env.ADMIN_USER ?? "";
    const expectedPass = process.env.ADMIN_PASS ?? "";
    if (!expectedUser || !expectedPass) {
      return { ok: false as const, error: "Credentiale admin neconfigurate pe server." };
    }
    const okUser = eq(data.user, expectedUser);
    const okPass = eq(data.pass, expectedPass);
    if (!okUser || !okPass) {
      return { ok: false as const, error: "Utilizator sau parolă greșită." };
    }
    const session = await useSession<AdminSession>(sessionConfig());
    await session.update({ admin: true });
    return { ok: true as const };
  });

export const adminLogout = createServerFn({ method: "POST" }).handler(async () => {
  const session = await useSession<AdminSession>(sessionConfig());
  await session.clear();
  return { ok: true as const };
});

export const getAdminStatus = createServerFn({ method: "GET" }).handler(async () => {
  const session = await useSession<AdminSession>(sessionConfig());
  return { isAdmin: !!session.data.admin };
});