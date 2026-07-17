import { defineEventHandler, readRawBody, getHeader, createError } from "h3";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getDb } from "../../../src/lib/db";
import { sendPushToAll } from "../../../src/lib/push";

export default defineEventHandler(async (event) => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) throw createError({ statusCode: 500, message: "GITHUB_WEBHOOK_SECRET not set" });

  const signature = getHeader(event, "x-hub-signature-256") ?? "";
  const body = await readRawBody(event) ?? "";

  // Verifică semnătura HMAC
  const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  const sigBuf = Buffer.from(signature.padEnd(expected.length));
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throw createError({ statusCode: 401, message: "Invalid signature" });
  }

  const eventType = getHeader(event, "x-github-event");
  if (eventType !== "push") return { ok: true };

  let payload: any;
  try {
    payload = JSON.parse(body);
  } catch {
    throw createError({ statusCode: 400, message: "Invalid JSON" });
  }

  const commits: any[] = payload.commits ?? [];
  const repo = process.env.GITHUB_REPO ?? "";
  const db = getDb();

  const stmt = db.prepare(
    `INSERT OR IGNORE INTO commits (sha, short_sha, message, author, date, url, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const now = new Date().toISOString();

  for (const c of commits) {
    const sha = String(c.id ?? "");
    if (!sha) continue;

    const message = String(c.message ?? "").split("\n")[0];
    const author = c.author?.name ?? c.author?.username ?? "necunoscut";
    const date = c.timestamp ?? now;
    const url = c.url ?? `https://github.com/${repo}/commit/${sha}`;

    stmt.run(sha, sha.slice(0, 7), message, author, date, url, now);
    await sendPushToAll(`📦 Commit nou — ${author}`, message).catch(() => {});
  }

  return { ok: true, processed: commits.length };
});
