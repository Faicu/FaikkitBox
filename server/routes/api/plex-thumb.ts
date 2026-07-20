import { defineEventHandler, getQuery, setResponseHeader, sendStream } from "h3";

export default defineEventHandler(async (event) => {
  const path = (getQuery(event).path as string) ?? "";

  if (!path.startsWith("/library/")) {
    event.node.res.statusCode = 400;
    return "Invalid path";
  }

  const base = process.env.PLEX_URL?.replace(/\/$/, "");
  const token = process.env.PLEX_TOKEN;
  if (!base || !token) {
    event.node.res.statusCode = 503;
    return "Plex not configured";
  }

  try {
    const res = await fetch(`${base}${path}?X-Plex-Token=${token}`);
    if (!res.ok) {
      event.node.res.statusCode = res.status;
      return "Upstream error";
    }

    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    setResponseHeader(event, "Content-Type", contentType);
    setResponseHeader(event, "Cache-Control", "public, max-age=3600");

    return sendStream(event, res.body as ReadableStream);
  } catch {
    event.node.res.statusCode = 502;
    return "Fetch error";
  }
});
