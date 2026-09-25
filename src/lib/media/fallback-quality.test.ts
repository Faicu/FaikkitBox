import { describe, it, expect } from "vitest";
import {
  FALLBACK_WAIT_MS,
  effectiveFallback,
  fallbackReady,
  parseFallbackSeen,
} from "./fallback-quality";

const NOW = new Date("2026-09-25T19:00:00Z").getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("fallbackReady", () => {
  it("prima dată când găsește doar rezerva: nu descarcă, notează momentul", () => {
    expect(fallbackReady("S02E03", {}, NOW)).toEqual({
      ready: false,
      firstSeen: new Date(NOW).toISOString(),
    });
  });

  it("la o verificare după cel puțin 3 ore: ia rezerva", () => {
    const seen = { S02E03: ago(FALLBACK_WAIT_MS) };
    expect(fallbackReady("S02E03", seen, NOW)).toEqual({ ready: true, firstSeen: seen.S02E03 });
  });

  it("„Verifică acum” apăsat curând după: încă așteaptă, păstrând prima notare", () => {
    const seen = { S02E03: ago(10 * 60 * 1000) };
    expect(fallbackReady("S02E03", seen, NOW)).toEqual({ ready: false, firstSeen: seen.S02E03 });
  });

  it("notițele altei ținte nu contează", () => {
    expect(fallbackReady("S02E04", { S02E03: ago(FALLBACK_WAIT_MS * 2) }, NOW).ready).toBe(false);
  });

  it("o notiță stricată e tratată ca prima dată", () => {
    expect(fallbackReady("film", { film: "nu-e-dată" }, NOW).ready).toBe(false);
  });
});

describe("effectiveFallback", () => {
  it("fără rezervă sau rezervă egală cu principala: nimic", () => {
    expect(effectiveFallback("1080p", null)).toBeNull();
    expect(effectiveFallback("1080p", "1080p")).toBeNull();
  });

  it("rezervă diferită: se folosește", () => {
    expect(effectiveFallback("1080p", "720p")).toBe("720p");
  });
});

describe("parseFallbackSeen", () => {
  it("tolerează gol, JSON stricat și forme greșite", () => {
    expect(parseFallbackSeen(null)).toEqual({});
    expect(parseFallbackSeen("{")).toEqual({});
    expect(parseFallbackSeen("[1]")).toEqual({});
    expect(parseFallbackSeen('{"film":"2026-09-25T19:00:00.000Z"}')).toEqual({
      film: "2026-09-25T19:00:00.000Z",
    });
  });
});
