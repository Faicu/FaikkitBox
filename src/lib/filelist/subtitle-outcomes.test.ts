import { describe, expect, it } from "vitest";

import {
  shortLabelFor,
  subtitleHeadline,
  subtitleOutcomeTone,
  syncProblem,
} from "./subtitle-outcomes";

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

describe("etichete comune", () => {
  it("corecția timpilor apare în mesajul din jurnal", () => {
    expect(
      shortLabelFor("downloaded", {
        source: "subsro",
        sync: { score: 0.86, offset: 0, good: true, retime: "24 → 23,976 fps" },
      }),
    ).toBe("subtitrare descărcată de pe subs.ro (sincronizare verificată, timpi corectați)");
  });

  it("aproximativă fără decalaj: corelația, nu „decalaj ~0 s”", () => {
    expect(syncProblem({ score: 0.52, offset: 0 })).toBe("sincronizare incertă, 0,52");
    expect(syncProblem({ score: 0.56, offset: -3.5 })).toBe("decalaj ~3,5 s");
  });

  it("aproximativa păstrată nu mai apare drept „.srt corect”", () => {
    expect(subtitleHeadline("approximate_kept")).toBe(
      "Subtitrarea aproximativă rămâne — nicio variantă mai bună",
    );
    expect(subtitleOutcomeTone("approximate_kept")).toBe("warn");
    expect(subtitleOutcomeTone("retimed_srt")).toBe("good");
    expect(subtitleOutcomeTone("srt_already_ok")).toBe("ok");
    expect(subtitleOutcomeTone("no_subtitle_found")).toBe("bad");
  });
});
