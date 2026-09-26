import { describe, it, expect } from "vitest";
import { countSimulatedInstalls } from "./ubuntu-status";

describe("countSimulatedInstalls", () => {
  it("numără doar ce ar instala `upgrade`, nu și pachetele ținute pe loc", () => {
    const sim = [
      "The following packages have been kept back:",
      "  linux-generic",
      "The following packages will be upgraded:",
      "  curl libcurl4",
      "2 upgraded, 0 newly installed, 0 to remove and 1 not upgraded.",
      "Inst curl [8.5.0-2ubuntu10.5] (8.5.0-2ubuntu10.6 Ubuntu:24.04/noble-updates [amd64])",
      "Inst libcurl4 [8.5.0-2ubuntu10.5] (8.5.0-2ubuntu10.6 Ubuntu:24.04/noble-updates [amd64])",
      "Conf curl (8.5.0-2ubuntu10.6 Ubuntu:24.04/noble-updates [amd64])",
    ].join("\n");
    expect(countSimulatedInstalls(sim)).toBe(2);
  });
});
