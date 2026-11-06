// Server functions pentru browserul la distanță. Separate de remote-browser.ts
// (importat dinamic) ca să nu ajungă nimic de server în bundle-ul de client.

import { createServerFn } from "@tanstack/react-start";

import type { BrowserAction, BrowserShot } from "./remote-browser";

export type { BrowserAction, BrowserShot } from "./remote-browser";

export const browserAction = createServerFn({ method: "POST" })
  .validator((d: BrowserAction) => d)
  .handler(async ({ data }): Promise<BrowserShot | null> => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();
    const { runBrowserAction } = await import("./remote-browser");
    return runBrowserAction(data);
  });

export const closeBrowser = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ ok: true }> => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();
    const { closeBrowserSession } = await import("./remote-browser");
    await closeBrowserSession();
    return { ok: true };
  },
);
