// ---------------------------------------------------------------------------
// Server functions pentru Speedtest, separate de speedtest.ts.
//
// Fișierul ăsta e importat de tehnic.tsx și queries.ts, deci ajunge în
// bundle-ul de client. Corpul unui handler de server function e eliminat de
// acolo, deci importurile dinamice de mai jos rămân exclusiv pe server —
// spre deosebire de varianta veche, care importa static node:child_process,
// node:util și node:crypto chiar aici.
// ---------------------------------------------------------------------------

import { createServerFn } from "@tanstack/react-start";

export type { SpeedtestResult, SpeedtestHistoryEntry, SpeedtestState } from "./speedtest";
import type { SpeedtestResult, SpeedtestHistoryEntry, SpeedtestState } from "./speedtest";

export const getLastSpeedtest = createServerFn({ method: "GET" }).handler(
  async (): Promise<SpeedtestResult | null> => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();
    const { readLastFromHistory } = await import("./speedtest");
    return readLastFromHistory();
  },
);

export const getSpeedtestHistory = createServerFn({ method: "GET" }).handler(
  async (): Promise<SpeedtestHistoryEntry[]> => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();
    const { readHistory } = await import("./speedtest");
    return readHistory();
  },
);

// Starea rulării curente. Clientul o interoghează cât timp `running` e true,
// deci vede corect testul în desfășurare chiar dacă a redeschis aplicația la
// mijlocul lui.
export const getSpeedtestState = createServerFn({ method: "GET" }).handler(
  async (): Promise<SpeedtestState> => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();
    const { getSpeedtestState: read } = await import("./speedtest");
    return read();
  },
);

// Pornește testul și se întoarce imediat — NU așteaptă rezultatul. Vezi
// startSpeedtestRun: rularea e decuplată de cererea asta, deci închiderea
// aplicației nu o mai poate întrerupe.
export const startSpeedtest = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ started: boolean }> => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();
    const { startSpeedtestRun } = await import("./speedtest");
    return startSpeedtestRun();
  },
);
