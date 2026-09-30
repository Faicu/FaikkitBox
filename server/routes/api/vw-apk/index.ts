import { defineEventHandler, readRawBody, getHeader, createError } from "h3";
import { requireVwToken } from "../../../../src/lib/vw/vw-auth";
import { readApkInfo, saveApk } from "../../../../src/lib/vw/vw-apk";

// GET: metadatele ultimului APK VW Welcome. POST (din CI): APK-ul ca octeți, cu
// X-Version-Code și X-Version-Name. Ambele cu cheia VW_LOG_TOKEN.
const MAX_APK_BYTES = 60 * 1024 * 1024;

export default defineEventHandler(async (event) => {
  requireVwToken(event);
  if (event.method === "GET") return readApkInfo() ?? { versionCode: 0 };
  if (event.method !== "POST") throw createError({ statusCode: 405, message: "GET/POST only" });

  const versionCode = Number(getHeader(event, "x-version-code"));
  const versionName = String(getHeader(event, "x-version-name") ?? "").slice(0, 40);
  if (!Number.isInteger(versionCode) || versionCode <= 0 || !versionName) {
    throw createError({ statusCode: 400, message: "Missing version headers" });
  }
  const body = await readRawBody(event, false);
  if (!body || body.length === 0) throw createError({ statusCode: 400, message: "Empty body" });
  if (body.length > MAX_APK_BYTES) throw createError({ statusCode: 413, message: "Too large" });
  // Un APK e o arhivă ZIP: primii octeți sunt „PK”.
  if (body[0] !== 0x50 || body[1] !== 0x4b) {
    throw createError({ statusCode: 400, message: "Not an APK" });
  }
  return saveApk(Buffer.from(body), versionCode, versionName);
});
