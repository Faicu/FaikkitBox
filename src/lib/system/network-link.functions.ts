// Server functions pentru starea legăturii Ethernet, separate de
// network-link.ts — acela are importuri server statice (node:fs,
// node:child_process) și n-are ce căuta în bundle-ul public.
// Vezi comentariul din media.functions.ts pentru tiparul complet.

import { createServerFn } from "@tanstack/react-start";

export type { NetworkLinkInfo, RenegotiateResult } from "./network-link";
import type { NetworkLinkInfo, RenegotiateResult } from "./network-link";

export const getNetworkLink = createServerFn({ method: "GET" }).handler(
  async (): Promise<NetworkLinkInfo> => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();
    const { getNetworkLinkInfo } = await import("./network-link");
    return getNetworkLinkInfo();
  },
);

export const renegotiateNetworkLink = createServerFn({ method: "POST" }).handler(
  async (): Promise<RenegotiateResult> => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();

    const { renegotiateLink } = await import("./network-link");
    const result = await renegotiateLink();

    // Urmă în Jurnalul de Activitate: e o acțiune care întrerupe rețeaua
    // câteva secunde, deci merită să se vadă cine și când a declanșat-o.
    const { logActivity } = await import("../activity-log");
    await logActivity(
      "service_restart",
      result.ok
        ? `Auto-negociere repornită pe ${result.iface} (legătura revine în câteva secunde)`
        : `Repornirea auto-negocierii a eșuat: ${result.error ?? "motiv necunoscut"}`,
      { iface: result.iface ?? null, ok: result.ok },
      { skipPush: true },
    );

    return result;
  },
);
