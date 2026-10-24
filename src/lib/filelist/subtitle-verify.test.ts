import { describe, expect, it } from "vitest";

import {
  isBetterSync,
  isConfidentSync,
  parseSrtTiming,
  speechCorrelation,
} from "./subtitle-verify";

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

// Intervalele de vorbire ale unui episod, din începuturile de mai sus.
const speech = (starts: number[]) => starts.map((s): [number, number] => [s, s + 1.2]);

describe("speechCorrelation", () => {
  const e1 = speech(episode(1));
  const e2 = speech(episode(2));

  it("același episod: corelație maximă", () => {
    expect(speechCorrelation(e1, e1).score).toBeGreaterThan(0.95);
  });

  it("același episod cu decalaj constant (alt release): tot se potrivește", () => {
    const m = speechCorrelation(
      e1.map(([a, b]): [number, number] => [a + 3.5, b + 3.5]),
      e1,
    );
    expect(m.score).toBeGreaterThan(0.9);
    expect(m.offset).toBeCloseTo(-3.5, 0);
  });

  it("același episod, replici împărțite altfel (The Rookie S08): tot se potrivește", () => {
    // Traducătorul unește câte două replici consecutive într-una.
    const merged: Array<[number, number]> = [];
    for (let i = 0; i + 1 < e1.length; i += 2) merged.push([e1[i][0], e1[i + 1][1]]);
    expect(speechCorrelation(merged, e1).score).toBeGreaterThan(0.45);
  });

  it("alt episod: sub prag (MobLand S02E02 cu subtitrarea lui E01)", () => {
    expect(speechCorrelation(e2, e1).score).toBeLessThan(0.45);
  });
});

describe("isBetterSync", () => {
  it("la scor practic egal câștigă decalajul mai mic (Euphoria S01E02)", () => {
    const kings = { score: 0.467, offset: 0 };
    const afg = { score: 0.468, offset: 8 };
    expect(isBetterSync(afg, kings)).toBe(false);
    expect(isBetterSync(kings, afg)).toBe(true);
  });

  it("la scor și decalaj egale rămâne cea deja aleasă", () => {
    expect(isBetterSync({ score: 0.5, offset: 0 }, { score: 0.5, offset: 0 })).toBe(false);
  });

  it("altfel decide scorul, oricare ar fi decalajul", () => {
    expect(isBetterSync({ score: 0.9, offset: 3 }, { score: 0.6, offset: 0 })).toBe(true);
    expect(isBetterSync({ score: 0.6, offset: 0 }, { score: 0.9, offset: 3 })).toBe(false);
  });

  it("prima variantă măsurată e mereu mai bună decât nimic", () => {
    expect(isBetterSync({ score: 0.46, offset: 20 }, null)).toBe(true);
  });
});

describe("isConfidentSync", () => {
  const exact = { matchedCriteria: 5, maxCriteria: 5 };
  const other = { matchedCriteria: 3, maxCriteria: 5 };

  it("bine sincronizată e sigură oricare ar fi numele", () => {
    expect(isConfidentSync({ score: 0.91, offset: 0 }, other)).toBe(true);
  });

  it("release identic, fără decalaj: sigură și sub pragul de corelație (Euphoria S01)", () => {
    expect(isConfidentSync({ score: 0.47, offset: 0 }, exact)).toBe(true);
    expect(isConfidentSync({ score: 0.54, offset: -0.5 }, exact)).toBe(true);
  });

  it("sub prag rămâne aproximativă cu alt release sau cu decalaj", () => {
    expect(isConfidentSync({ score: 0.47, offset: 0 }, other)).toBe(false);
    expect(isConfidentSync({ score: 0.47, offset: 8 }, exact)).toBe(false);
    expect(isConfidentSync({ score: 0.9, offset: 2 }, exact)).toBe(false);
  });
});
