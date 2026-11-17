// Statisticile vizionărilor pe zi / săptămână / lună și pe user — funcție
// pură, în ora României (o vizionare de la 01:00 e a zilei noi, nu a celei din UTC).

import type { RecentWatchStats, WatchStatsPeriod } from "./recent-watch-types";

const TZ = "Europe/Bucharest";
const DAY_MS = 86_400_000;

// Data locală ca miezul nopții UTC al aceleiași zile — aritmetica pe zile
// rămâne corectă și peste schimbarea orei.
function localDayMs(sec: number): number {
  const [y, m, d] = new Date(sec * 1000)
    .toLocaleDateString("en-CA", { timeZone: TZ })
    .split("-")
    .map(Number);
  return Date.UTC(y, m - 1, d);
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const mondayOf = (ms: number) => ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY_MS;
const monthKey = (ms: number) => new Date(ms).toISOString().slice(0, 7);

const fmt = (ms: number, opts: Intl.DateTimeFormatOptions) =>
  new Date(ms).toLocaleDateString("ro-RO", { ...opts, timeZone: "UTC" });

function period(
  rows: Array<{ viewed_at: number; username: string }>,
  keys: Array<{ key: string; label: string }>,
  keyOf: (dayMs: number) => string,
): WatchStatsPeriod {
  const counts = new Map(keys.map((k) => [k.key, 0]));
  const users = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    const key = keyOf(localDayMs(r.viewed_at));
    const c = counts.get(key);
    if (c == null) continue;
    counts.set(key, c + 1);
    users.set(r.username, (users.get(r.username) ?? 0) + 1);
    total++;
  }
  return {
    buckets: keys.map((k) => ({ ...k, count: counts.get(k.key)! })),
    users: [...users]
      .map(([username, count]) => ({ username, count }))
      .sort((a, b) => b.count - a.count || a.username.localeCompare(b.username)),
    total,
  };
}

// Ultimele 30 de zile, 12 săptămâni (de luni) și 12 luni, inclusiv cea curentă.
export function computeWatchStats(
  rows: Array<{ viewed_at: number; username: string }>,
  nowSec: number,
): RecentWatchStats {
  const today = localDayMs(nowSec);

  const days = Array.from({ length: 30 }, (_, i) => {
    const ms = today - (29 - i) * DAY_MS;
    return { key: isoDay(ms), label: fmt(ms, { day: "numeric", month: "short" }) };
  });

  const thisMonday = mondayOf(today);
  const weeks = Array.from({ length: 12 }, (_, i) => {
    const ms = thisMonday - (11 - i) * 7 * DAY_MS;
    return { key: isoDay(ms), label: fmt(ms, { day: "numeric", month: "short" }) };
  });

  const t = new Date(today);
  const months = Array.from({ length: 12 }, (_, i) => {
    const ms = Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - (11 - i), 1);
    return { key: monthKey(ms), label: fmt(ms, { month: "short", year: "numeric" }) };
  });

  return {
    day: period(rows, days, isoDay),
    week: period(rows, weeks, (ms) => isoDay(mondayOf(ms))),
    month: period(rows, months, monthKey),
  };
}
