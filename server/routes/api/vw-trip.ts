import { defineEventHandler, readRawBody, createError } from "h3";
import { requireVwToken } from "../../../src/lib/vw/vw-auth";
import {
  insertVwPoints,
  MAX_POINTS_PER_REQUEST,
  type VwIncomingPoint,
} from "../../../src/lib/vw/vw-trips";

// Primește punctele de traseu ale aplicației VW Welcome (aceeași cheie ca /api/vw-log).
// Corp JSON: { "version": "1.1.19", "points": [{ "t": <epoch ms>, "lat": …, "lon": …, … }] }
const MAX_BODY_BYTES = 512 * 1024;

export default defineEventHandler(async (event) => {
  if (event.method !== "POST") throw createError({ statusCode: 405, message: "POST only" });

  requireVwToken(event);

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
