import { describe, expect, it } from "vitest";
import { counterRate, levelFor, normalizeContainerCpu } from "./host-rates";

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

describe("normalizeContainerCpu", () => {
  it("împarte la nuclee", () => {
    expect(normalizeContainerCpu(160, 16)).toBe(10);
  });
  it("fără nuclee știute, lasă valoarea", () => {
    expect(normalizeContainerCpu(50, undefined)).toBe(50);
  });
});

describe("levelFor", () => {
  it("praguri", () => {
    expect(levelFor(79, 80, 90)).toBe("ok");
    expect(levelFor(80, 80, 90)).toBe("warn");
    expect(levelFor(90, 80, 90)).toBe("danger");
  });
});
