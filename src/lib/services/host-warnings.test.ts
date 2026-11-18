import { describe, expect, it } from "vitest";

import type { HostData } from "./host";
import { hostWarnings } from "./host-warnings";

const disk = (mount: string, extra: Partial<NonNullable<HostData["disks"]>[number]> = {}) => ({
  mount,
  percent: 50,
  usedBytes: 1,
  totalBytes: 2,
  tempLimits: [75, 80] as [number, number],
  ...extra,
});

const healthy: HostData = {
  status: "ok",
  configured: true,
  memPercent: 20,
  swapUsedBytes: 1,
  swapTotalBytes: 4,
  cpuTemp: 60,
  gpu: { temp: 50 },
  disks: [disk("/"), disk("/media/ssd2tb"), disk("/media/hddextern")],
};

describe("hostWarnings", () => {
  it("totul în regulă → nicio avertizare", () => {
    expect(hostWarnings(healthy)).toEqual([]);
  });
  it("disc nemontat și SSD fierbinte, cele grave primele", () => {
    const w = hostWarnings({
      ...healthy,
      cpuTemp: 82,
      disks: [disk("/"), disk("/media/ssd2tb", { temp: 77 })],
    });
    expect(w).toEqual([
      { level: "danger", text: "HDD Extern nemontat" },
      { level: "warn", text: "Procesor 82 °C" },
      { level: "warn", text: "M.2 2TB 77 °C" },
    ]);
  });
  it("SMART și ocupare", () => {
    const w = hostWarnings({
      ...healthy,
      disks: [
        disk("/", { percent: 91 }),
        disk("/media/ssd2tb", { smart: { passed: false, checkedAt: 0 } }),
        disk("/media/hddextern"),
      ],
    });
    expect(w.map((x) => x.text)).toEqual(["M.2 Bază plin 91%", "M.2 2TB: SMART: test eșuat"]);
  });
});
