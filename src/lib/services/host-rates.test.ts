import { describe, expect, it } from "vitest";
import {
  containerApp,
  containerCpuPercent,
  containerMemBytes,
  counterRate,
  levelFor,
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
