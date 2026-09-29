import { defineEventHandler, readRawBody, getHeader, createError } from "h3";
import { timingSafeEqual } from "node:crypto";
import {
  insertVwLines,
  MAX_LINES_PER_REQUEST,
  type VwIncomingLine,
} from "../../../src/lib/vw/vw-log";

// Primește jurnalul aplicației VW Welcome de pe navigație.
// Autentificare: "Authorization: Bearer <VW_LOG_TOKEN>". Corp JSON:
// { "version": "1.1.10", "lines": [{ "t": <epoch ms>, "text": "..." }] }
const MAX_BODY_BYTES = 256 * 1024;

function tokenMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default defineEventHandler(async (event) => {
  if (event.method !== "POST") throw createError({ statusCode: 405, message: "POST only" });

  const token = process.env.VW_LOG_TOKEN;
  if (!token) throw createError({ statusCode: 500, message: "VW_LOG_TOKEN not set" });
  const auth = getHeader(event, "authorization") ?? "";
  if (!tokenMatches(auth, `Bearer ${token}`)) {
    throw createError({ statusCode: 401, message: "Invalid token" });
  }

  const body = (await readRawBody(event)) ?? "";
  if (body.length > MAX_BODY_BYTES) throw createError({ statusCode: 413, message: "Too large" });

  let payload: { version?: unknown; lines?: unknown };
  try {
    payload = JSON.parse(body);
  } catch {
    throw createError({ statusCode: 400, message: "Invalid JSON" });
  }
  if (!Array.isArray(payload.lines) || payload.lines.length > MAX_LINES_PER_REQUEST) {
    throw createError({ statusCode: 400, message: "Invalid lines" });
  }

  const version = typeof payload.version === "string" ? payload.version.slice(0, 40) : null;
  const added = insertVwLines(payload.lines as VwIncomingLine[], version);
  return { ok: true, added };
});
