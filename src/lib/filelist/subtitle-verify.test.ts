import { describe, expect, it } from "vitest";

import { parseSrtTiming, timingMatch } from "./subtitle-verify";

const srt = (starts: number[]) =>
  starts
    .map((s, i) => {
      const t = (x: number) =>
        `00:${String(Math.floor(x / 60)).padStart(2, "0")}:${String(Math.floor(x % 60)).padStart(2, "0")},${String(Math.round((x % 1) * 1000)).padStart(3, "0")}`;
      return `${i + 1}\n${t(s)} --> ${t(s + 1.5)}\nreplică\n`;
    })
    .join("\n");

// Replici la intervale neregulate, ca într-un episod real.
function episode(seed: number, n = 300): number[] {
  let x = 5;
  let r = seed;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    r = (r * 1103515245 + 12345) % 2147483648;
    x += 1.5 + (r / 2147483648) * 8;
    out.push(Math.round(x * 1000) / 1000);
  }
  return out;
}

describe("parseSrtTiming", () => {
  it("citește începuturile și sfârșitul ultimei replici", () => {
    const t = parseSrtTiming(srt([6.093, 7.79, 61.5]));
    expect(t.starts).toEqual([6.093, 7.79, 61.5]);
    expect(t.lastEnd).toBeCloseTo(63);
  });
});

describe("timingMatch", () => {
  const e1 = episode(1);
  const e2 = episode(2);

  it("același episod: aproape toate replicile se potrivesc", () => {
    expect(timingMatch(e1, e1).score).toBeGreaterThan(0.95);
  });

  it("același episod cu decalaj constant (alt release): tot se potrivește", () => {
    const m = timingMatch(
      e1.map((x) => x + 3.4),
      e1,
    );
    expect(m.score).toBeGreaterThan(0.9);
    expect(m.offset).toBeCloseTo(-3.4, 0);
  });

  it("alt episod: sub prag (MobLand S02E02 cu subtitrarea lui E01)", () => {
    expect(timingMatch(e2, e1).score).toBeLessThan(0.2);
  });
});
