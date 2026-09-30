// Server functions admin pentru ultima poziție și mentenanță (pagina /calatorii),
// separate de vw-car.ts — vezi regula din STRUCTURE.md despre *.functions.ts.

import { createServerFn } from "@tanstack/react-start";

export type { VwPosition, VwReminder, VwReminderInput } from "./vw-car";
import type { VwPosition, VwReminder, VwReminderInput } from "./vw-car";

export const getVwCar = createServerFn({ method: "GET" }).handler(
  async (): Promise<{
    position: VwPosition | null;
    odometer: number | null;
    reminders: VwReminder[];
  }> => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();
    const { readLastPosition, readOdometer, readReminders } = await import("./vw-car");
    return { position: readLastPosition(), odometer: readOdometer(), reminders: readReminders() };
  },
);

export const saveVwReminder = createServerFn({ method: "POST" })
  .validator((data: VwReminderInput) => data)
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();
    const { saveReminder } = await import("./vw-car");
    saveReminder(data);
  });

export const deleteVwReminder = createServerFn({ method: "POST" })
  .validator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();
    const { deleteReminder } = await import("./vw-car");
    deleteReminder(Number(data.id));
  });

export const markVwReminderDone = createServerFn({ method: "POST" })
  .validator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();
    const { markReminderDone } = await import("./vw-car");
    markReminderDone(Number(data.id));
  });
