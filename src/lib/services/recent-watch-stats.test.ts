import { describe, expect, it } from "vitest";

import { computeWatchStats } from "./recent-watch-stats";

const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);

describe("computeWatchStats", () => {
  // Marți, 17 nov 2026, 12:00 la București.
  const now = at("2026-11-17T10:00:00Z");

  it("pune vizionarea după miezul nopții în ziua locală, nu în cea UTC", () => {
    // 16 nov 23:30 UTC = 17 nov 01:30 la București.
    const s = computeWatchStats([{ viewed_at: at("2026-11-16T23:30:00Z"), username: "a" }], now);
    expect(s.day.buckets.at(-1)).toMatchObject({ key: "2026-11-17", count: 1 });
    expect(s.day.buckets.at(-2)!.count).toBe(0);
  });

  it("săptămânile încep lunea, lunile la 1", () => {
    const rows = [
      { viewed_at: at("2026-11-16T08:00:00Z"), username: "a" }, // luni
      { viewed_at: at("2026-11-15T08:00:00Z"), username: "b" }, // duminică
      { viewed_at: at("2026-11-01T08:00:00Z"), username: "b" },
    ];
    const s = computeWatchStats(rows, now);
    expect(s.week.buckets.at(-1)).toMatchObject({ key: "2026-11-16", count: 1 });
    expect(s.week.buckets.at(-2)).toMatchObject({ key: "2026-11-09", count: 1 });
    expect(s.month.buckets.at(-1)).toMatchObject({ key: "2026-11", count: 3 });
    expect(s.month.users).toEqual([
      { username: "b", count: 2 },
      { username: "a", count: 1 },
    ]);
    expect(s.week.buckets.at(-2)!.users).toEqual([{ username: "b", count: 1 }]);
  });

  it("ignoră ce e în afara ferestrei", () => {
    const s = computeWatchStats([{ viewed_at: at("2025-01-01T08:00:00Z"), username: "a" }], now);
    expect(s.day.total + s.week.total + s.month.total).toBe(0);
    expect(s.day.buckets).toHaveLength(30);
    expect(s.week.buckets).toHaveLength(12);
    expect(s.month.buckets).toHaveLength(12);
  });
});
