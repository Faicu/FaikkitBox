import { describe, expect, it } from "vitest";

import { shortLabelFor } from "./subtitle-outcomes";

describe("shortLabelFor", () => {
  it("cu sincronizarea măsurată, nu mai arată criteriile din nume (The Invite)", () => {
    expect(
      shortLabelFor("downloaded", {
        source: "subsro",
        matchedCriteria: 1,
        maxCriteria: 5,
        sync: { score: 0.91, offset: 0, good: true },
      }),
    ).toBe("subtitrare descărcată de pe subs.ro (sincronizare verificată)");
    expect(
      shortLabelFor("downloaded_approximate", {
        source: "subsro",
        sync: { score: 0.53, offset: -3, good: false },
      }),
    ).toBe(
      "subtitrare aproximativă descărcată de pe subs.ro (decalaj ~3,0 s) — verifică sincronizarea",
    );
  });

  it("fără măsurătoare, rămân criteriile", () => {
    expect(
      shortLabelFor("downloaded", { source: "subsro", matchedCriteria: 5, maxCriteria: 5 }),
    ).toBe("subtitrare descărcată de pe subs.ro (5/5 — potrivire perfectă)");
  });
});
