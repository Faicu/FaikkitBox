import { describe, it, expect } from "vitest";
import { formatCompact, pluralRo } from "./format";

describe("pluralRo", () => {
  it("„de” de la 20 în sus, dar nu la 101–119", () => {
    expect(pluralRo(1, "film", "filme")).toBe("1 film");
    expect(pluralRo(2, "film", "filme")).toBe("2 filme");
    expect(pluralRo(19, "film", "filme")).toBe("19 filme");
    expect(pluralRo(20, "film", "filme")).toBe("20 de filme");
    expect(pluralRo(58, "film", "filme")).toBe("58 de filme");
    expect(pluralRo(101, "film", "filme")).toBe("101 filme");
    expect(pluralRo(120, "film", "filme")).toBe("120 de filme");
  });
});

describe("formatCompact", () => {
  it("scurtează ca IMDb", () => {
    expect(formatCompact(850)).toBe("850");
    expect(formatCompact(1000)).toBe("1K");
    expect(formatCompact(1240)).toBe("1.2K");
    expect(formatCompact(12_400)).toBe("12K");
    expect(formatCompact(125_600)).toBe("126K");
    expect(formatCompact(1_340_000)).toBe("1.3M");
    expect(formatCompact(3_000_000)).toBe("3M");
  });
});
