// Cheia comună a rutelor /api/vw-* (aplicația VW Welcome și CI-ul ei): "Authorization:
// Bearer $VW_LOG_TOKEN". Server-only.

import { createError, getHeader, type H3Event } from "h3";
import { timingSafeEqual } from "node:crypto";

export function requireVwToken(event: H3Event): void {
  const token = process.env.VW_LOG_TOKEN;
  if (!token) throw createError({ statusCode: 500, message: "VW_LOG_TOKEN not set" });
  const given = Buffer.from(getHeader(event, "authorization") ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw createError({ statusCode: 401, message: "Invalid token" });
  }
}
