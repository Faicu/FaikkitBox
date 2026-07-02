import { createServerFn } from "@tanstack/react-start";

export const adminLogin = createServerFn({ method: "POST" })
  .inputValidator((data: { user: string; pass: string }) => data)
  .handler(async ({ data }) => {
    const { getSession, eq } = await import("./admin.server");
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
    const session = await getSession();
    await session.update({ admin: true });
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
  return { isAdmin: !!session.data.admin };
});