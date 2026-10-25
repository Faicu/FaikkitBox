import { describe, expect, it } from "vitest";

import { guessDeviceHdr, pickDevices, resolveDeviceHdr } from "./device-hdr";

// Numele și platformele sunt cele reale din /devices (oct 2026).
const g = (name: string, platform: string, extra: { model?: string; product?: string } = {}) => {
  const r = guessDeviceHdr({ name, platform, ...extra });
  return `${r.verdict}${r.sure ? "" : "?"}`;
};

describe("reguli", () => {
  it("LG după model", () => {
    expect(g("LG 50UN73003LA", "webOS")).toBe("yes");
    expect(g("LG 43UP75003LF", "webOS")).toBe("yes");
    expect(g("LG 50QNED80T3A.BEUJLJP", "webOS")).toBe("yes");
    expect(g("LG 32LQ63006LA", "webOS")).toBe("no?");
    expect(g("Sufragerie", "webOS")).toBe("unknown?");
  });

  it("Samsung după an, iar modelul din sesiune îl bate", () => {
    expect(g("TV 2019", "Tizen")).toBe("yes?");
    expect(g("TV 2024", "Tizen")).toBe("yes?");
    expect(g("TV 2016", "Tizen")).toBe("unknown?");
    expect(g("TV 2015", "Tizen")).toBe("no?");
    expect(g("TV 2019", "Tizen", { model: "UE55RU7102" })).toBe("yes");
    expect(g("TV 2019", "Tizen", { model: "QE55Q60RAT" })).toBe("yes");
    expect(g("TV 2018", "Tizen", { model: "UE32N5372" })).toBe("no?");
  });

  it("telefoane, tablete, box-uri", () => {
    expect(g("iPhone", "iOS")).toBe("yes?");
    expect(g("Xiaomi 14T Pro", "Android")).toBe("yes?");
    expect(g("A55 al utilizatorului Dragomir", "Android")).toBe("yes?");
    expect(g("HONOR Magic6 Lite 5G", "Android")).toBe("yes?");
    expect(g("S21 FE al utilizatorului Cristea", "Android")).toBe("yes?");
    expect(g("Tab S9 al utilizatorului Cristea", "Android")).toBe("unknown?");
    expect(g("iPad", "iOS")).toBe("unknown?");
    expect(g("Redmi Pad 2", "Android")).toBe("unknown?");
    expect(g("Trofin's Fire TV", "Android")).toBe("unknown?");
    expect(g("Chromecast", "Chromecast")).toBe("unknown?");
    expect(g("Dormitor", "Android")).toBe("unknown?");
    expect(g("Dormitor", "Android", { product: "Plex for Android (TV)" })).toBe("unknown?");
    expect(guessDeviceHdr({ name: "Dormitor", platform: "Android" }).category).toBe("other");
    expect(
      guessDeviceHdr({ name: "Dormitor", platform: "Android", product: "Plex for Android (TV)" })
        .category,
    ).toBe("box");
  });

  it("browser și PC", () => {
    expect(g("Chrome", "Chrome")).toBe("no?");
    expect(g("Safari", "Safari")).toBe("no?");
    expect(g("Valentina", "windows")).toBe("no?");
  });

  it("Vidaa și fără nume", () => {
    expect(g("DIAMANT VS0343FE2_0102", "vidaa")).toBe("unknown?");
    expect(g("", "")).toBe("unknown?");
  });
});

describe("prioritatea surselor", () => {
  const none = { userAnswer: null, hdrDirectAt: null };

  it("confirmarea bate tot", () => {
    const r = resolveDeviceHdr(
      { name: "TV 2019", platform: "Tizen" },
      { userAnswer: false, hdrDirectAt: 1 },
    );
    expect([r.verdict, r.sure, r.source]).toEqual(["no", true, "user"]);
  });

  it("redarea directă HDR dovedește doar la TV-uri și box-uri", () => {
    const tv = resolveDeviceHdr(
      { name: "TV 2016", platform: "Tizen" },
      { ...none, hdrDirectAt: 1 },
    );
    expect([tv.verdict, tv.sure, tv.source]).toEqual(["yes", true, "observed"]);
    const pad = resolveDeviceHdr(
      { name: "Redmi Pad 2", platform: "Android" },
      { ...none, hdrDirectAt: 1 },
    );
    expect([pad.verdict, pad.source]).toEqual(["unknown", "rules"]);
  });

  it("fără dovezi rămân regulile", () => {
    expect(resolveDeviceHdr({ name: "Chrome", platform: "Chrome" }, none).source).toBe("rules");
  });
});

describe("pickDevices", () => {
  it("cel mai folosit din fereastră și ultimul", () => {
    const views = [
      { deviceId: 6, viewedAt: 100 },
      { deviceId: 6, viewedAt: 110 },
      { deviceId: 7, viewedAt: 120 },
      { deviceId: 9, viewedAt: 10 },
      { deviceId: 9, viewedAt: 11 },
      { deviceId: 9, viewedAt: 12 },
      { viewedAt: 130 },
    ];
    expect(pickDevices(views, 50)).toEqual({ usual: 6, last: 7 });
  });

  it("fără vizionări recente, cel obișnuit e ultimul", () => {
    expect(pickDevices([{ deviceId: 3, viewedAt: 5 }], 50)).toEqual({ usual: 3, last: 3 });
    expect(pickDevices([], 50)).toBeNull();
  });
});
