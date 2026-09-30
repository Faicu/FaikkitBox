// ---------------------------------------------------------------------------
// Călătoriile mașinii (VW Welcome): puncte de traseu cu GPS și date CAN, primite
// prin POST /api/vw-trip. O călătorie = puncte consecutive fără pauză mai lungă
// de TRIP_GAP_MS; statisticile se calculează la citire. Server-only (node:sqlite).
// ---------------------------------------------------------------------------

import { getDb } from "../db";

export interface VwIncomingPoint {
  t: number; // epoch ms, ceasul navigației
  lat?: number | null;
  lon?: number | null;
  alt?: number | null;
  acc?: number | null; // precizia GPS, metri
  gs?: number | null; // viteza GPS, km/h
  cs?: number | null; // viteza de la mașină (CAN), km/h
  rpm?: number | null;
  v?: number | null; // tensiunea bateriei, V
  temp?: number | null; // temperatura exterioară, °C
  odo?: number | null; // kilometraj, km
}

export interface VwTripPoint {
  t: string;
  lat: number | null;
  lon: number | null;
  speed: number | null; // CAN dacă există, altfel GPS
  rpm: number | null;
}

export interface VwTrip {
  start: string;
  end: string;
  points: number;
  distanceKm: number;
  durationMin: number;
  maxSpeed: number | null;
  avgSpeed: number | null; // km/h, pe durata totală
  maxRpm: number | null;
  odoStart: number | null;
  odoEnd: number | null;
  tempC: number | null;
  minVolt: number | null;
  startPos: [number, number] | null;
  endPos: [number, number] | null;
}

export const MAX_POINTS_PER_REQUEST = 500;
const TRIP_GAP_MS = 5 * 60_000;
const MAX_POINTS = 2_000_000;

function num(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

/** Inserează un lot de puncte; întoarce câte au intrat (duplicatele după oră se ignoră). */
export function insertVwPoints(points: VwIncomingPoint[]): number {
  const db = getDb();
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO vw_trip_point
       (device_at, received_at, lat, lon, alt, acc, gps_speed, can_speed, rpm, volt, temp, odo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let added = 0;
  db.exec("BEGIN");
  try {
    for (const p of points) {
      if (!Number.isFinite(p?.t)) continue;
      const rpm = num(p.rpm);
      const odo = num(p.odo);
      const r = stmt.run(
        new Date(p.t).toISOString(),
        now,
        num(p.lat),
        num(p.lon),
        num(p.alt),
        num(p.acc),
        num(p.gs),
        num(p.cs),
        rpm === null ? null : Math.round(rpm),
        num(p.v),
        num(p.temp),
        odo === null ? null : Math.round(odo),
      );
      added += Number(r.changes);
    }
    db.prepare(
      `DELETE FROM vw_trip_point WHERE id <= (SELECT id FROM vw_trip_point ORDER BY id DESC LIMIT 1 OFFSET ?)`,
    ).run(MAX_POINTS);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return added;
}

interface Row {
  device_at: string;
  lat: number | null;
  lon: number | null;
  acc: number | null;
  gps_speed: number | null;
  can_speed: number | null;
  rpm: number | null;
  volt: number | null;
  temp: number | null;
  odo: number | null;
}

function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLon = (b[1] - a[1]) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function pos(r: Row): [number, number] | null {
  if (r.lat === null || r.lon === null) return null;
  if (r.acc !== null && r.acc > 60) return null; // fix GPS prea imprecis
  return [r.lat, r.lon];
}

function summarize(rows: Row[]): VwTrip {
  let gpsKm = 0;
  let last: [number, number] | null = null;
  let maxSpeed: number | null = null;
  let maxRpm: number | null = null;
  let minVolt: number | null = null;
  let startPos: [number, number] | null = null;
  let endPos: [number, number] | null = null;
  for (const r of rows) {
    const p = pos(r);
    if (p) {
      // Săriturile de peste 2 km între două puncte sunt erori de GPS, nu drum.
      if (last) {
        const d = haversineKm(last, p);
        if (d < 2) gpsKm += d;
      }
      last = p;
      startPos ??= p;
      endPos = p;
    }
    const speed = r.can_speed ?? r.gps_speed;
    if (speed !== null) maxSpeed = Math.max(maxSpeed ?? 0, speed);
    if (r.rpm !== null) maxRpm = Math.max(maxRpm ?? 0, r.rpm);
    if (r.volt !== null && r.volt > 5) minVolt = Math.min(minVolt ?? 99, r.volt);
  }
  const odos = rows.map((r) => r.odo).filter((o): o is number => o !== null && o > 0);
  const odoStart = odos.length ? odos[0] : null;
  const odoEnd = odos.length ? odos[odos.length - 1] : null;
  // Kilometrajul are rezoluție de 1 km: îl preferăm doar pe drumuri mai lungi.
  const odoKm = odoStart !== null && odoEnd !== null ? odoEnd - odoStart : null;
  const distanceKm = odoKm !== null && odoKm >= 5 ? odoKm : gpsKm;
  const start = rows[0].device_at;
  const end = rows[rows.length - 1].device_at;
  const durationMin = (new Date(end).getTime() - new Date(start).getTime()) / 60_000;
  const temps = rows.map((r) => r.temp).filter((t): t is number => t !== null);
  return {
    start,
    end,
    points: rows.length,
    distanceKm: Math.round(distanceKm * 10) / 10,
    durationMin: Math.round(durationMin * 10) / 10,
    maxSpeed: maxSpeed === null ? null : Math.round(maxSpeed),
    avgSpeed: durationMin > 0 ? Math.round((distanceKm / durationMin) * 60) : null,
    maxRpm,
    odoStart,
    odoEnd,
    tempC: temps.length ? temps[temps.length - 1] : null,
    minVolt: minVolt === null ? null : Math.round(minVolt * 100) / 100,
    startPos,
    endPos,
  };
}

/** Călătoriile din ultimele `days` zile, cele mai noi primele. */
export function readVwTrips(days = 60): VwTrip[] {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = getDb()
    .prepare(
      `SELECT device_at, lat, lon, acc, gps_speed, can_speed, rpm, volt, temp, odo
       FROM vw_trip_point WHERE device_at >= ? ORDER BY device_at`,
    )
    .all(since) as unknown as Row[];
  const trips: VwTrip[] = [];
  let cur: Row[] = [];
  for (const r of rows) {
    const prev = cur[cur.length - 1];
    if (
      prev &&
      new Date(r.device_at).getTime() - new Date(prev.device_at).getTime() > TRIP_GAP_MS
    ) {
      trips.push(summarize(cur));
      cur = [];
    }
    cur.push(r);
  }
  if (cur.length) trips.push(summarize(cur));
  // Trei-patru puncte izolate (ex. o repornire pe loc) nu sunt o călătorie.
  return trips.filter((t) => t.points >= 5).reverse();
}

/** Punctele unei călătorii (între `start` și `end`, inclusiv), pentru hartă și grafic. */
export function readVwTripPoints(start: string, end: string): VwTripPoint[] {
  const rows = getDb()
    .prepare(
      `SELECT device_at, lat, lon, acc, gps_speed, can_speed, rpm FROM vw_trip_point
       WHERE device_at BETWEEN ? AND ? ORDER BY device_at`,
    )
    .all(start, end) as unknown as Row[];
  return rows.map((r) => {
    const p = pos(r);
    return {
      t: r.device_at,
      lat: p ? p[0] : null,
      lon: p ? p[1] : null,
      speed: r.can_speed ?? r.gps_speed,
      rpm: r.rpm,
    };
  });
}
