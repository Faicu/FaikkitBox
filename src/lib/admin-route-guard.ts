import { redirect } from "@tanstack/react-router";

import { getAdminStatus } from "./admin.functions";

export async function requireAdminBeforeLoad() {
  const { isAdmin } = await getAdminStatus();
  if (!isAdmin) {
    throw redirect({ to: "/login" });
  }
}
