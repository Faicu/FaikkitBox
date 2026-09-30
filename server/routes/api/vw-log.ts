import { defineEventHandler, readRawBody, createError } from "h3";
import { requireVwToken } from "../../../src/lib/vw/vw-auth";
import {
  insertVwLines,
  MAX_LINES_PER_REQUEST,
  type VwIncomingLine,
} from "../../../src/lib/vw/vw-log";

// Primește jurnalul aplicației VW Welcome de pe navigație.
// Autentificare: "Authorization: Bearer <VW_LOG_TOKEN>". Corp JSON:
// { "version": "1.1.10", "lines": [{ "t": <epoch ms>, "text": "..." }] }
const MAX_BODY_BYTES = 256 * 1024;

export default defineEventHandler(async (event) => {
  if (event.method !== "POST") throw createError({ statusCode: 405, message: "POST only" });

  requireVwToken(event);

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
