// Indiciul HDR de la întrebarea „Vei putea viziona în HDR?" — vezi
// media/device-hdr.ts (reguli) și services/device-hdr.server.ts (date).

import { createServerFn } from "@tanstack/react-start";

import type { HdrHint } from "./device-hdr.server";

export type { HdrHint, HdrDeviceHint } from "./device-hdr.server";

// null = fără indiciu (cont Plex nelegat, fără vizionări, Plex căzut) —
// întrebarea rămâne ca înainte.
export const getHdrDeviceHint = createServerFn({ method: "GET" }).handler(
  async (): Promise<HdrHint | null> => {
    const { requireAuth } = await import("../auth/admin.server");
    const session = await requireAuth();
    const { getHdrHintForUser } = await import("./device-hdr.server");
    try {
      return await getHdrHintForUser(session.data.userId!);
    } catch {
      return null;
    }
  },
);

export const setDeviceHdr = createServerFn({ method: "POST" })
  .validator((d: { clientId: string; hasHdr: boolean | null }) => {
    if (typeof d?.clientId !== "string" || !d.clientId) throw new Error("Dispozitiv lipsă");
    if (d.hasHdr !== null && typeof d.hasHdr !== "boolean") throw new Error("Răspuns invalid");
    return { clientId: d.clientId, hasHdr: d.hasHdr };
  })
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const { requireAuth } = await import("../auth/admin.server");
    const session = await requireAuth();
    const { setDeviceHdrAnswer } = await import("./device-hdr.server");
    const ok = await setDeviceHdrAnswer(
      session.data.userId!,
      !!session.data.admin,
      data.clientId,
      data.hasHdr,
    );
    return { ok };
  });
