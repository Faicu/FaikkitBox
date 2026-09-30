import { defineEventHandler, readRawBody, getHeader, createError } from "h3";
import { timingSafeEqual } from "node:crypto";
import {
  insertVwPoints,
  MAX_POINTS_PER_REQUEST,
  type VwIncomingPoint,
} from "../../../src/lib/vw/vw-trips";

// Primește punctele de traseu ale aplicației VW Welcome (aceeași cheie ca /api/vw-log).
// Corp JSON: { "version": "1.1.19", "points": [{ "t": <epoch ms>, "lat": …, "lon": …, … }] }
const MAX_BODY_BYTES = 512 * 1024;

function tokenMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default defineEventHandler(async (event) => {
  if (event.method !== "POST") throw createError({ statusCode: 405, message: "POST only" });

  const token = process.env.VW_LOG_TOKEN;
  if (!token) throw createError({ statusCode: 500, message: "VW_LOG_TOKEN not set" });
  if (!tokenMatches(getHeader(event, "authorization") ?? "", `Bearer ${token}`)) {
    throw createError({ statusCode: 401, message: "Invalid token" });
  }

  const body = (await readRawBody(event)) ?? "";
  if (body.length > MAX_BODY_BYTES) throw createError({ statusCode: 413, message: "Too large" });

  let payload: { points?: unknown };
  try {
    payload = JSON.parse(body);
  } catch {
    throw createError({ statusCode: 400, message: "Invalid JSON" });
  }
  if (!Array.isArray(payload.points) || payload.points.length > MAX_POINTS_PER_REQUEST) {
    throw createError({ statusCode: 400, message: "Invalid points" });
  }

  const added = insertVwPoints(payload.points as VwIncomingPoint[]);
  return { ok: true, added };
});
