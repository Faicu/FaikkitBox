// Proxy pentru posterele Plex afișate în "cine vizionează acum" (Acasă).
// Există fiindcă imaginile Plex cer PLEX_TOKEN, iar tokenul nu are ce căuta în
// browser — serverul îl adaugă aici, la trecere.
//
// Ruta e autentificată și acceptă o singură formă de cale. Înainte verifica
// doar `path.startsWith("/library/")`, ceea ce era ocolibil: fetch() normalizează
// "/library/../status/sessions" la "/status/sessions" ÎNAINTE de a trimite
// cererea, deci oricine, nelogat, putea folosi ruta ca proxy autentificat către
// întreg API-ul Plex (conturi, sesiuni, chiar /library/parts/... = fișierele
// brute din bibliotecă). De aceea validarea e o listă albă de formă, nu o
// filtrare de "..": blacklist-urile de path traversal se ocolesc, forma nu.

import {
  defineEventHandler,
  getQuery,
  getSession,
  setResponseHeader,
  setResponseStatus,
  sendStream,
} from "h3";

import { sessionConfig, type AdminSession } from "../../../src/lib/auth/admin.server";

// Exact ce trimite Plex ca `thumb` pe o sesiune: /library/metadata/<id>/thumb/<ts>
// (segmentul final lipsește la unele item-uri, de aici grupul opțional).
const THUMB_PATH = /^\/library\/metadata\/\d+\/[a-z]+(\/\d+)?$/;

export default defineEventHandler(async (event) => {
  const session = await getSession<AdminSession>(event, sessionConfig());
  if (!session.data.userId) {
    setResponseStatus(event, 401);
    return "Unauthorized";
  }

  const path = (getQuery(event).path as string) ?? "";
  if (!THUMB_PATH.test(path)) {
    setResponseStatus(event, 400);
    return "Invalid path";
  }

  const base = process.env.PLEX_URL?.replace(/\/$/, "");
  const token = process.env.PLEX_TOKEN;
  if (!base || !token) {
    setResponseStatus(event, 503);
    return "Plex not configured";
  }

  try {
    // Tokenul merge pe header, nu în query string — altfel ajunge în logurile
    // de acces ale Plex-ului la fiecare poster încărcat.
    const res = await fetch(`${base}${path}`, { headers: { "X-Plex-Token": token } });
    if (!res.ok) {
      setResponseStatus(event, res.status);
      return "Upstream error";
    }

    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    setResponseHeader(event, "Content-Type", contentType);
    // "private": conținutul e dintr-o bibliotecă privată, doar cache-ul
    // browserului care l-a cerut are voie să-l păstreze, nu un proxy comun.
    setResponseHeader(event, "Cache-Control", "private, max-age=3600");

    return sendStream(event, res.body as ReadableStream);
  } catch {
    setResponseStatus(event, 502);
    return "Fetch error";
  }
});
