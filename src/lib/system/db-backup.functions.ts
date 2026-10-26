// Server functions pentru backup-ul bazei, separate de db-backup.ts — acela
// importă static node:fs/node:path și n-are ce căuta în bundle-ul public.
// Vezi comentariul din media.functions.ts pentru tiparul complet.

import { createServerFn } from "@tanstack/react-start";

export type { BackupFile, BackupStatus, BackupResult } from "./db-backup";
import type { BackupStatus } from "./db-backup";

export const getDbBackupStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<BackupStatus> => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();
    const { getBackupStatus } = await import("./db-backup");
    return getBackupStatus();
  },
);
