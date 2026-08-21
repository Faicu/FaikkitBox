import { redirect } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";

import { getAdminStatus } from "./admin.functions";

// Fiecare rută protejată (Bibliotecă, Tehnic, qBit, Sistem, Utilizatori,
// Immich, Descoperă) rulează acest check la fiecare navigare — fără cache,
// tab-switch-urile din bara de jos plăteau un round-trip server complet
// înainte ca ruta nouă să apuce să se randeze (ecranul rămânea blocat,
// apoi toate secțiunile paginii apăreau deodată). 1 minut e suficient cât
// să elimine acel round-trip la navigare repetată în aceeași sesiune, dar
// destul de scurt încât o revocare de sesiune/rol să prindă efect rapid.
const ADMIN_STATUS_STALE_MS = 60_000;

function fetchAdminStatus(queryClient: QueryClient) {
  return queryClient.ensureQueryData({
    queryKey: ["adminStatus"],
    queryFn: () => getAdminStatus(),
    staleTime: ADMIN_STATUS_STALE_MS,
  });
}

export async function requireAdminBeforeLoad({
  context,
}: {
  context: { queryClient: QueryClient };
}) {
  const { isAdmin } = await fetchAdminStatus(context.queryClient);
  if (!isAdmin) {
    throw redirect({ to: "/login" });
  }
}

// Orice cont autentificat (admin sau user obișnuit aprobat) — pentru rute
// deschise oricui e logat, dar nu vizitatorilor anonimi.
export async function requireAuthBeforeLoad({
  context,
}: {
  context: { queryClient: QueryClient };
}) {
  const { isAuthenticated } = await fetchAdminStatus(context.queryClient);
  if (!isAuthenticated) {
    throw redirect({ to: "/login" });
  }
}
