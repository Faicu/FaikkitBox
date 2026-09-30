// ---------------------------------------------------------------------------
// Starea mașinii pentru pagina /calatorii și pentru aplicația VW Welcome
// (/api/vw-status): ultima poziție, kilometrajul curent și mentenanța.
// Server-only (node:sqlite).
// ---------------------------------------------------------------------------

import { getDb } from "../db";

export interface VwPosition {
  t: string;
  lat: number;
  lon: number;
  speed: number | null;
}

export interface VwReminderInput {
  id?: number;
  title: string;
  everyKm: number | null;
  everyMonths: number | null;
  lastKm: number | null;
  lastDate: string | null; // YYYY-MM-DD
  dueDate: string | null; // YYYY-MM-DD, are prioritate față de lastDate + everyMonths
}

export interface VwReminder extends Required<VwReminderInput> {
  id: number;
  nextKm: number | null;
  nextDate: string | null;
  kmLeft: number | null;
  daysLeft: number | null;
  soon: boolean; // sub 1000 km sau 30 de zile
  overdue: boolean;
}

const SOON_KM = 1000;
const SOON_DAYS = 30;

/** Ultima poziție GPS primită (mașina parcată, dacă nu merge acum). */
export function readLastPosition(): VwPosition | null {
  const r = getDb()
    .prepare(
      `SELECT device_at, lat, lon, can_speed, gps_speed FROM vw_trip_point
       WHERE lat IS NOT NULL AND lon IS NOT NULL AND (acc IS NULL OR acc <= 60)
       ORDER BY device_at DESC LIMIT 1`,
    )
    .get() as
    | {
        device_at: string;
        lat: number;
        lon: number;
        can_speed: number | null;
        gps_speed: number | null;
      }
    | undefined;
  if (!r) return null;
  return { t: r.device_at, lat: r.lat, lon: r.lon, speed: r.can_speed ?? r.gps_speed };
}

/** Kilometrajul cel mai recent raportat de mașină. */
export function readOdometer(): number | null {
  const r = getDb()
    .prepare(`SELECT odo FROM vw_trip_point WHERE odo > 0 ORDER BY device_at DESC LIMIT 1`)
    .get() as { odo: number } | undefined;
  return r?.odo ?? null;
}

function addMonths(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function readReminders(): VwReminder[] {
  const odo = readOdometer();
  const rows = getDb()
    .prepare(
      `SELECT id, title, every_km, every_months, last_km, last_date, due_date FROM vw_reminder ORDER BY id`,
    )
    .all() as Array<{
    id: number;
    title: string;
    every_km: number | null;
    every_months: number | null;
    last_km: number | null;
    last_date: string | null;
    due_date: string | null;
  }>;
  const now = new Date(`${today()}T00:00:00Z`).getTime();
  return rows
    .map((r) => {
      const nextKm = r.every_km !== null && r.last_km !== null ? r.last_km + r.every_km : null;
      const nextDate =
        r.due_date ??
        (r.every_months !== null && r.last_date !== null
          ? addMonths(r.last_date, r.every_months)
          : null);
      const kmLeft = nextKm !== null && odo !== null ? nextKm - odo : null;
      const daysLeft =
        nextDate !== null
          ? Math.round((new Date(`${nextDate}T00:00:00Z`).getTime() - now) / 86_400_000)
          : null;
      return {
        id: r.id,
        title: r.title,
        everyKm: r.every_km,
        everyMonths: r.every_months,
        lastKm: r.last_km,
        lastDate: r.last_date,
        dueDate: r.due_date,
        nextKm,
        nextDate,
        kmLeft,
        daysLeft,
        overdue: (kmLeft !== null && kmLeft <= 0) || (daysLeft !== null && daysLeft <= 0),
        soon:
          (kmLeft !== null && kmLeft <= SOON_KM) || (daysLeft !== null && daysLeft <= SOON_DAYS),
      };
    })
    .sort(
      (a, b) =>
        Number(b.overdue) - Number(a.overdue) ||
        Number(b.soon) - Number(a.soon) ||
        (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999),
    );
}

function intOrNull(x: unknown): number | null {
  const n = typeof x === "number" ? x : typeof x === "string" && x.trim() ? Number(x) : NaN;
  return Number.isFinite(n) ? Math.round(n) : null;
}

function dateOrNull(x: unknown): string | null {
  return typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null;
}

export function saveReminder(input: VwReminderInput): void {
  const title = String(input.title ?? "")
    .trim()
    .slice(0, 80);
  if (!title) throw new Error("Titlul lipsește");
  const values = [
    title,
    intOrNull(input.everyKm),
    intOrNull(input.everyMonths),
    intOrNull(input.lastKm),
    dateOrNull(input.lastDate),
    dateOrNull(input.dueDate),
  ];
  const db = getDb();
  if (input.id) {
    db.prepare(
      `UPDATE vw_reminder SET title = ?, every_km = ?, every_months = ?, last_km = ?, last_date = ?,
       due_date = ? WHERE id = ?`,
    ).run(...values, input.id);
  } else {
    db.prepare(
      `INSERT INTO vw_reminder (title, every_km, every_months, last_km, last_date, due_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(...values, new Date().toISOString());
  }
}

export function deleteReminder(id: number): void {
  getDb().prepare(`DELETE FROM vw_reminder WHERE id = ?`).run(id);
}

/**
 * „Făcut azi”: ultima dată = azi, ultimul km = kilometrajul curent. O dată fixă (ITP, RCA)
 * cu interval în luni se mută cu un interval; fără interval, rămâne de actualizat manual.
 */
export function markReminderDone(id: number): void {
  const db = getDb();
  const r = db.prepare(`SELECT every_months, due_date FROM vw_reminder WHERE id = ?`).get(id) as
    { every_months: number | null; due_date: string | null } | undefined;
  if (!r) return;
  const dueDate =
    r.due_date !== null && r.every_months !== null ? addMonths(r.due_date, r.every_months) : null;
  db.prepare(`UPDATE vw_reminder SET last_km = ?, last_date = ?, due_date = ? WHERE id = ?`).run(
    readOdometer(),
    today(),
    dueDate,
    id,
  );
}
