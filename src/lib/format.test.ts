import { describe, it, expect } from "vitest";
import { pluralRo } from "./format";

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
