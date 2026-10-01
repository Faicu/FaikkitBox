import { defineEventHandler, readRawBody, createError, setResponseHeaders } from "h3";
import { requireVwToken } from "../../../src/lib/vw/vw-auth";
import { MAX_TTS_CHARS, synthesize } from "../../../src/lib/vw/vw-tts";

// Salutul vorbit al aplicației VW Welcome, cu vocea Piper de pe server (lib/vw/vw-tts.ts).
// Corp JSON: { "text": "Bună seara! ..." } → audio/mpeg. Aceeași cheie ca /api/vw-log.
export default defineEventHandler(async (event) => {
  if (event.method !== "POST") throw createError({ statusCode: 405, message: "POST only" });
  requireVwToken(event);
  let text: unknown;
  try {
    text = JSON.parse((await readRawBody(event)) ?? "").text;
  } catch {
    throw createError({ statusCode: 400, message: "Invalid JSON" });
  }
  if (typeof text !== "string" || !text.trim() || text.length > MAX_TTS_CHARS) {
    throw createError({ statusCode: 400, message: "Invalid text" });
  }
  const audio = await synthesize(text);
  setResponseHeaders(event, {
    "Content-Type": "audio/mpeg",
    "Content-Length": String(audio.length),
    "Cache-Control": "no-store",
  });
  return audio;
});
