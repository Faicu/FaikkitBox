import { describe, it, expect } from "vitest";
import {
  addMonths,
  allocateMonths,
  currentMonth,
  effectiveTarget,
  validateDeclaration,
  monthsRangeLabel,
} from "./months";

describe("currentMonth", () => {
  it("folosește ora României, nu UTC", () => {
    // 31 oct 22:30 UTC = 1 nov 00:30 la București (EET, UTC+2)
    expect(currentMonth(new Date("2026-10-31T22:30:00Z"))).toBe("2026-11");
    expect(currentMonth(new Date("2026-10-31T21:30:00Z"))).toBe("2026-10");
  });
});

describe("addMonths", () => {
  it("trece peste an în ambele sensuri", () => {
    expect(addMonths("2026-11", 2)).toBe("2027-01");
    expect(addMonths("2027-01", -1)).toBe("2026-12");
    expect(addMonths("2026-10", 0)).toBe("2026-10");
    expect(addMonths("2026-10", 12)).toBe("2027-10");
  });
});

describe("allocateMonths", () => {
  it("pornește din luna curentă", () => {
    expect(allocateMonths("2026-10", 3, [])).toEqual(["2026-10", "2026-11", "2026-12"]);
  });
  it("sare peste lunile deja acoperite", () => {
    expect(allocateMonths("2026-10", 3, ["2026-10", "2026-12"])).toEqual([
      "2026-11",
      "2027-01",
      "2027-02",
    ]);
  });
});

describe("effectiveTarget", () => {
  const targets = [
    { month: "2026-10", target: 250 },
    { month: "2027-01", target: 300 },
  ];
  it("ia ultima țintă de la sau dinaintea lunii", () => {
    expect(effectiveTarget("2026-12", targets)).toBe(250);
    expect(effectiveTarget("2027-01", targets)).toBe(300);
    expect(effectiveTarget("2027-05", targets)).toBe(300);
  });
  it("implicit 250 fără nicio țintă", () => {
    expect(effectiveTarget("2026-01", [])).toBe(250);
    expect(effectiveTarget("2026-01", targets)).toBe(250);
  });
});

describe("validateDeclaration", () => {
  it("minim 15 lei, 1–12 luni", () => {
    expect(validateDeclaration(1, 15)).toBeNull();
    expect(validateDeclaration(12, 25)).toBeNull();
    expect(validateDeclaration(1, 14)).not.toBeNull();
    expect(validateDeclaration(0, 25)).not.toBeNull();
    expect(validateDeclaration(13, 25)).not.toBeNull();
    expect(validateDeclaration(1, 20.5)).not.toBeNull();
  });
});

describe("monthsRangeLabel", () => {
  it("o lună sau interval", () => {
    expect(monthsRangeLabel(["2026-10"])).toBe("octombrie 2026");
    expect(monthsRangeLabel(["2027-01", "2026-11"])).toBe("noiembrie 2026 – ianuarie 2027");
  });
});
