import { describe, expect, it } from "vitest";
import {
  containerApp,
  containerCpuPercent,
  containerMemBytes,
  counterRate,
  levelFor,
  windowedDiskRate,
} from "./host-rates";

describe("counterRate", () => {
  it("fără citire anterioară nu inventează viteza", () => {
    expect(counterRate(undefined, 100, 1000)).toBeUndefined();
  });
  it("calculează octeți pe secundă", () => {
    expect(counterRate({ value: 1000, ts: 0 }, 6000, 2000)).toBe(2500);
  });
  it("contor coborât (container repornit) → fără valoare", () => {
    expect(counterRate({ value: 5000, ts: 0 }, 100, 2000)).toBeUndefined();
  });
  it("interval prea scurt → fără valoare", () => {
    expect(counterRate({ value: 0, ts: 1000 }, 10, 1050)).toBeUndefined();
  });
});

describe("containerCpuPercent", () => {
  it("1,6 nuclee ocupate din 16 → 10%", () => {
    expect(containerCpuPercent({ value: 0, ts: 0 }, 3_200_000, 2000, 16)).toBe(10);
  });
  it("fără citire anterioară → fără valoare", () => {
    expect(containerCpuPercent(undefined, 3_200_000, 2000, 16)).toBeUndefined();
  });
});

describe("containerMemBytes", () => {
  it("scade cache-ul inactiv", () => {
    expect(containerMemBytes(1000, 300)).toBe(700);
  });
});

describe("containerApp", () => {
  it("recunoaște containerele după procese", () => {
    expect(containerApp(["s6-svscan -t0", "/usr/lib/plexmediaserver/Plex Media Server"])).toBe(
      "Plex",
    );
    expect(containerApp(["tini -- python -m immich_ml"])).toBe("Immich");
    expect(containerApp(["postgres -c config_file=x", "postgres: vectors"])).toBe("Immich");
    expect(containerApp(["valkey-server *:6379"])).toBe("Immich");
    expect(containerApp(["cloudflared tunnel run"])).toBeNull();
  });
});

describe("levelFor", () => {
  it("praguri", () => {
    expect(levelFor(79, 80, 90)).toBe("ok");
    expect(levelFor(80, 80, 90)).toBe("warn");
    expect(levelFor(90, 80, 90)).toBe("danger");
  });
});

describe("windowedDiskRate", () => {
  const at = (ts: number, w: number) => ({ readBytes: 0, writeBytes: w, ts });
  it("mediază de la cea mai veche citire din fereastră", () => {
    // Rafală de 10 MB între secunda 2 și 3, apoi nimic: media pe 5 s, nu 0.
    const history = [at(0, 0), at(1000, 0), at(2000, 0), at(3000, 10e6), at(4000, 10e6)];
    expect(windowedDiskRate(history, at(5000, 10e6), 5000)?.writeBps).toBe(2e6);
  });
  it("citirile mai vechi decât fereastra nu intră", () => {
    const history = [at(0, 0), at(4000, 50e6)];
    expect(windowedDiskRate(history, at(6000, 60e6), 5000)?.writeBps).toBe(5e6);
  });
  it("fără citire în fereastră, folosește ultima", () => {
    expect(windowedDiskRate([at(0, 0)], at(60_000, 60e6), 5000)?.writeBps).toBe(1e6);
  });
  it("fără istoric → fără valoare", () => {
    expect(windowedDiskRate([], at(1000, 1), 5000)).toBeUndefined();
  });
});
