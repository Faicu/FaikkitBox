import { redirect } from "@tanstack/react-router";

import { getAdminStatus } from "./admin.functions";

export async function requireAdminBeforeLoad() {
  const { isAdmin } = await getAdminStatus();
  if (!isAdmin) {
    throw redirect({ to: "/login" });
  }
}

// Orice cont autentificat (admin sau user obișnuit aprobat) — pentru rute
// deschise oricui e logat, dar nu vizitatorilor anonimi.
export async function requireAuthBeforeLoad() {
  const { isAuthenticated } = await getAdminStatus();
  if (!isAuthenticated) {
    throw redirect({ to: "/login" });
  }
}
