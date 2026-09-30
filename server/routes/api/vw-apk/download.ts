import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { defineEventHandler, createError, sendStream, setResponseHeaders } from "h3";
import { requireVwToken } from "../../../../src/lib/vw/vw-auth";
import { apkExists, apkPath, readApkInfo } from "../../../../src/lib/vw/vw-apk";

// Descărcarea ultimului APK de către aplicația VW Welcome (actualizarea din aplicație).
export default defineEventHandler((event) => {
  requireVwToken(event);
  if (!apkExists()) throw createError({ statusCode: 404, message: "No APK" });
  const info = readApkInfo();
  setResponseHeaders(event, {
    "Content-Type": "application/vnd.android.package-archive",
    "Content-Length": String(info?.size ?? ""),
    "Cache-Control": "no-store",
  });
  return sendStream(event, Readable.toWeb(createReadStream(apkPath())) as ReadableStream);
});
