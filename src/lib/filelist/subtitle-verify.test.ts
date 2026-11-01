import { describe, expect, it } from "vitest";

import {
  isBetterSync,
  isConfidentSync,
  measureSync,
  parseSrtTiming,
  retimeSrt,
  pickReferenceStream,
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

describe("measureSync", () => {
  // ~1 h 50 min de dialog, cât un film.
  const film = speech(episode(3, 1200));
  const shifted = (ivs: Array<[number, number]>, f: (t: number) => number) =>
    ivs.map(([a, b]): [number, number] => [f(a), f(b)]);

  it("sincronizată: fără corecție", () => {
    const m = measureSync(film, film);
    expect(m.retime).toBeUndefined();
    expect(m.score).toBeGreaterThan(0.95);
  });

  it("alunecare 24 față de 23,976 fps (The Dog Stars): corectează viteza", () => {
    const m = measureSync(
      shifted(film, (t) => t * 1.001 + 0.4),
      film,
    );
    expect(m.retime?.ratio).toBeCloseTo(1000 / 1001, 6);
    expect(m.offset).toBe(0);
    expect(m.score).toBeGreaterThan(0.8);
  });

  it("decalaj constant: deplasează", () => {
    const m = measureSync(
      shifted(film, (t) => t + 3.5),
      film,
    );
    expect(m.retime?.ratio).toBe(1);
    expect(m.retime?.shift).toBeCloseTo(-3.5, 0);
    expect(m.offset).toBe(0);
  });

  it("alt montaj (o scenă în plus la mijloc): nu corectează, rămâne decalajul", () => {
    const half = film[Math.floor(film.length / 2)][0];
    const m = measureSync(
      shifted(film, (t) => (t < half ? t + 3 : t + 9)),
      film,
    );
    expect(m.retime).toBeUndefined();
    expect(Math.abs(m.offset)).toBeGreaterThan(0.5);
  });
});

describe("retimeSrt", () => {
  it("aplică viteza și deplasarea, restul textului rămâne", () => {
    const out = retimeSrt("1\n01:00:00,000 --> 01:00:02,500\nSalut\n", {
      ratio: 1000 / 1001,
      shift: -1,
    });
    expect(out).toBe("1\n00:59:55,404 --> 00:59:57,901\nSalut\n");
  });

  it("nu coboară sub zero", () => {
    expect(retimeSrt("00:00:00,500 --> 00:00:01,000", { ratio: 1, shift: -2 })).toBe(
      "00:00:00,000 --> 00:00:00,000",
    );
  });
});

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

describe("pickReferenceStream", () => {
  const stream = (
    index: number,
    language: string,
    extra: { title?: string; forced?: number; hi?: number; codec?: string } = {},
  ) => ({
    index,
    codec_name: extra.codec ?? "subrip",
    disposition: { forced: extra.forced ?? 0, hearing_impaired: extra.hi ?? 0 },
    tags: { language, title: extra.title },
  });

  it("sare peste pista forțată și preferă engleza completă înaintea SDH (The Fix)", () => {
    const picked = pickReferenceStream([
      stream(2, "eng", { title: "English [Forced]", forced: 1 }),
      stream(3, "eng", { title: "English" }),
      stream(4, "eng", { title: "English [SDH]", hi: 1 }),
    ]);
    expect(picked?.index).toBe(3);
  });

  it("recunoaște pista forțată și doar după titlu", () => {
    expect(
      pickReferenceStream([stream(2, "eng", { title: "Forced" }), stream(3, "eng")])?.index,
    ).toBe(3);
  });

  it("folosește SDH când e singura completă", () => {
    expect(
      pickReferenceStream([
        stream(2, "eng", { forced: 1 }),
        stream(3, "eng", { title: "English SDH" }),
      ])?.index,
    ).toBe(3);
  });

  it("fără reper când rămân doar piste forțate, române sau grafice", () => {
    expect(
      pickReferenceStream([
        stream(2, "eng", { forced: 1 }),
        stream(3, "rum"),
        stream(4, "eng", { codec: "hdmv_pgs_subtitle" }),
      ]),
    ).toBeNull();
  });
});
